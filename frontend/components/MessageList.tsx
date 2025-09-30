import { useEffect, useRef, useState } from 'react';
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
  ChevronDown
} from 'lucide-react';
import Markdown from './Markdown';
import type { ChatMessage } from '../lib/chat';
import type { PendingState } from '../hooks/useChatState';

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
  onApplyLocalEdit: () => void;
  onEditingContentChange: (content: string) => void;
  onRetryMessage: (messageId: string) => void;
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
    if (message.content) {
      return [{ kind: 'text', text: message.content }];
    }
    return [];
  }

  const content = message.content || '';
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
  const hasValidTextOffset = toolCalls.some((call: any) =>
    typeof call?.textOffset === 'number' && Number.isFinite(call.textOffset) && call.textOffset > 0
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
      segments.push({ kind: 'tool_call', toolCall: entry.call, outputs: resolveOutputs(entry.call) });
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
      const offset = typeof call?.textOffset === 'number' && Number.isFinite(call.textOffset)
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

export function MessageList({
  messages,
  pending,
  conversationId,
  editingMessageId,
  editingContent,
  onCopy,
  onEditMessage,
  onCancelEdit,
  onSaveEdit,
  onApplyLocalEdit,
  onEditingContentChange,
  onRetryMessage
}: MessageListProps) {
  // Debug logging
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const editingTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lastUserMessageRef = useRef<HTMLDivElement | null>(null);
  const [collapsedToolOutputs, setCollapsedToolOutputs] = useState<Record<string, boolean>>({});
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [dynamicBottomPadding, setDynamicBottomPadding] = useState('8rem');

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
      block: 'start'
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

        if (secondLastMessage?.role === 'user' && lastMessage?.role === 'assistant' && !lastMessage.content) {
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
  }, [pending.streaming, messages.length]);

  useEffect(() => {
    // If we just started streaming, scroll user message to top for better UX
    if (pending.streaming && messages.length >= 2) {
      const lastMessage = messages[messages.length - 1];
      const secondLastMessage = messages[messages.length - 2];

      // If the pattern is user message followed by empty assistant message (streaming start)
      if (secondLastMessage?.role === 'user' && lastMessage?.role === 'assistant' && !lastMessage.content) {
        // Small delay to ensure DOM is updated
        setTimeout(() => scrollUserMessageToTop(), 50);
        return;
      }
    }
  }, [messages.length, pending.streaming, pending.abort]);

  // When editing content changes (including on initial edit open), resize the textarea
  useEffect(() => {
    resizeEditingTextarea();
  }, [editingContent, editingMessageId]);

  // Split messages with tool calls into separate messages
  const processedMessages = splitMessagesWithToolCalls(messages);

  return (
    <main className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-neutral-700 scrollbar-track-transparent">
      <div
        className="mx-auto max-w-4xl px-6 py-6 space-y-6"
        style={{ paddingBottom: dynamicBottomPadding }}
      >
        {messages.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-300 dark:border-neutral-700 bg-gradient-to-br from-white/80 to-slate-50/80 dark:from-neutral-900/80 dark:to-neutral-800/80 p-8 text-center backdrop-blur-sm shadow-sm">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-slate-200 dark:bg-neutral-800 flex items-center justify-center shadow-lg">
              <MessageSquareText className="w-8 h-8 text-slate-700 dark:text-slate-200" />
            </div>
            <div className="font-semibold text-lg text-slate-800 dark:text-slate-200 mb-2">Welcome to Chat</div>
            <div className="text-slate-600 dark:text-slate-400">Ask a question or start a conversation to get started.</div>
          </div>
        )}
        {processedMessages.map((m, idx) => {
          const isUser = m.role === 'user';
          const isEditing = editingMessageId === m.id;
          const editTextareaClass = isUser
            ? 'w-full min-h-[100px] rounded-2xl px-4 py-3 text-base leading-relaxed shadow-sm bg-slate-100 text-black dark:bg-slate-700 dark:text-white border border-slate-200/50 dark:border-neutral-700/50 focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-vertical'
            : 'w-full min-h-[100px] rounded-2xl px-4 py-3 text-base leading-relaxed shadow-sm bg-white dark:bg-neutral-900 text-slate-800 dark:text-slate-200 border border-slate-200/50 dark:border-neutral-700/50 focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-vertical';
          // Set ref to the most recent user message (could be last or second-to-last)
          const isRecentUserMessage = isUser && (
            idx === processedMessages.length - 1 || // last message is user
            (idx === processedMessages.length - 2 && processedMessages[processedMessages.length - 1]?.role === 'assistant') // second-to-last is user, last is assistant
          );
          const assistantSegments = !isUser ? buildAssistantSegments(m) : [];
          return (
            <div
              key={m.id}
              className={`flex gap-4 ${isUser ? 'justify-end' : 'justify-start'}`}
              ref={isRecentUserMessage ? lastUserMessageRef : null}
            >
              {!isUser && (
                <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-neutral-800 flex items-center justify-center flex-shrink-0 shadow-sm">
                  <Bot className="w-4 h-4 text-slate-700 dark:text-slate-200" />
                </div>
              )}
              <div className={`group relative ${isEditing ? 'w-full' : ''} ${isUser ? 'max-w-[50%] order-first' : 'max-w-[95%]'}`}>
                {isEditing ? (
                  <div className="space-y-2">
                    <textarea
                            ref={editingTextareaRef}
                            value={editingContent}
                            onChange={(e) => onEditingContentChange(e.target.value)}
                            onInput={resizeEditingTextarea}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                                e.preventDefault();
                                onApplyLocalEdit();
                              }
                            }}
                            className={editTextareaClass}
                            placeholder="Edit your message..."
                            // hide native scrollbar - we'll size the textarea to fit
                            style={{ overflow: 'hidden' }}
                    />
                    <div className="flex gap-2 text-right justify-end">
                    <button
                        onClick={onCancelEdit}
                        className="px-3 py-1.5 text-xs rounded-lg bg-slate-200 hover:bg-slate-300 dark:bg-neutral-700 dark:hover:bg-neutral-600 text-slate-700 dark:text-slate-300 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={onApplyLocalEdit}
                        disabled={!editingContent.trim()}
                        className="px-3 py-1.5 text-xs rounded-lg bg-slate-600 hover:bg-slate-700 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {isUser ? (
                      <div className="rounded-2xl px-4 py-3 text-base leading-relaxed shadow-sm bg-slate-100 text-black dark:bg-slate-700 dark:text-white">
                        {m.content ? <Markdown text={m.content} /> : null}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {assistantSegments.length === 0 ? (
                          <div className="rounded-2xl px-4 py-3 text-base leading-relaxed shadow-sm bg-white dark:bg-neutral-900 text-slate-800 dark:text-slate-200 border border-slate-200/50 dark:border-neutral-700/50">
                            {pending.streaming || pending.abort ? (
                              <span className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400">
                                <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: '0ms' }} />
                                <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: '150ms' }} />
                                <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: '300ms' }} />
                              </span>
                            ) : (
                              <span className="text-slate-500 dark:text-slate-400 italic">No response content</span>
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
                                  <Markdown text={segment.text} />
                                </div>
                              );
                            }

                            const { toolCall, outputs } = segment;
                            const toolName = toolCall.function?.name;
                            let parsedArgs = {};
                            try {
                              parsedArgs = typeof toolCall.function?.arguments === 'string'
                                ? JSON.parse(toolCall.function.arguments)
                                : toolCall.function?.arguments || {};
                            } catch (e) {
                              parsedArgs = {};
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

                            const toggleKey = `${m.id}-${toolCall.id ?? segmentIndex}`;
                            const isCollapsed = collapsedToolOutputs[toggleKey] ?? true;

                            // Extract a clean summary from outputs
                            const getOutputSummary = (outputs: ToolOutput[]) => {
                              if (!outputs || outputs.length === 0) return null;

                              const firstOutput = outputs[0];
                              const raw = firstOutput.output ?? firstOutput;

                              if (typeof raw === 'string') {
                                // Clean up the string - remove excessive whitespace, limit length
                                const cleaned = raw.trim().replace(/\s+/g, ' ');
                                return cleaned.length > 80 ? cleaned.slice(0, 77) + '...' : cleaned;
                              }

                              if (typeof raw === 'object' && raw !== null) {
                                // Try to extract meaningful fields
                                if ('result' in raw) return String(raw.result).slice(0, 80);
                                if ('message' in raw) return String(raw.message).slice(0, 80);
                                if ('data' in raw && typeof raw.data === 'string') return raw.data.slice(0, 80);
                                // If it's an array or complex object, just indicate success
                                return 'Completed successfully';
                              }

                              return null;
                            };

                            const outputSummary = getOutputSummary(outputs);
                            const hasDetails = outputs.length > 0 || Object.keys(parsedArgs).length > 0;

                            return (
                              <div
                                key={`tool-${segmentIndex}`}
                                className="inline-block min-w-fit max-w-[75%] rounded-lg bg-gradient-to-br from-blue-50/80 to-indigo-50/60 dark:from-blue-950/30 dark:to-indigo-950/20 border border-blue-200/60 dark:border-blue-800/40 shadow-sm hover:shadow-md transition-all duration-200"
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
                                            setCollapsedToolOutputs((s) => ({ ...s, [toggleKey]: !isCollapsed }));
                                          }}
                                        >
                                          {isCollapsed ? 'Details' : 'Hide'}
                                          <ChevronDown className={`w-3 h-3 transition-transform ${isCollapsed ? '' : 'rotate-180'}`} />
                                        </button>
                                      )}
                                    </div>
                                    {outputSummary && (
                                      <div className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                                        {outputSummary}
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {hasDetails && !isCollapsed && (
                                  <div className="px-4 pb-3 pt-1 space-y-3 border-t border-blue-200/40 dark:border-blue-800/30 bg-white/40 dark:bg-blue-950/20 rounded-b-lg">
                                    {Object.keys(parsedArgs).length > 0 && (
                                      <div className="space-y-1">
                                        <div className="text-xs font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wide">
                                          Input
                                        </div>
                                        <div className="rounded-md bg-slate-50 dark:bg-neutral-900/60 border border-slate-200/50 dark:border-neutral-700/40 p-2.5">
                                          <pre className="text-[11px] font-mono text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words">
                                            {JSON.stringify(parsedArgs, null, 2)}
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
                                          {outputs.map((out, outIdx) => {
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

                    {/* Toolbar below the chat bubble (transparent) */}
                    {!isEditing && (m.content || !isUser) && (
                      <div className="mt-1 flex items-center gap-2 opacity-70 group-hover:opacity-100 transition-all text-xs justify-end">
                        {m.content && (
                          <div className="relative">
                            <button
                              type="button"
                              onClick={() => handleCopy(m.id, m.content)}
                              title="Copy"
                              className="p-2 rounded-md bg-white/60 dark:bg-neutral-800/50 hover:bg-white/90 dark:hover:bg-neutral-700/80 text-slate-700 dark:text-slate-200 cursor-pointer transition-colors"
                            >
                              <Copy className="w-3 h-3" aria-hidden="true" />
                              <span className="sr-only">Copy</span>
                            </button>
                            {copiedMessageId === m.id && (
                              <div className="absolute bottom-full mb-1 left-1/2 transform -translate-x-1/2 bg-slate-800 dark:bg-slate-700 text-white text-xs px-2 py-1 rounded whitespace-nowrap z-10 animate-fade-in">
                                Copied
                                <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-2 border-r-2 border-t-2 border-transparent border-t-slate-800 dark:border-t-slate-700"></div>
                              </div>
                            )}
                          </div>
                        )}

                        {isUser ? (
                          m.content && (
                            <button
                              type="button"
                              onClick={() => onEditMessage(m.id, m.content)}
                              title="Edit"
                              className="p-2 rounded-md bg-white/20 dark:bg-neutral-800/30 hover:bg-white/60 dark:hover:bg-neutral-700/70 text-slate-700 dark:text-slate-200 cursor-pointer transition-colors"
                            >
                              <Edit2 className="w-3 h-3" aria-hidden="true" />
                              <span className="sr-only">Edit</span>
                            </button>
                          )
                        ) : (
                          !pending.streaming && (
                            <button
                              type="button"
                              onClick={() => onRetryMessage(m.id)}
                              title="Regenerate"
                              className="p-2 rounded-md bg-white/20 dark:bg-neutral-800/30 hover:bg-white/60 dark:hover:bg-neutral-700/70 text-slate-700 dark:text-slate-200 cursor-pointer transition-colors"
                            >
                              <RefreshCw className="w-3 h-3" aria-hidden="true" />
                              <span className="sr-only">Regenerate</span>
                            </button>
                          )
                        )}
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
