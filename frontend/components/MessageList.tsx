import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import React from 'react';
import {
  Bot,
  Clock,
  Search,
  Zap,
  Copy,
  Edit2,
  RefreshCw,
  AlertCircle,
  ChevronDown,
  GitFork,
} from 'lucide-react';
import Markdown from './Markdown';
import { MessageContentRenderer } from './ui/MessageContentRenderer';
import { ImagePreview, ImageUploadZone } from './ui/ImagePreview';
import type { PendingState } from '../hooks/useChat';
import {
  images,
  createMixedContent,
  extractImagesFromContent,
  extractTextFromContent,
  type ChatMessage,
  type MessageContent,
  type ImageAttachment,
  type ImageContent,
} from '../lib';
import { useStreamingScroll } from '../hooks/useStreamingScroll';
import { WelcomeMessage } from './WelcomeMessage';

interface MessageListProps {
  messages: ChatMessage[];
  pending: PendingState;
  conversationId: string | null;
  editingMessageId: string | null;
  editingContent: string;
  onCopy: (text: string) => void;
  onEditMessage: (messageId: string, content: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onApplyLocalEdit: (messageId: string, content: MessageContent) => void;
  onEditingContentChange: (content: string) => void;
  onRetryMessage: (messageId: string) => void;
  onScrollStateChange?: (state: { showTop: boolean; showBottom: boolean }) => void;
  containerRef?: React.RefObject<HTMLDivElement>;
  onSuggestionClick?: (text: string) => void;
  onFork?: (messageId: string) => void;
}

// Helper function to split messages with tool calls into separate messages
function splitMessagesWithToolCalls(messages: ChatMessage[]): ChatMessage[] {
  // Keep original message shape and avoid splitting tool calls into separate messages.
  // We render tool calls and any tool outputs inside the same assistant bubble below.
  return messages;
}

type ToolOutput = NonNullable<ChatMessage['tool_outputs']>[number];

type AssistantSegment =
  | { kind: 'text'; text: string }
  | { kind: 'tool_call'; toolCall: any; outputs: ToolOutput[] };

function buildAssistantSegments(message: ChatMessage): AssistantSegment[] {
  if (message.role !== 'assistant') {
    const textContent = extractTextFromContent(message.content);
    if (textContent) {
      return [{ kind: 'text', text: textContent }];
    }
    return [];
  }

  const content = extractTextFromContent(message.content);
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const toolOutputs = Array.isArray(message.tool_outputs) ? message.tool_outputs : [];
  const messageEvents = Array.isArray(message.message_events) ? message.message_events : [];

  // Helper to resolve outputs for a tool call
  const resolveOutputs = (call: any): ToolOutput[] => {
    return toolOutputs.filter((out) => {
      if (!out) return false;
      if (out.tool_call_id && call?.id) return out.tool_call_id === call.id;
      if (out.name && call?.function?.name) return out.name === call.function.name;
      return false;
    });
  };

  // Check if any tool call has a valid textOffset
  const hasValidTextOffset = toolCalls.some(
    (call: any) =>
      typeof call?.textOffset === 'number' &&
      Number.isFinite(call.textOffset) &&
      call.textOffset > 0
  );

  if (messageEvents.length > 0) {
    const sortedEvents = [...messageEvents].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    const segments: AssistantSegment[] = [];

    for (const event of sortedEvents) {
      if (event.type === 'content') {
        const text = typeof event.payload?.text === 'string' ? event.payload.text : '';
        if (text) {
          segments.push({ kind: 'text', text });
        }
        continue;
      }

      if (event.type === 'reasoning') {
        const text = typeof event.payload?.text === 'string' ? event.payload.text : '';
        if (text) {
          segments.push({ kind: 'text', text: `<thinking>${text}</thinking>` });
        }
        continue;
      }

      if (event.type === 'tool_call') {
        const toolCallId = event.payload?.tool_call_id;
        const toolCallIndex = event.payload?.tool_call_index;
        const toolCall =
          (toolCallId ? toolCalls.find((call: any) => call?.id === toolCallId) : undefined) ||
          (typeof toolCallIndex === 'number'
            ? toolCalls.find((call: any) => (call?.index ?? 0) === toolCallIndex)
            : undefined);

        if (toolCall) {
          segments.push({ kind: 'tool_call', toolCall, outputs: resolveOutputs(toolCall) });
        }
      }
    }

    if (segments.length > 0) {
      return segments;
    }
  }

  if (toolCalls.length === 0) {
    return content ? [{ kind: 'text', text: content }] : [];
  }

  // For loaded conversations (no valid textOffset), show tools first, then content
  if (!hasValidTextOffset) {
    const segments: AssistantSegment[] = [];

    // Add all tool calls at the beginning
    const sortedCalls = toolCalls
      .map((call: any, idx: number) => ({
        idx,
        call,
        order: typeof call?.index === 'number' ? call.index : idx,
      }))
      .sort((a, b) => a.order - b.order);

    for (const entry of sortedCalls) {
      segments.push({
        kind: 'tool_call',
        toolCall: entry.call,
        outputs: resolveOutputs(entry.call),
      });
    }

    // Add content after tool calls
    if (content) {
      segments.push({ kind: 'text', text: content });
    }

    return segments;
  }

  // For streaming messages with textOffset, use position-based rendering
  const sortedCalls = toolCalls
    .map((call: any, idx: number) => {
      const offset =
        typeof call?.textOffset === 'number' && Number.isFinite(call.textOffset)
          ? Math.max(0, Math.min(call.textOffset, content.length))
          : undefined;
      return {
        idx,
        call,
        offset,
        order: typeof call?.index === 'number' ? call.index : idx,
      };
    })
    .sort((a, b) => {
      const aOffset = a.offset ?? content.length;
      const bOffset = b.offset ?? content.length;
      if (aOffset !== bOffset) return aOffset - bOffset;
      return a.order - b.order;
    });

  const segments: AssistantSegment[] = [];
  let cursor = 0;

  for (const entry of sortedCalls) {
    const offset = entry.offset ?? content.length;
    const normalized = Math.max(0, Math.min(offset, content.length));
    const sliceEnd = Math.max(cursor, normalized);

    if (sliceEnd > cursor) {
      const textChunk = content.slice(cursor, sliceEnd);
      if (textChunk) {
        segments.push({ kind: 'text', text: textChunk });
      }
      cursor = sliceEnd;
    }

    segments.push({ kind: 'tool_call', toolCall: entry.call, outputs: resolveOutputs(entry.call) });
    cursor = Math.max(cursor, normalized);
  }

  if (cursor < content.length) {
    const remaining = content.slice(cursor);
    if (remaining) {
      segments.push({ kind: 'text', text: remaining });
    }
  }

  if (segments.length === 0 && content) {
    segments.push({ kind: 'text', text: content });
  }

  return segments;
}

// Memoized individual message component
interface MessageProps {
  message: ChatMessage;
  isStreaming: boolean;
  conversationId: string | null;
  editingMessageId: string | null;
  editingContent: string;
  onCopy: (text: string) => void;
  onEditMessage: (messageId: string, content: string) => void;
  onCancelEdit: () => void;
  onApplyLocalEdit: (messageId: string) => void;
  onEditingContentChange: (content: string) => void;
  onRetryMessage?: (messageId: string) => void;
  editingTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
  lastUserMessageRef: React.RefObject<HTMLDivElement | null> | null;
  resizeEditingTextarea: () => void;
  collapsedToolOutputs: Record<string, boolean>;
  setCollapsedToolOutputs: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  copiedMessageId: string | null;
  handleCopy: (messageId: string, text: string) => void;
  pending: PendingState;
  streamingStats: { tokensPerSecond: number } | null;
  // Image editing support
  editingImages: ImageAttachment[];
  onEditingImagesChange: (files: File[]) => void;
  onRemoveEditingImage: (imageId: string) => void;
  onEditingPaste: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onEditingImageUploadClick: () => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  toolbarRef?: React.RefObject<HTMLDivElement | null>;
  onFork?: (messageId: string) => void;
}

const Message = React.memo<MessageProps>(
  function Message({
    message,
    isStreaming,
    editingMessageId,
    editingContent,
    onEditMessage,
    onCancelEdit,
    onApplyLocalEdit,
    onEditingContentChange,
    onRetryMessage,
    editingTextareaRef,
    lastUserMessageRef,
    resizeEditingTextarea,
    collapsedToolOutputs,
    setCollapsedToolOutputs,
    copiedMessageId,
    handleCopy,
    pending,
    streamingStats,
    editingImages,
    onEditingImagesChange,
    onRemoveEditingImage,
    onEditingPaste,
    onEditingImageUploadClick,
    fileInputRef,
    toolbarRef,
    onFork,
  }: {
    message: ChatMessage;
    isStreaming: boolean;
    conversationId: string | null;
    editingMessageId: string | null;
    editingContent: string;
    onCopy: (text: string) => void;
    onEditMessage: (messageId: string, content: string) => void;
    onCancelEdit: () => void;
    onApplyLocalEdit: (messageId: string, content?: MessageContent) => void;
    onEditingContentChange: (content: string) => void;
    onRetryMessage?: (messageId: string) => void;
    editingTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
    lastUserMessageRef: React.RefObject<HTMLDivElement | null> | null;
    toolbarRef?: React.RefObject<HTMLDivElement | null>;
    resizeEditingTextarea: () => void;
    collapsedToolOutputs: Record<string, boolean>;
    setCollapsedToolOutputs: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
    copiedMessageId: string | null;
    handleCopy: (messageId: string, text: string) => void;
    pending: PendingState;
    streamingStats: { tokensPerSecond: number } | null;
    editingImages: ImageAttachment[];
    onEditingImagesChange: (files: File[]) => void;
    onRemoveEditingImage: (id: string) => void;
    onEditingPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
    onEditingImageUploadClick: () => void;
    fileInputRef: React.RefObject<HTMLInputElement | null>;
    onFork?: (messageId: string) => void;
  }) {
    const isUser = message.role === 'user';
    const isEditing = editingMessageId === message.id;

    // Comparison Logic
    const [activeComparisonTab, setActiveComparisonTab] = useState<string>('primary');
    const hasComparison =
      message.comparisonResults && Object.keys(message.comparisonResults).length > 0;

    // Determine content based on active tab
    let displayMessage = message;
    let isComparisonStreaming = false;

    if (hasComparison && activeComparisonTab !== 'primary') {
      const result = message.comparisonResults?.[activeComparisonTab];
      if (result) {
        // Construct a temporary message object for rendering
        displayMessage = {
          ...message,
          content: result.content,
          tool_calls: undefined, // Secondary models don't support tool calls yet
          tool_outputs: undefined,
          usage: result.usage,
        };
        isComparisonStreaming = result.status === 'streaming';
      }
    }

    const assistantSegments = !isUser ? buildAssistantSegments(displayMessage) : [];

    // For editing, check if we have either text or images
    const canSaveEdit = editingContent.trim().length > 0 || editingImages.length > 0;

    return (
      <div
        className={`flex gap-4 ${isUser ? 'justify-end' : 'justify-start'}`}
        ref={lastUserMessageRef}
      >
        {!isUser && (
          <div className="hidden">
            <Bot className="w-4 h-4 text-slate-700 dark:text-slate-200" />
          </div>
        )}
        <div
          className={`group relative ${isEditing ? 'w-full' : ''} ${isUser ? 'max-w-full sm:max-w-[85%] md:max-w-[75%] lg:max-w-[60%] order-first' : 'w-full'}`}
          style={{ minWidth: 0 }}
        >
          {hasComparison && !isUser && (
            <div className="flex items-center gap-2 mb-2 overflow-x-auto pb-1 no-scrollbar">
              <button
                onClick={() => setActiveComparisonTab('primary')}
                className={`px-3 py-1 text-xs rounded-full border transition-colors whitespace-nowrap ${
                  activeComparisonTab === 'primary'
                    ? 'bg-zinc-800 text-white border-zinc-800 dark:bg-zinc-200 dark:text-zinc-900 dark:border-zinc-200'
                    : 'bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                }`}
              >
                Primary
              </button>
              {Object.keys(message.comparisonResults || {}).map((modelId) => (
                <button
                  key={modelId}
                  onClick={() => setActiveComparisonTab(modelId)}
                  className={`px-3 py-1 text-xs rounded-full border transition-colors whitespace-nowrap ${
                    activeComparisonTab === modelId
                      ? 'bg-zinc-800 text-white border-zinc-800 dark:bg-zinc-200 dark:text-zinc-900 dark:border-zinc-200'
                      : 'bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                  }`}
                >
                  {modelId.includes('::') ? modelId.split('::')[1] : modelId}
                </button>
              ))}
            </div>
          )}

          {isEditing ? (
            <ImageUploadZone
              onFiles={onEditingImagesChange}
              disabled={false}
              fullPage={false}
              clickToUpload={false}
            >
              <div className="space-y-2 rounded-2xl bg-white/95 dark:bg-zinc-900/95 border border-zinc-200 dark:border-zinc-800 shadow-sm p-4">
                {/* Image Previews */}
                {editingImages.length > 0 && (
                  <div className="pb-2 border-b border-zinc-200 dark:border-zinc-800">
                    <ImagePreview
                      images={editingImages}
                      uploadProgress={[]}
                      onRemove={onRemoveEditingImage}
                    />
                  </div>
                )}

                {/* Hidden file input for image upload */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    if (files.length > 0) {
                      onEditingImagesChange(files);
                    }
                    e.target.value = '';
                  }}
                />

                <textarea
                  ref={editingTextareaRef}
                  value={editingContent}
                  onChange={(e) => onEditingContentChange(e.target.value)}
                  onInput={resizeEditingTextarea}
                  onPaste={onEditingPaste}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      onApplyLocalEdit(message.id);
                    }
                  }}
                  className="w-full min-h-[100px] resize-vertical bg-transparent border-0 outline-none text-base leading-relaxed text-zinc-800 dark:text-zinc-200 placeholder-zinc-500 dark:placeholder-zinc-400"
                  placeholder="Edit your message... (paste or drop images)"
                  style={{ overflow: 'hidden' }}
                />

                <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-neutral-700">
                  <button
                    type="button"
                    onClick={onEditingImageUploadClick}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 transition-colors"
                  >
                    <span className="text-sm">📎</span>
                    {editingImages.length > 0
                      ? `${editingImages.length} image${editingImages.length > 1 ? 's' : ''}`
                      : 'Add images'}
                  </button>

                  <div className="flex gap-2">
                    <button
                      onClick={onCancelEdit}
                      className="px-3 py-1.5 text-xs rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => onApplyLocalEdit(message.id)}
                      disabled={!canSaveEdit}
                      className="px-3 py-1.5 text-xs rounded-lg bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-200 text-white dark:text-black font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      Save
                    </button>
                  </div>
                </div>
              </div>
            </ImageUploadZone>
          ) : (
            <>
              {isUser ? (
                <div className="rounded-2xl px-5 py-3.5 text-base leading-relaxed bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">
                  <MessageContentRenderer content={message.content} isStreaming={false} />
                </div>
              ) : (
                <div className="space-y-3">
                  {assistantSegments.length === 0 ? (
                    <div className="text-base leading-relaxed text-zinc-800 dark:text-zinc-200">
                      {(isStreaming && activeComparisonTab === 'primary') ||
                      isComparisonStreaming ||
                      pending.abort ? (
                        <span className="inline-flex items-center gap-1 text-zinc-500 dark:text-zinc-400">
                          <span
                            className="w-1.5 h-1.5 rounded-full bg-current animate-bounce"
                            style={{ animationDelay: '0ms' }}
                          />
                          <span
                            className="w-1.5 h-1.5 rounded-full bg-current animate-bounce"
                            style={{ animationDelay: '150ms' }}
                          />
                          <span
                            className="w-1.5 h-1.5 rounded-full bg-current animate-bounce"
                            style={{ animationDelay: '300ms' }}
                          />
                        </span>
                      ) : (
                        <span className="text-zinc-500 dark:text-zinc-400 italic">
                          No response content
                        </span>
                      )}
                    </div>
                  ) : (
                    assistantSegments.map((segment, segmentIndex) => {
                      if (segment.kind === 'text') {
                        if (!segment.text) {
                          return null;
                        }
                        return (
                          <div
                            key={`text-${segmentIndex}`}
                            className="text-base leading-relaxed text-zinc-900 dark:text-zinc-200"
                          >
                            <Markdown
                              text={segment.text}
                              isStreaming={
                                (isStreaming && activeComparisonTab === 'primary') ||
                                isComparisonStreaming
                              }
                            />
                          </div>
                        );
                      }

                      const { toolCall, outputs } = segment;
                      const toolName = toolCall.function?.name;
                      let parsedArgs = {};
                      const argsRaw = toolCall.function?.arguments || '';
                      let argsParseFailed = false;

                      // Try to parse arguments if they're a string
                      if (typeof argsRaw === 'string') {
                        if (argsRaw.trim()) {
                          try {
                            parsedArgs = JSON.parse(argsRaw);
                          } catch {
                            // If parse fails, it might be streaming (incomplete JSON)
                            // Show the raw string instead of empty object
                            argsParseFailed = true;
                          }
                        }
                      } else {
                        parsedArgs = argsRaw;
                      }

                      const getToolIcon = (name: string) => {
                        const iconProps = {
                          size: 14,
                          strokeWidth: 1.5,
                          className:
                            'text-zinc-400 dark:text-zinc-500 group-hover/tool-btn:text-zinc-600 dark:group-hover/tool-btn:text-zinc-300 transition-colors duration-300',
                        };
                        switch (name) {
                          case 'get_time':
                            return <Clock {...iconProps} />;
                          case 'web_search':
                            return <Search {...iconProps} />;
                          default:
                            return <Zap {...iconProps} />;
                        }
                      };

                      const getToolDisplayName = (name: string) => {
                        switch (name) {
                          case 'get_time':
                            return 'Check Time';
                          case 'web_search':
                            return 'Search Web';
                          default:
                            return name;
                        }
                      };

                      const toggleKey = `${message.id}-${toolCall.id ?? segmentIndex}`;
                      const isCollapsed = collapsedToolOutputs[toggleKey] ?? true;

                      const getOutputSummary = (outputs: any[]) => {
                        if (!outputs || outputs.length === 0) return null;

                        const firstOutput = outputs[0];
                        const raw = firstOutput.output ?? firstOutput;

                        if (typeof raw === 'string') {
                          const cleaned = raw.trim().replace(/\s+/g, ' ');
                          return cleaned.length > 80 ? cleaned.slice(0, 77) + '...' : cleaned;
                        }

                        if (typeof raw === 'object' && raw !== null) {
                          if ('result' in raw) return String(raw.result).slice(0, 80);
                          if ('message' in raw) return String(raw.message).slice(0, 80);
                          if ('data' in raw && typeof raw.data === 'string')
                            return raw.data.slice(0, 80);
                          return 'Completed successfully';
                        }

                        return null;
                      };

                      const outputSummary = getOutputSummary(outputs);
                      const getInputSummary = (args: any, raw: string, parseFailed: boolean) => {
                        // If parsing failed, show the raw incomplete JSON string
                        if (parseFailed && raw) {
                          const cleaned = raw.trim().replace(/\s+/g, ' ');
                          return cleaned.length > 80 ? cleaned.slice(0, 77) + '...' : cleaned;
                        }

                        // If successfully parsed, show formatted JSON
                        if (!args || (typeof args === 'object' && Object.keys(args).length === 0)) {
                          return null;
                        }

                        try {
                          if (typeof args === 'string') {
                            const cleaned = args.trim().replace(/\s+/g, ' ');
                            return cleaned.length > 80 ? cleaned.slice(0, 77) + '...' : cleaned;
                          }

                          const str = JSON.stringify(args);
                          const cleaned = str.replace(/\s+/g, ' ');
                          return cleaned.length > 80 ? cleaned.slice(0, 77) + '...' : cleaned;
                        } catch {
                          return String(args).slice(0, 80);
                        }
                      };

                      const inputSummary = getInputSummary(parsedArgs, argsRaw, argsParseFailed);
                      const hasDetails =
                        outputs.length > 0 ||
                        Object.keys(parsedArgs).length > 0 ||
                        (argsParseFailed && argsRaw.trim().length > 0);

                      const isCompleted = outputs.length > 0;

                      return (
                        <div
                          key={`tool-${segmentIndex}`}
                          className="my-3 rounded-xl border border-zinc-200/60 dark:border-zinc-800/60 bg-white dark:bg-zinc-900/30 overflow-hidden shadow-sm"
                        >
                          <button
                            onClick={() => {
                              if (!hasDetails) return;
                              setCollapsedToolOutputs((s) => ({ ...s, [toggleKey]: !isCollapsed }));
                            }}
                            className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors select-none ${
                              !hasDetails
                                ? 'cursor-default'
                                : 'hover:bg-zinc-50 dark:hover:bg-white/5 cursor-pointer'
                            }`}
                          >
                            <div
                              className={`text-zinc-400 dark:text-zinc-500 scale-90 ${!isCompleted ? 'animate-pulse' : ''}`}
                            >
                              {React.cloneElement(
                                getToolIcon(toolName) as React.ReactElement<any>,
                                {
                                  fill: isCompleted ? 'currentColor' : 'none',
                                  className: isCompleted
                                    ? 'text-zinc-500 dark:text-zinc-400'
                                    : 'text-zinc-400 dark:text-zinc-500',
                                }
                              )}
                            </div>
                            <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300 font-mono">
                              {getToolDisplayName(toolName)}
                            </span>

                            {/* Always show params summary when collapsed if available */}
                            {isCollapsed && inputSummary && (
                              <span className="ml-2 text-xs text-zinc-400 dark:text-zinc-500 truncate max-w-[300px] opacity-80 font-mono">
                                {inputSummary}
                              </span>
                            )}

                            {hasDetails && (
                              <div className="ml-auto flex items-center gap-2">
                                <ChevronDown
                                  size={14}
                                  className={`transition-transform duration-200 ${!isCollapsed ? 'rotate-180' : ''} text-zinc-400 dark:text-zinc-500`}
                                />
                              </div>
                            )}
                          </button>

                          {!isCollapsed && hasDetails && (
                            <div className="border-t border-zinc-100 dark:border-zinc-800/50 bg-zinc-50/50 dark:bg-black/20 px-4 py-3 text-[13px]">
                              <div className="space-y-4">
                                {(Object.keys(parsedArgs).length > 0 ||
                                  (argsParseFailed && argsRaw.trim().length > 0)) && (
                                  <div className="space-y-1.5">
                                    <div className="text-[10px] font-semibold text-zinc-400 dark:text-zinc-600 uppercase tracking-wider pl-0.5 mb-1.5">
                                      Parameters
                                    </div>
                                    <div className="font-mono text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap leading-relaxed">
                                      {argsParseFailed
                                        ? argsRaw
                                        : JSON.stringify(parsedArgs, null, 2)}
                                    </div>
                                  </div>
                                )}

                                {outputs.length > 0 && (
                                  <div className="space-y-1.5">
                                    <div className="text-[10px] font-semibold text-zinc-400 dark:text-zinc-600 uppercase tracking-wider pl-0.5 mb-1.5">
                                      Result
                                    </div>
                                    <div className="space-y-3">
                                      {outputs.map((out: any, outIdx: number) => {
                                        const raw = out.output ?? out;
                                        let formatted = '';
                                        if (typeof raw === 'string') {
                                          formatted = raw;
                                        } else {
                                          try {
                                            formatted = JSON.stringify(raw, null, 2);
                                          } catch {
                                            formatted = String(raw);
                                          }
                                        }
                                        return (
                                          <div
                                            key={outIdx}
                                            className="font-mono text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap leading-relaxed"
                                          >
                                            {formatted}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              {!isEditing && (displayMessage.content || !isUser) && (
                <div
                  className={`mt-1 flex items-center ${isUser ? 'justify-end' : 'justify-between'} opacity-70 group-hover:opacity-100 transition-opacity text-xs`}
                  ref={isUser && toolbarRef ? toolbarRef : undefined}
                >
                  {/* Show stats for assistant messages */}
                  {!isUser && (
                    <div className="flex items-center gap-2">
                      {streamingStats &&
                        streamingStats.tokensPerSecond > 0 &&
                        activeComparisonTab === 'primary' && (
                          <div className="px-2 py-1 rounded-md bg-white/60 dark:bg-neutral-800/50 text-slate-600 dark:text-slate-400 text-xs font-mono">
                            {streamingStats.tokensPerSecond.toFixed(1)} tok/s
                          </div>
                        )}
                      {displayMessage.usage && (
                        <div className="px-2 py-1 rounded-md bg-white/60 dark:bg-neutral-800/50 text-slate-600 dark:text-slate-400 text-xs font-mono flex items-center gap-2">
                          {displayMessage.usage.provider && (
                            <span className="font-medium">{displayMessage.usage.provider}</span>
                          )}
                          {(displayMessage.usage.prompt_tokens !== undefined ||
                            displayMessage.usage.completion_tokens !== undefined) && (
                            <span className="text-slate-500 dark:text-slate-500">•</span>
                          )}
                          {displayMessage.usage.prompt_tokens !== undefined &&
                            displayMessage.usage.completion_tokens !== undefined && (
                              <span>
                                {displayMessage.usage.prompt_tokens +
                                  displayMessage.usage.completion_tokens}{' '}
                                tokens ({displayMessage.usage.prompt_tokens}↑ +{' '}
                                {displayMessage.usage.completion_tokens}↓)
                              </span>
                            )}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    {displayMessage.content && (
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() =>
                            handleCopy(message.id, extractTextFromContent(displayMessage.content))
                          }
                          title="Copy"
                          className="p-2 rounded-md bg-white/60 dark:bg-neutral-800/50 hover:bg-white/90 dark:hover:bg-neutral-700/80 text-slate-700 dark:text-slate-200 cursor-pointer transition-colors"
                        >
                          <Copy className="w-3 h-3" aria-hidden="true" />
                          <span className="sr-only">Copy</span>
                        </button>
                        {copiedMessageId === message.id && (
                          <div className="absolute bottom-full mb-1 left-1/2 transform -translate-x-1/2 bg-slate-800 dark:bg-slate-700 text-white text-xs px-2 py-1 rounded whitespace-nowrap z-10 animate-fade-in">
                            Copied
                            <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-2 border-r-2 border-t-2 border-transparent border-t-slate-800 dark:border-t-slate-700"></div>
                          </div>
                        )}
                      </div>
                    )}

                    {onFork && (
                      <button
                        type="button"
                        onClick={() => onFork(message.id)}
                        title="Fork"
                        className="p-2 rounded-md bg-white/60 dark:bg-neutral-800/50 hover:bg-white/90 dark:hover:bg-neutral-700/80 text-slate-700 dark:text-slate-200 cursor-pointer transition-colors"
                      >
                        <GitFork className="w-3 h-3" aria-hidden="true" />
                        <span className="sr-only">Fork</span>
                      </button>
                    )}

                    {isUser
                      ? message.content && (
                          <button
                            type="button"
                            onClick={() =>
                              onEditMessage(message.id, extractTextFromContent(message.content))
                            }
                            title="Edit"
                            className="p-2 rounded-md bg-white/20 dark:bg-neutral-800/30 hover:bg-white/60 dark:hover:bg-neutral-700/70 text-slate-700 dark:text-slate-200 cursor-pointer transition-colors"
                          >
                            <Edit2 className="w-3 h-3" aria-hidden="true" />
                            <span className="sr-only">Edit</span>
                          </button>
                        )
                      : !pending.streaming && (
                          <button
                            type="button"
                            onClick={() => onRetryMessage && onRetryMessage(message.id)}
                            title="Regenerate"
                            className="p-2 rounded-md bg-white/20 dark:bg-neutral-800/30 hover:bg-white/60 dark:hover:bg-neutral-700/70 text-slate-700 dark:text-slate-200 cursor-pointer transition-colors"
                          >
                            <RefreshCw className="w-3 h-3" aria-hidden="true" />
                            <span className="sr-only">Regenerate</span>
                          </button>
                        )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  },
  (prev, next) => {
    // Only re-render if content changed or streaming state changed
    return (
      prev.message.content === next.message.content &&
      prev.message.tool_calls === next.message.tool_calls &&
      prev.message.tool_outputs === next.message.tool_outputs &&
      prev.message.comparisonResults === next.message.comparisonResults &&
      prev.message.usage === next.message.usage &&
      prev.isStreaming === next.isStreaming &&
      prev.editingMessageId === next.editingMessageId &&
      prev.editingContent === next.editingContent &&
      prev.pending.streaming === next.pending.streaming &&
      prev.collapsedToolOutputs === next.collapsedToolOutputs &&
      prev.copiedMessageId === next.copiedMessageId &&
      prev.streamingStats?.tokensPerSecond === next.streamingStats?.tokensPerSecond &&
      prev.editingImages === next.editingImages &&
      prev.toolbarRef === next.toolbarRef
    );
  }
);

export function MessageList({
  messages,
  pending,
  conversationId,
  editingMessageId,
  editingContent,
  onCopy,
  onEditMessage,
  onCancelEdit,
  onApplyLocalEdit,
  onEditingContentChange,
  onRetryMessage,
  onScrollStateChange,
  containerRef: externalContainerRef,
  onSuggestionClick,
  onFork,
}: MessageListProps) {
  // Debug logging
  const internalContainerRef = useRef<HTMLDivElement | null>(null);
  const containerRef = externalContainerRef || internalContainerRef;
  const editingTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [collapsedToolOutputs, setCollapsedToolOutputs] = useState<Record<string, boolean>>({});
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const { dynamicBottomPadding, lastUserMessageRef, toolbarRef, bottomRef } = useStreamingScroll(
    messages,
    pending,
    containerRef
  );

  // Streaming statistics - now calculated from actual token count
  const [streamingStats, setStreamingStats] = useState<{ tokensPerSecond: number } | null>(null);
  const lastTokenStatsMessageIdRef = useRef<string | null>(null);

  // Editing images state - tracks images being edited
  const [editingImages, setEditingImages] = useState<ImageAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // When entering edit mode, initialize editing images from message content
  useEffect(() => {
    if (editingMessageId) {
      const message = messages.find((m) => m.id === editingMessageId);
      if (message) {
        const imageContents = extractImagesFromContent(message.content);
        // Convert ImageContent to ImageAttachment for editing
        const attachments: ImageAttachment[] = imageContents.map((img, idx) => ({
          id: `edit-${editingMessageId}-${idx}`,
          file: new File([], 'image'), // Placeholder file
          url: img.image_url.url,
          name: `Image ${idx + 1}`,
          size: 0,
          type: 'image/*',
          downloadUrl: img.image_url.url,
        }));
        setEditingImages(attachments);
      }
    } else {
      setEditingImages([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingMessageId]);

  // Handle image upload during editing
  const handleEditingImageFiles = useCallback(async (files: File[]) => {
    try {
      const uploadedImages = await images.uploadImages(files, () => {});
      setEditingImages((prev) => [...prev, ...uploadedImages]);
    } catch (error) {
      console.error('Image upload failed during editing:', error);
    }
  }, []);

  // Handle image removal during editing
  const handleRemoveEditingImage = useCallback(
    (imageId: string) => {
      const imageToRemove = editingImages.find((img) => img.id === imageId);
      if (imageToRemove && imageToRemove.url.startsWith('blob:')) {
        images.revokePreviewUrl(imageToRemove.url);
      }
      setEditingImages((prev) => prev.filter((img) => img.id !== imageId));
    },
    [editingImages]
  );

  // Handle paste in editing textarea
  const handleEditingPaste = useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = Array.from(event.clipboardData?.items || []);
      const files: File[] = [];

      items.forEach((item) => {
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file && file.type.startsWith('image/')) {
            files.push(file);
          }
        }
      });

      if (files.length === 0) {
        const fileList = Array.from(event.clipboardData?.files || []);
        fileList.forEach((file) => {
          if (file.type.startsWith('image/')) {
            files.push(file);
          }
        });
      }

      if (files.length > 0) {
        event.preventDefault();
        void handleEditingImageFiles(files);
      }
    },
    [handleEditingImageFiles]
  );

  // Handle image upload button click
  const handleEditingImageUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // Wrapper functions to clear streaming stats when regenerating or editing
  const handleRetryMessage = useCallback(
    (messageId: string) => {
      setStreamingStats(null);
      onRetryMessage(messageId);
    },
    [onRetryMessage]
  );

  const handleApplyLocalEdit = useCallback(
    (messageId: string) => {
      setStreamingStats(null);

      const trimmedText = editingContent.trim();

      // Convert editing images (ImageAttachment) to ImageContent for message storage
      const imageContents: ImageContent[] = editingImages.map((img) => ({
        type: 'image_url' as const,
        image_url: {
          url: img.downloadUrl || img.url,
          detail: 'auto' as const,
        },
      }));

      if (!trimmedText && imageContents.length === 0) {
        return;
      }

      const nextContent =
        imageContents.length > 0 ? createMixedContent(trimmedText, imageContents) : trimmedText;

      onApplyLocalEdit(messageId, nextContent);
    },
    [editingContent, editingImages, onApplyLocalEdit]
  );

  // Handle copy with tooltip feedback
  const handleCopy = (messageId: string, text: string) => {
    onCopy(text);
    setCopiedMessageId(messageId);
    setTimeout(() => setCopiedMessageId(null), 2000);
  };

  // Resize the editing textarea to fit its content
  const resizeEditingTextarea = () => {
    const ta = editingTextareaRef.current;
    if (!ta) return;
    // Reset height to allow shrinking, then set to scrollHeight to fit content
    ta.style.height = 'auto';
    // Use scrollHeight + 2px to avoid clipping in some browsers
    ta.style.height = `${ta.scrollHeight + 2}px`;
  };

  // When editing content changes (including on initial edit open), resize the textarea
  useEffect(() => {
    resizeEditingTextarea();
  }, [editingContent, editingMessageId]);

  // Track streaming statistics using actual token count
  useEffect(() => {
    const stats = pending.tokenStats;

    if (!stats) {
      lastTokenStatsMessageIdRef.current = null;
      setStreamingStats(null);
      return;
    }

    if (stats.messageId !== lastTokenStatsMessageIdRef.current) {
      lastTokenStatsMessageIdRef.current = stats.messageId;
      setStreamingStats(null);
    }

    const { count, startTime, lastUpdated } = stats;

    if (!Number.isFinite(startTime) || count <= 0) {
      return;
    }

    const endTimestamp =
      pending.streaming || !Number.isFinite(lastUpdated) ? Date.now() : lastUpdated;
    const elapsedSeconds = (endTimestamp - startTime) / 1000;

    if (elapsedSeconds <= 0.1) {
      return;
    }

    const tokensPerSecond = count / elapsedSeconds;

    if (!Number.isFinite(tokensPerSecond) || tokensPerSecond <= 0) {
      return;
    }

    setStreamingStats({ tokensPerSecond });
  }, [
    pending.streaming,
    pending.tokenStats,
    pending.tokenStats?.messageId,
    pending.tokenStats?.count,
    pending.tokenStats?.startTime,
    pending.tokenStats?.lastUpdated,
  ]);

  // Split messages with tool calls into separate messages
  const processedMessages = useMemo(() => splitMessagesWithToolCalls(messages), [messages]);

  // Track scroll position to show/hide scroll buttons
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !onScrollStateChange) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const threshold = 100; // pixels from top/bottom to show buttons

      onScrollStateChange({
        showTop: scrollTop > threshold,
        showBottom: scrollTop < scrollHeight - clientHeight - threshold,
      });
    };

    handleScroll(); // Initial check
    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [messages.length, onScrollStateChange, containerRef]);

  return (
    <main
      ref={containerRef}
      className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-neutral-700 scrollbar-track-transparent relative"
      style={{ willChange: 'scroll-position' }}
    >
      <div
        className="w-full mx-auto max-w-3xl px-4 sm:px-4 md:px-6 py-6 space-y-6"
        style={{ paddingBottom: dynamicBottomPadding }}
      >
        {messages.length === 0 && <WelcomeMessage onSuggestionClick={onSuggestionClick} />}
        {processedMessages.map((m, idx) => {
          const isUser = m.role === 'user';
          const isStreaming = pending.streaming && idx === processedMessages.length - 1;
          const isLastAssistantMessage = !isUser && idx === processedMessages.length - 1;
          // Set ref to the most recent user message (could be last or second-to-last)
          const isRecentUserMessage =
            isUser &&
            (idx === processedMessages.length - 1 || // last message is user
              (idx === processedMessages.length - 2 &&
                processedMessages[processedMessages.length - 1]?.role === 'assistant')); // second-to-last is user, last is assistant

          return (
            <Message
              key={m.id}
              message={m}
              isStreaming={isStreaming}
              conversationId={conversationId}
              editingMessageId={editingMessageId}
              editingContent={editingContent}
              onCopy={onCopy}
              onEditMessage={onEditMessage}
              onCancelEdit={onCancelEdit}
              onApplyLocalEdit={handleApplyLocalEdit}
              onEditingContentChange={onEditingContentChange}
              onRetryMessage={handleRetryMessage}
              editingTextareaRef={editingTextareaRef}
              lastUserMessageRef={isRecentUserMessage ? lastUserMessageRef : null}
              toolbarRef={isRecentUserMessage ? toolbarRef : undefined}
              resizeEditingTextarea={resizeEditingTextarea}
              collapsedToolOutputs={collapsedToolOutputs}
              setCollapsedToolOutputs={setCollapsedToolOutputs}
              copiedMessageId={copiedMessageId}
              handleCopy={handleCopy}
              pending={pending}
              streamingStats={isLastAssistantMessage ? streamingStats : null}
              editingImages={editingImages}
              onEditingImagesChange={handleEditingImageFiles}
              onRemoveEditingImage={handleRemoveEditingImage}
              onEditingPaste={handleEditingPaste}
              onEditingImageUploadClick={handleEditingImageUploadClick}
              fileInputRef={fileInputRef}
              onFork={onFork}
            />
          );
        })}
        {pending.error && (
          <div className="flex items-start gap-3 text-base text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded-xl px-4 py-3 shadow-sm">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-medium mb-1">Error occurred</div>
              <div className="text-red-600 dark:text-red-400">{pending.error}</div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </main>
  );
}
