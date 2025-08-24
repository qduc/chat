import { useEffect, useRef, useState } from 'react';
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
  onEditingContentChange: (content: string) => void;
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
  onEditingContentChange
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [collapsedToolOutputs, setCollapsedToolOutputs] = useState<Record<string, boolean>>({});

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages.length, pending.streaming]);

  // Split messages with tool calls into separate messages
  const processedMessages = splitMessagesWithToolCalls(messages);

  return (
    <main className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-neutral-700 scrollbar-track-transparent">
      <div className="mx-auto max-w-4xl px-6 py-6 pb-32 space-y-6">
        {messages.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-300 dark:border-neutral-700 bg-gradient-to-br from-white/80 to-slate-50/80 dark:from-neutral-900/80 dark:to-neutral-800/80 p-8 text-center backdrop-blur-sm shadow-sm">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-slate-200 dark:bg-neutral-800 flex items-center justify-center shadow-lg">
              <svg className="w-8 h-8 text-slate-700 dark:text-slate-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <div className="font-semibold text-lg text-slate-800 dark:text-slate-200 mb-2">Welcome to Chat</div>
            <div className="text-slate-600 dark:text-slate-400">Ask a question or start a conversation to get started.</div>
          </div>
        )}
        {processedMessages.map((m) => {
          const isUser = m.role === 'user';
          const isEditing = editingMessageId === m.id;
          return (
            <div key={m.id} className={`flex gap-4 ${isUser ? 'justify-end' : 'justify-start'}`}>
              {!isUser && (
                <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-neutral-800 flex items-center justify-center flex-shrink-0 shadow-sm">
                  <svg className="w-4 h-4 text-slate-700 dark:text-slate-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
              )}
              <div className={`group relative max-w-[75%] ${isUser ? 'order-first' : ''}`}>
                {isEditing ? (
                  <div className="space-y-2">
                    <textarea
                      value={editingContent}
                      onChange={(e) => onEditingContentChange(e.target.value)}
                      className="w-full min-h-[100px] rounded-xl px-4 py-3 text-sm bg-slate-50 dark:bg-neutral-800 border border-slate-200 dark:border-neutral-700 text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-vertical"
                      placeholder="Edit your message..."
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={onSaveEdit}
                        disabled={!editingContent.trim()}
                        className="px-3 py-1.5 text-xs rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        Save & Fork
                      </button>
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
                                return (
                                  <svg className="w-4 h-4 text-blue-500 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                  </svg>
                                );
                              case 'web_search':
                                return (
                                  <svg className="w-4 h-4 text-green-500 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                  </svg>
                                );
                              default:
                                return (
                                  <svg className="w-4 h-4 text-slate-500 dark:text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                  </svg>
                                );
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
                            <div key={index} className="space-y-2">
                              <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-gradient-to-r from-slate-50 to-slate-100/50 dark:from-neutral-800/50 dark:to-neutral-700/30 border border-slate-200 dark:border-neutral-700/50 shadow-sm">
                                  <div className="flex items-center gap-2">
                                    <div className="w-6 h-6 flex items-center justify-center rounded-full bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-600 shadow-sm">
                                      {getToolIcon(toolName)}
                                    </div>
                                    <span className="font-medium text-sm text-slate-700 dark:text-slate-300 capitalize">
                                      {toolName?.replace('_', ' ')}
                                    </span>
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
                              </div>

                              {outputs.length > 0 && (
                                <div className="px-4">
                                  <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
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
                                    <div className="mt-2 space-y-2">
                                      {outputs.map((out, outIdx) => {
                                        const raw = out.output ?? out;
                                        let formatted = '';
                                        if (typeof raw === 'string') formatted = raw;
                                        else {
                                          try { formatted = JSON.stringify(raw, null, 2); } catch { formatted = String(raw); }
                                        }
                                        return (
                                          <div key={outIdx} className="mt-1 rounded-md bg-slate-50 dark:bg-neutral-800 border border-slate-200/50 dark:border-neutral-700/30 p-3 text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap">
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
                      ) : (m.role === 'assistant' && pending.streaming ? (
                        <span className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: '0ms' }} />
                          <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: '150ms' }} />
                          <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: '300ms' }} />
                        </span>
                      ) : null)}
                    </div>
                    {!isUser && m.content && (
                      <button
                        type="button"
                        onClick={() => onCopy(m.content)}
                        className="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 text-xs px-2 py-1 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-slate-600 dark:text-slate-400 transition-all duration-200 shadow-sm"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      </button>
                    )}
                    {isUser && m.content && conversationId && !m.id.includes('-') && (
                      <button
                        type="button"
                        onClick={() => onEditMessage(m.id, m.content)}
                        className="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 text-xs px-2 py-1 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-slate-600 dark:text-slate-400 transition-all duration-200 shadow-sm"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                    )}
                  </>
                )}
              </div>
              {isUser && (
                <div className="w-8 h-8 rounded-full bg-slate-800 dark:bg-slate-700 flex items-center justify-center flex-shrink-0 shadow-sm">
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
              )}
            </div>
          );
        })}
        {pending.error && (
          <div className="flex items-start gap-3 text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded-xl px-4 py-3 shadow-sm">
            <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
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