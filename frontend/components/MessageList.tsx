import { useEffect, useRef, useState } from 'react';
import { Bot, User as UserIcon, MessageSquareText, Clock, Search, Zap, Copy, Edit2, RefreshCw, AlertCircle } from 'lucide-react';
import Markdown from './Markdown';
import type { ChatMessage } from '../lib/chat';
import type { PendingState } from '../hooks/useChatStream';

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
  onRetryLastAssistant: () => void;
}

// Helper function to split messages with tool calls into separate messages
function splitMessagesWithToolCalls(messages: ChatMessage[]): ChatMessage[] {
  // Keep original message shape and avoid splitting tool calls into separate messages.
  // We render tool calls and any tool outputs inside the same assistant bubble below.
  return messages;
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
  onRetryLastAssistant
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const editingTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [collapsedToolOutputs, setCollapsedToolOutputs] = useState<Record<string, boolean>>({});

  // Resize the editing textarea to fit its content
  const resizeEditingTextarea = () => {
    const ta = editingTextareaRef.current;
    if (!ta) return;
    // Reset height to allow shrinking, then set to scrollHeight to fit content
    ta.style.height = 'auto';
    // Use scrollHeight + 2px to avoid clipping in some browsers
    ta.style.height = `${ta.scrollHeight + 2}px`;
  };

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages.length, pending.streaming, pending.abort]);

  // When editing content changes (including on initial edit open), resize the textarea
  useEffect(() => {
    resizeEditingTextarea();
  }, [editingContent, editingMessageId]);

  // Split messages with tool calls into separate messages
  const processedMessages = splitMessagesWithToolCalls(messages);

  return (
    <main className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-neutral-700 scrollbar-track-transparent">
      <div className="mx-auto max-w-4xl px-6 py-6 pb-32 space-y-6">
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
            ? 'w-full min-h-[100px] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm bg-slate-100 text-black dark:bg-slate-700 dark:text-white border border-slate-200/50 dark:border-neutral-700/50 focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-vertical'
            : 'w-full min-h-[100px] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm bg-white dark:bg-neutral-900 text-slate-800 dark:text-slate-200 border border-slate-200/50 dark:border-neutral-700/50 focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-vertical';
          const isLastAssistant = !isUser && idx === processedMessages.length - 1;
          return (
            <div key={m.id} className={`flex gap-4 ${isUser ? 'justify-end' : 'justify-start'}`}>
              {!isUser && (
                <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-neutral-800 flex items-center justify-center flex-shrink-0 shadow-sm">
                  <Bot className="w-4 h-4 text-slate-700 dark:text-slate-200" />
                </div>
              )}
              <div className={`group relative max-w-[75%] ${isUser ? 'order-first' : ''}`}>
                {isEditing ? (
                  <div className="space-y-2">
                    <textarea
                            ref={editingTextareaRef}
                            value={editingContent}
                            onChange={(e) => onEditingContentChange(e.target.value)}
                            onInput={resizeEditingTextarea}
                            className={editTextareaClass}
                            placeholder="Edit your message..."
                            // hide native scrollbar - we'll size the textarea to fit
                            style={{ overflow: 'hidden' }}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={onSaveEdit}
                        disabled={!editingContent.trim() || !conversationId || (editingMessageId ? editingMessageId.includes('-') : false)}
                        title={!conversationId ? 'Save & Fork requires a saved conversation' : (editingMessageId && editingMessageId.includes('-') ? 'Only messages from saved history can be edited' : undefined)}
                        className="px-3 py-1.5 text-xs rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        Save
                      </button>
                      {(!conversationId || (editingMessageId ? editingMessageId.includes('-') : false)) && (
                        <button
                          onClick={onApplyLocalEdit}
                          disabled={!editingContent.trim()}
                          className="px-3 py-1.5 text-xs rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                          Apply Edit
                        </button>
                      )}
                      <button
                        onClick={onCancelEdit}
                        className="px-3 py-1.5 text-xs rounded-lg bg-slate-200 hover:bg-slate-300 dark:bg-neutral-700 dark:hover:bg-neutral-600 text-slate-700 dark:text-slate-300 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Render any tool calls (and their outputs) first, then the content in the same bubble */}
                    {m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0 && (
                      <div className="space-y-2">
                        {m.tool_calls.map((toolCall, index) => {
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
                                return <Clock className="w-4 h-4 text-blue-500 dark:text-blue-400" />;
                              case 'web_search':
                                return <Search className="w-4 h-4 text-green-500 dark:text-green-400" />;
                              default:
                                return <Zap className="w-4 h-4 text-slate-500 dark:text-slate-400" />;
                            }
                          };

                          // Match outputs for this tool call if any
                          const outputs = Array.isArray(m.tool_outputs)
                            ? m.tool_outputs.filter((o) => {
                                if (!o) return false;
                                if (o.tool_call_id && toolCall.id) return o.tool_call_id === toolCall.id;
                                if (o.name && toolName) return o.name === toolName;
                                return false;
                              })
                            : [];

                          const toggleKey = `${m.id}-${toolCall.id ?? index}`;
                          const isCollapsed = collapsedToolOutputs[toggleKey] ?? true;

                          return (
                            <div key={index} className="rounded-lg bg-gradient-to-r from-slate-50 to-slate-100/50 dark:from-neutral-800/50 dark:to-neutral-700/30 border border-slate-200 dark:border-neutral-700/50 shadow-sm mb-4">
                              <div className="flex items-start gap-3 px-4 py-3">
                                  <div className="w-6 h-6 flex items-center justify-center rounded-full bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-600 shadow-sm">
                                    {getToolIcon(toolName)}
                                  </div>
                                  {(() => {
                                    try {
                                      const txt = JSON.stringify(parsedArgs);
                                      if (!txt || txt === '{}' || txt === 'null' || txt === 'undefined') return null;
                                      const short = txt.length > 140 ? txt.slice(0, 137) + '...' : txt;
                                      return (
                                        <span className="ml-2 text-[11px] font-mono text-slate-600 dark:text-slate-400 bg-white/70 dark:bg-neutral-800/70 border border-slate-200/60 dark:border-neutral-700/60 px-2 py-0.5 rounded">
                                          {short}
                                        </span>
                                      );
                                    } catch {
                                      return null;
                                    }
                                  })()}
                                </div>

                              {outputs.length > 0 && (
                                <div className="px-4 pb-3">
                                  <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400 mb-2">
                                    <div>{outputs.length} result{outputs.length > 1 ? 's' : ''}</div>
                                    <button
                                      aria-expanded={!isCollapsed}
                                      onClick={() => setCollapsedToolOutputs((s) => ({ ...s, [toggleKey]: !isCollapsed }))}
                                      className="px-2 py-1 rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-slate-600 dark:text-slate-300"
                                    >
                                      {isCollapsed ? 'Show' : 'Hide'}
                                    </button>
                                  </div>

                                  {!isCollapsed && (
                                    <div className="space-y-2">
                                      {outputs.map((out, outIdx) => {
                                        const raw = out.output ?? out;
                                        let formatted = '';
                                        if (typeof raw === 'string') formatted = raw;
                                        else {
                                          try { formatted = JSON.stringify(raw, null, 2); } catch { formatted = String(raw); }
                                        }
                                        return (
                                          <div key={outIdx} className="rounded-md bg-white/80 dark:bg-neutral-900/80 border border-slate-200/50 dark:border-neutral-700/30 p-3 text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap">
                                            {formatted}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Handle content (if any) */}
                    <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm ${isUser ? 'bg-slate-100 text-black dark:bg-slate-700 dark:text-white' : 'bg-white dark:bg-neutral-900 text-slate-800 dark:text-slate-200 border border-slate-200/50 dark:border-neutral-700/50'}`}>
                      {/* Assistant content or typing indicator */}
                      {m.content ? (
                        <Markdown text={m.content} />
                      ) : (m.role === 'assistant' && (pending.streaming || pending.abort) ? (
                        <span className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: '0ms' }} />
                          <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: '150ms' }} />
                          <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: '300ms' }} />
                        </span>
                      ) : null)}
                    </div>

                    {/* Toolbar below the chat bubble (transparent) */}
                    {!isEditing && m.content && (
                      <div className="mt-1 flex items-center gap-2 opacity-70 group-hover:opacity-100 transition-all text-xs justify-end">
                        <button
                          type="button"
                          onClick={() => onCopy(m.content)}
                          title="Copy"
                          className="p-2 rounded-md bg-white/60 dark:bg-neutral-800/50 hover:bg-white/70 dark:hover:bg-neutral-700/60 text-slate-700 dark:text-slate-200"
                        >
                          <Copy className="w-3 h-3" aria-hidden="true" />
                          <span className="sr-only">Copy</span>
                        </button>

                        {isUser ? (
                          <button
                            type="button"
                            onClick={() => onEditMessage(m.id, m.content)}
                            title="Edit"
                            className="p-2 rounded-md bg-white/20 dark:bg-neutral-800/30 hover:bg-white/30 dark:hover:bg-neutral-700/40 text-slate-700 dark:text-slate-200"
                          >
                            <Edit2 className="w-3 h-3" aria-hidden="true" />
                            <span className="sr-only">Edit</span>
                          </button>
                        ) : (
                          (isLastAssistant && !pending.streaming) && (
                            <button
                              type="button"
                              onClick={onRetryLastAssistant}
                              title="Regenerate"
                              className="p-2 rounded-md bg-white/20 dark:bg-neutral-800/30 hover:bg-white/30 dark:hover:bg-neutral-700/40 text-slate-700 dark:text-slate-200"
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
          <div className="flex items-start gap-3 text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded-xl px-4 py-3 shadow-sm">
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
