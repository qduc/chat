import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import React from 'react';
import {
  Bot,
  User as UserIcon,
  MessageSquareText,
  Clock,
  Search,
  Zap,
  Copy,
  Edit2,
  RefreshCw,
  AlertCircle,
  ChevronDown,
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

  if (toolCalls.length === 0) {
    return content ? [{ kind: 'text', text: content }] : [];
  }

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
  }) {
    const isUser = message.role === 'user';
    const isEditing = editingMessageId === message.id;
    const assistantSegments = !isUser ? buildAssistantSegments(message) : [];

    // For editing, check if we have either text or images
    const canSaveEdit = editingContent.trim().length > 0 || editingImages.length > 0;

    return (
      <div
        className={`flex gap-4 ${isUser ? 'justify-end' : 'justify-start'}`}
        ref={lastUserMessageRef}
      >
        {!isUser && (
          <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-neutral-800 flex items-center justify-center flex-shrink-0 shadow-sm">
            <Bot className="w-4 h-4 text-slate-700 dark:text-slate-200" />
          </div>
        )}
        <div
          className={`group relative ${isEditing ? 'w-full' : ''} ${isUser ? 'max-w-[50%] order-first' : 'max-w-[95%]'}`}
        >
          {isEditing ? (
            <ImageUploadZone
              onFiles={onEditingImagesChange}
              disabled={false}
              fullPage={false}
              clickToUpload={false}
            >
              <div className="space-y-2 rounded-2xl bg-white/95 dark:bg-neutral-900/95 border border-slate-200 dark:border-neutral-700 shadow-sm p-4">
                {/* Image Previews */}
                {editingImages.length > 0 && (
                  <div className="pb-2 border-b border-slate-200 dark:border-neutral-700">
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
                  className="w-full min-h-[100px] resize-vertical bg-transparent border-0 outline-none text-base leading-relaxed text-slate-800 dark:text-slate-200 placeholder-slate-500 dark:placeholder-slate-400"
                  placeholder="Edit your message... (paste or drop images)"
                  style={{ overflow: 'hidden' }}
                />

                <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-neutral-700">
                  <button
                    type="button"
                    onClick={onEditingImageUploadClick}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-slate-700 dark:text-slate-300 transition-colors"
                  >
                    <span className="text-sm">📎</span>
                    {editingImages.length > 0
                      ? `${editingImages.length} image${editingImages.length > 1 ? 's' : ''}`
                      : 'Add images'}
                  </button>

                  <div className="flex gap-2">
                    <button
                      onClick={onCancelEdit}
                      className="px-3 py-1.5 text-xs rounded-lg bg-slate-200 hover:bg-slate-300 dark:bg-neutral-700 dark:hover:bg-neutral-600 text-slate-700 dark:text-slate-300 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => onApplyLocalEdit(message.id)}
                      disabled={!canSaveEdit}
                      className="px-3 py-1.5 text-xs rounded-lg bg-slate-600 hover:bg-slate-700 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
                <div className="rounded-2xl px-4 py-3 text-base leading-relaxed shadow-sm bg-slate-100 text-black dark:bg-slate-700 dark:text-white">
                  <MessageContentRenderer content={message.content} isStreaming={false} />
                </div>
              ) : (
                <div className="space-y-3">
                  {assistantSegments.length === 0 ? (
                    <div className="rounded-2xl px-4 py-3 text-base leading-relaxed shadow-sm bg-white dark:bg-neutral-900 text-slate-800 dark:text-slate-200 border border-slate-200/50 dark:border-neutral-700/50">
                      {pending.streaming || pending.abort ? (
                        <span className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400">
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
                        <span className="text-slate-500 dark:text-slate-400 italic">
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
                            className="rounded-2xl px-4 py-3 text-base leading-relaxed shadow-sm bg-white dark:bg-neutral-900 text-slate-800 dark:text-slate-200 border border-slate-200/50 dark:border-neutral-700/50"
                          >
                            <Markdown text={segment.text} isStreaming={isStreaming} />
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
                        switch (name) {
                          case 'get_time':
                            return <Clock className="w-4 h-4 text-black dark:text-white" />;
                          case 'web_search':
                            return <Search className="w-4 h-4 text-black dark:text-white" />;
                          default:
                            return <Zap className="w-4 h-4 text-black dark:text-white" />;
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

                      return (
                        <div
                          key={`tool-${segmentIndex}`}
                          className="block max-w-[95%] rounded-lg bg-gradient-to-br from-blue-50/80 to-indigo-50/60 dark:from-blue-950/30 dark:to-indigo-950/20 border border-blue-200/60 dark:border-blue-800/40 shadow-sm hover:shadow-md transition-shadow duration-200"
                        >
                          <div
                            className={`flex items-center gap-3 px-4 py-3 ${hasDetails ? 'cursor-pointer' : ''}`}
                            onClick={() => {
                              if (!hasDetails) return;
                              setCollapsedToolOutputs((s) => ({ ...s, [toggleKey]: !isCollapsed }));
                            }}
                          >
                            <div className="w-7 h-7 flex items-center justify-center flex-shrink-0 rounded-md bg-blue-100/80 dark:bg-blue-900/40">
                              {getToolIcon(toolName)}
                            </div>
                            <div className="flex flex-col min-w-0 flex-1 gap-1">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-base text-blue-900 dark:text-blue-100">
                                  {getToolDisplayName(toolName)}
                                </span>
                                {hasDetails && (
                                  <button
                                    type="button"
                                    className="text-xs px-2 py-0.5 rounded bg-blue-100/70 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 hover:bg-blue-200/70 dark:hover:bg-blue-800/60 transition-colors flex items-center gap-1"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setCollapsedToolOutputs((s) => ({
                                        ...s,
                                        [toggleKey]: !isCollapsed,
                                      }));
                                    }}
                                  >
                                    {isCollapsed ? 'Details' : 'Hide'}
                                    <ChevronDown
                                      className={`w-3 h-3 transition-transform ${isCollapsed ? '' : 'rotate-180'}`}
                                    />
                                  </button>
                                )}
                              </div>
                              {/* Show both input and output (one per line) when collapsed; otherwise show outputSummary or nothing. */}
                              {isCollapsed ? (
                                inputSummary || outputSummary ? (
                                  <div className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                                    {inputSummary && <div className="truncate">{inputSummary}</div>}
                                    {outputSummary && (
                                      <div className="truncate mt-1 text-slate-700 dark:text-slate-300">
                                        {outputSummary}
                                      </div>
                                    )}
                                  </div>
                                ) : null
                              ) : outputSummary ? (
                                <div className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                                  {outputSummary}
                                </div>
                              ) : null}
                            </div>
                          </div>

                          {hasDetails && !isCollapsed && (
                            <div className="px-4 pb-3 pt-1 space-y-3 border-t border-blue-200/40 dark:border-blue-800/30 bg-white/40 dark:bg-blue-950/20 rounded-b-lg">
                              {(Object.keys(parsedArgs).length > 0 ||
                                (argsParseFailed && argsRaw.trim().length > 0)) && (
                                <div className="space-y-1">
                                  <div className="text-xs font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wide">
                                    Input
                                  </div>
                                  <div className="rounded-md bg-slate-50 dark:bg-neutral-900/60 border border-slate-200/50 dark:border-neutral-700/40 p-2.5">
                                    <pre className="text-[11px] font-mono text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words">
                                      {argsParseFailed
                                        ? argsRaw
                                        : JSON.stringify(parsedArgs, null, 2)}
                                    </pre>
                                  </div>
                                </div>
                              )}

                              {outputs.length > 0 && (
                                <div className="space-y-1">
                                  <div className="text-xs font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wide">
                                    Output
                                  </div>
                                  <div className="space-y-2">
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
                                          className="rounded-md bg-slate-50 dark:bg-neutral-900/60 border border-slate-200/50 dark:border-neutral-700/40 p-2.5 max-h-64 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-neutral-600"
                                        >
                                          <pre className="text-[11px] font-mono text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words">
                                            {formatted}
                                          </pre>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              {!isEditing && (message.content || !isUser) && (
                <div className="mt-1 flex items-center justify-between opacity-70 group-hover:opacity-100 transition-opacity text-xs">
                  {/* Show stats for assistant messages */}
                  {!isUser && (
                    <div className="flex items-center gap-2">
                      {streamingStats && streamingStats.tokensPerSecond > 0 && (
                        <div className="px-2 py-1 rounded-md bg-white/60 dark:bg-neutral-800/50 text-slate-600 dark:text-slate-400 text-xs font-mono">
                          {streamingStats.tokensPerSecond.toFixed(1)} tok/s
                        </div>
                      )}
                      {message.usage && (
                        <div className="px-2 py-1 rounded-md bg-white/60 dark:bg-neutral-800/50 text-slate-600 dark:text-slate-400 text-xs font-mono flex items-center gap-2">
                          {message.usage.provider && (
                            <span className="font-medium">{message.usage.provider}</span>
                          )}
                          {(message.usage.prompt_tokens !== undefined ||
                            message.usage.completion_tokens !== undefined) && (
                            <span className="text-slate-500 dark:text-slate-500">•</span>
                          )}
                          {message.usage.prompt_tokens !== undefined &&
                            message.usage.completion_tokens !== undefined && (
                              <span>
                                {message.usage.prompt_tokens + message.usage.completion_tokens}{' '}
                                tokens ({message.usage.prompt_tokens}↑ +{' '}
                                {message.usage.completion_tokens}↓)
                              </span>
                            )}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    {message.content && (
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() =>
                            handleCopy(message.id, extractTextFromContent(message.content))
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
        {isUser && (
          <div className="w-8 h-8 rounded-full bg-slate-800 dark:bg-slate-700 flex items-center justify-center flex-shrink-0 shadow-sm">
            <UserIcon className="w-4 h-4 text-white" />
          </div>
        )}
      </div>
    );
  },
  (prev, next) => {
    // Only re-render if content changed or streaming state changed
    return (
      prev.message.content === next.message.content &&
      prev.message.tool_calls === next.message.tool_calls &&
      prev.message.tool_outputs === next.message.tool_outputs &&
      prev.message.usage === next.message.usage &&
      prev.isStreaming === next.isStreaming &&
      prev.editingMessageId === next.editingMessageId &&
      prev.editingContent === next.editingContent &&
      prev.pending.streaming === next.pending.streaming &&
      prev.collapsedToolOutputs === next.collapsedToolOutputs &&
      prev.copiedMessageId === next.copiedMessageId &&
      prev.streamingStats?.tokensPerSecond === next.streamingStats?.tokensPerSecond &&
      prev.editingImages === next.editingImages
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
}: MessageListProps) {
  // Debug logging
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const internalContainerRef = useRef<HTMLDivElement | null>(null);
  const containerRef = externalContainerRef || internalContainerRef;
  const editingTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lastUserMessageRef = useRef<HTMLDivElement | null>(null);
  const [collapsedToolOutputs, setCollapsedToolOutputs] = useState<Record<string, boolean>>({});
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [dynamicBottomPadding, setDynamicBottomPadding] = useState('8rem');

  // Streaming statistics - now calculated from actual token count
  const [streamingStats, setStreamingStats] = useState<{ tokensPerSecond: number } | null>(null);

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

  const scrollUserMessageToTop = () => {
    lastUserMessageRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  };

  // Update dynamic padding based on viewport height and streaming state
  useEffect(() => {
    const updatePadding = () => {
      const viewportHeight = window.innerHeight;

      // If we're about to start streaming, use 70% of viewport height for better UX
      if (pending.streaming && messages.length >= 2) {
        const lastMessage = messages[messages.length - 1];
        const secondLastMessage = messages[messages.length - 2];

        if (
          secondLastMessage?.role === 'user' &&
          lastMessage?.role === 'assistant' &&
          !lastMessage.content
        ) {
          setDynamicBottomPadding(`${Math.round(viewportHeight * 0.8)}px`);
          return;
        }
      }

      // Default padding - enough space for comfortable scrolling
      setDynamicBottomPadding(`${Math.round(viewportHeight * 0.2)}px`);
    };

    updatePadding();
    window.addEventListener('resize', updatePadding);

    return () => window.removeEventListener('resize', updatePadding);
  }, [pending.streaming, messages.length, messages]);

  useEffect(() => {
    // If we just started streaming, scroll user message to top for better UX
    if (pending.streaming && messages.length >= 2) {
      const lastMessage = messages[messages.length - 1];
      const secondLastMessage = messages[messages.length - 2];

      // If the pattern is user message followed by empty assistant message (streaming start)
      if (
        secondLastMessage?.role === 'user' &&
        lastMessage?.role === 'assistant' &&
        !lastMessage.content
      ) {
        // Small delay to ensure DOM is updated
        setTimeout(() => scrollUserMessageToTop(), 50);
        return;
      }
    }
  }, [messages.length, pending.streaming, pending.abort, messages]);

  // When editing content changes (including on initial edit open), resize the textarea
  useEffect(() => {
    resizeEditingTextarea();
  }, [editingContent, editingMessageId]);

  // Track streaming statistics using actual token count
  useEffect(() => {
    if (!pending.tokenStats) {
      setStreamingStats(null);
      return;
    }

    const { count, startTime } = pending.tokenStats;

    // Calculate tokens per second from actual token count
    const elapsedSeconds = (Date.now() - startTime) / 1000;
    if (elapsedSeconds > 0.1 && count > 0) {
      // Only show after 100ms and at least 1 token
      const tokensPerSecond = count / elapsedSeconds;
      setStreamingStats({ tokensPerSecond });
    }
  }, [pending.tokenStats]);

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
      className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-neutral-700 scrollbar-track-transparent relative"
      style={{ willChange: 'scroll-position' }}
    >
      <div
        className="mx-auto max-w-4xl px-6 py-6 space-y-6"
        style={{ paddingBottom: dynamicBottomPadding }}
      >
        {messages.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-300 dark:border-neutral-700 bg-gradient-to-br from-white/80 to-slate-50/80 dark:from-neutral-900/80 dark:to-neutral-800/80 p-8 text-center backdrop-blur-sm shadow-sm">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-slate-200 dark:bg-neutral-800 flex items-center justify-center shadow-lg">
              <MessageSquareText className="w-8 h-8 text-slate-700 dark:text-slate-200" />
            </div>
            <div className="font-semibold text-lg text-slate-800 dark:text-slate-200 mb-2">
              Welcome to Chat
            </div>
            <div className="text-slate-600 dark:text-slate-400">
              Ask a question or start a conversation to get started.
            </div>
          </div>
        )}
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
