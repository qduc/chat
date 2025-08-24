import { useEffect, useRef } from 'react';
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

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  };
  
  useEffect(() => {
    scrollToBottom();
  }, [messages.length, pending.streaming]);

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
        {messages.map((m) => {
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
                    <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm ${isUser ? 'bg-slate-100 text-black dark:bg-slate-700 dark:text-white' : 'bg-white dark:bg-neutral-900 text-slate-800 dark:text-slate-200 border border-slate-200/50 dark:border-neutral-700/50'}`}>
                      {m.role === 'assistant' && m.tool_calls ? (
                        <div className="space-y-2">
                          {m.tool_calls.map((toolCall, index) => (
                            <div key={index} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 dark:bg-neutral-800/50 border border-slate-200 dark:border-neutral-700/50">
                              <span className="w-5 h-5 flex items-center justify-center">
                                <svg className="w-4 h-4 text-slate-500 dark:text-slate-400 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h5M20 20v-5h-5" />
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 12a8 8 0 018-8v0a8 8 0 018 8v0a8 8 0 01-8 8v0a8 8 0 01-8-8v0z" />
                                </svg>
                              </span>
                              <span className="font-mono text-xs text-slate-600 dark:text-slate-300">
                                {toolCall.function.name}({toolCall.function.arguments})
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : m.content ? (
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
                    {isUser && m.content && conversationId && (
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