"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import Markdown from './Markdown';
import type { ChatMessage, ConversationsList, ConversationMeta, Role } from '../lib/chat';
import { sendChat, createConversation, listConversationsApi, getConversationApi, deleteConversationApi } from '../lib/chat';

interface PendingState {
  abort?: AbortController;
  streaming: boolean;
  error?: string;
}

export function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [model, setModel] = useState<string>('gpt-4.1-mini');
  const [pending, setPending] = useState<PendingState>({ streaming: false });
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [historyEnabled, setHistoryEnabled] = useState<boolean>(true);
  const [convos, setConvos] = useState<ConversationMeta[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingConvos, setLoadingConvos] = useState<boolean>(false);
  const assistantRef = useRef<string>('');
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  };
  useEffect(scrollToBottom, [messages.length, pending.streaming, input]);

  // Auto-grow textarea up to ~200px
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const next = Math.min(200, el.scrollHeight);
    el.style.height = `${next}px`;
  }, [input]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || pending.streaming) return;
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: input.trim() };
    setMessages(m => [...m, userMsg]);
    setInput('');

    const abort = new AbortController();
    assistantRef.current = '';
    const assistantMsg: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', content: '' };
    setMessages(m => [...m, assistantMsg]);
    setPending({ streaming: true, abort });
    try {
      await sendChat({
        messages: [...messages, userMsg].map(m => ({ role: m.role as Role, content: m.content })),
        model,
        signal: abort.signal,
        conversationId: conversationId || undefined,
        onToken: (t) => {
          assistantRef.current += t;
          setMessages(curr => curr.map(msg => msg.id === assistantMsg.id ? { ...msg, content: assistantRef.current } : msg));
        }
      });
    } catch (e:any) {
      setPending(p => ({ ...p, error: e.message }));
      setMessages(curr => curr.map(msg => msg.id === assistantMsg.id ? { ...msg, content: msg.content + `\n[error: ${e.message}]` } : msg));
    } finally {
      setPending({ streaming: false });
    }
  }, [input, pending.streaming, messages, model, conversationId]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleStop = () => pending.abort?.abort();

  const handleNewChat = useCallback(async () => {
    if (pending.streaming) pending.abort?.abort();
    setMessages([]);
    setPending({ streaming: false });
    assistantRef.current = '';
    setInput('');
    if (historyEnabled) {
      try {
        const convo = await createConversation(undefined, { model });
        setConversationId(convo.id);
        // Prepend to convos list
        setConvos(prev => [{ id: convo.id, title: convo.title || 'New chat', model: convo.model, created_at: convo.created_at }, ...prev]);
      } catch (e:any) {
        if (e.status === 501) setHistoryEnabled(false);
      }
    } else {
      setConversationId(null);
    }
  }, [pending.streaming, historyEnabled, model]);

  const handleCopy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {}
  }, []);

  // Load initial conversations to detect history support
  useEffect(() => {
    (async () => {
      try {
        setLoadingConvos(true);
        const list = await listConversationsApi(undefined, { limit: 20 });
        setConvos(list.items);
        setNextCursor(list.next_cursor);
        setHistoryEnabled(true);
      } catch (e: any) {
        if (e.status === 501) {
          setHistoryEnabled(false);
        }
      } finally {
        setLoadingConvos(false);
      }
    })();
  }, []);

  // Select conversation
  const selectConversation = useCallback(async (id: string) => {
    if (pending.streaming) pending.abort?.abort();
    setConversationId(id);
    setMessages([]);
    assistantRef.current = '';
    setPending({ streaming: false });
    try {
      const data = await getConversationApi(undefined, id, { limit: 200 });
      const msgs: ChatMessage[] = data.messages.map(m => ({ id: String(m.id), role: m.role as Role, content: m.content || '' }));
      setMessages(msgs);
    } catch (e: any) {
      // ignore
    }
  }, [pending.streaming]);

  const loadMoreConversations = useCallback(async () => {
    if (!nextCursor || loadingConvos) return;
    setLoadingConvos(true);
    try {
      const list = await listConversationsApi(undefined, { cursor: nextCursor, limit: 20 });
      setConvos(prev => [...prev, ...list.items]);
      setNextCursor(list.next_cursor);
    } catch (e:any) {
      // ignore
    } finally {
      setLoadingConvos(false);
    }
  }, [nextCursor, loadingConvos]);

  const deleteConversation = useCallback(async (id: string) => {
    try {
      await deleteConversationApi(undefined, id);
      setConvos(prev => prev.filter(c => c.id !== id));
      if (conversationId === id) {
        setConversationId(null);
        setMessages([]);
      }
    } catch(e:any) {
      // ignore
    }
  }, [conversationId]);

  return (
  <div className="flex h-dvh max-h-dvh bg-gradient-to-br from-slate-50 via-white to-slate-100/40 dark:from-neutral-950 dark:via-neutral-950 dark:to-neutral-900/20">
      {historyEnabled && (
  <aside className="w-72 p-4 flex flex-col border-r border-slate-200/60 dark:border-neutral-800/60 bg-white/40 dark:bg-neutral-950/40 backdrop-blur-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">Chat History</div>
            <button
              className="text-xs px-3 py-1.5 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-slate-600 dark:text-slate-400 transition-colors duration-200"
              onClick={() => { setConvos([]); setNextCursor(null); (async()=>{ try { const list = await listConversationsApi(undefined, { limit: 20 }); setConvos(list.items); setNextCursor(list.next_cursor);} catch(e:any){ if (e.status===501) setHistoryEnabled(false);} })(); }}
            >↻ Refresh</button>
          </div>
          <div className="flex-1 overflow-y-auto space-y-2 scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-neutral-700 scrollbar-track-transparent">
            {convos.map(c => (
              <div key={c.id} className={`group flex items-center gap-2 text-sm p-3 rounded-lg transition-all duration-200 hover:shadow-sm ${conversationId===c.id ? 'bg-slate-100 dark:bg-neutral-900/40 border border-slate-200/50 dark:border-neutral-700/50 shadow-sm' : 'bg-white/60 dark:bg-neutral-900/60 hover:bg-white/80 dark:hover:bg-neutral-900/80 border border-transparent'}`}>
                <div className="w-2 h-2 rounded-full bg-slate-300 dark:bg-slate-600 group-hover:bg-slate-500 dark:group-hover:bg-slate-400 transition-colors duration-200"></div>
                <button className="flex-1 text-left truncate text-slate-700 dark:text-slate-300" onClick={() => selectConversation(c.id)} title={c.title || c.id}>
                  {c.title || 'Untitled conversation'}
                </button>
                <button className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-all duration-200 p-1 hover:bg-slate-100 dark:hover:bg-neutral-900/30 rounded" title="Delete conversation" onClick={() => deleteConversation(c.id)}>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            ))}
            {convos.length === 0 && !loadingConvos && (
              <div className="text-sm text-slate-500 dark:text-slate-400 text-center py-8 bg-white/40 dark:bg-neutral-900/40 rounded-lg border border-dashed border-slate-300 dark:border-neutral-700">
                <div className="mb-2">💬</div>
                <div>No conversations yet</div>
              </div>
            )}
          </div>
          <div className="mt-4 pt-4 border-t border-slate-200/60 dark:border-neutral-800/60">
            {nextCursor && (
              <button className="w-full text-sm px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-slate-700 dark:text-slate-300 transition-colors duration-200 disabled:opacity-50" onClick={loadMoreConversations} disabled={loadingConvos}>
                {loadingConvos ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="m4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Loading...
                  </span>
                ) : 'Load more conversations'}
              </button>
            )}
          </div>
        </aside>
      )}
      <div className="flex flex-col flex-1">
        <header className="sticky top-0 z-10 border-b border-slate-200/60 dark:border-neutral-800/60 bg-white/80 dark:bg-neutral-950/80 backdrop-blur-md supports-[backdrop-filter]:bg-white/70 dark:supports-[backdrop-filter]:bg-neutral-950/70 shadow-sm">
          <div className="mx-auto max-w-4xl px-6 py-4 flex items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-slate-200 dark:bg-neutral-800 flex items-center justify-center shadow-sm">
                <svg className="w-4 h-4 text-slate-700 dark:text-slate-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <h1 className="font-semibold text-xl text-slate-800 dark:text-slate-200">Chat</h1>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                <span>Model:</span>
                <select className="rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-neutral-900 border border-slate-200 dark:border-neutral-700 text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200" value={model} onChange={e => setModel(e.target.value)}>
                  <option value="gpt-4.1-mini">GPT-4.1 Mini</option>
                  <option value="gpt-4o-mini">GPT-4o Mini</option>
                  <option value="gpt-4o">GPT-4o</option>
                </select>
              </div>
            </div>
            <div className="ml-auto flex items-center gap-3">
              <button type="button" onClick={handleNewChat} className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-slate-700 dark:text-slate-300 transition-all duration-200 hover:shadow-sm">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                New Chat
              </button>
              {pending.streaming ? (
                <button type="button" className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-neutral-800 dark:text-slate-300 dark:hover:bg-neutral-700/60 transition-all duration-200 shadow-sm" onClick={handleStop}>
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                  Stop
                </button>
              ) : null}
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-neutral-700 scrollbar-track-transparent">
          <div className="mx-auto max-w-4xl px-6 py-6 space-y-6">
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
                        <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm ${isUser ? 'bg-slate-100 text-black dark:bg-slate-700 dark:text-white' : 'bg-white dark:bg-neutral-900 text-slate-800 dark:text-slate-200 border border-slate-200/50 dark:border-neutral-700/50'}`}>
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
                      <button type="button" onClick={() => handleCopy(m.content)} className="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 text-xs px-2 py-1 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-slate-600 dark:text-slate-400 transition-all duration-200 shadow-sm">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      </button>
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
        <form className="border-t border-slate-200/60 dark:border-neutral-800/60 bg-white/80 dark:bg-neutral-950/80 backdrop-blur-md supports-[backdrop-filter]:bg-white/70 dark:supports-[backdrop-filter]:bg-neutral-950/70" onSubmit={e => { e.preventDefault(); handleSend(); }}>
          <div className="mx-auto max-w-4xl px-6 py-4">
            <div className="relative rounded-2xl bg-white dark:bg-neutral-900 border border-slate-200 dark:border-neutral-700 shadow-lg transition-all duration-200">
              <textarea
                ref={inputRef}
                className="w-full resize-none bg-transparent border-0 outline-none p-4 text-sm placeholder-slate-500 dark:placeholder-slate-400 text-slate-800 dark:text-slate-200"
                placeholder="Type your message..."
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKey}
                rows={1}
              />
              <div className="flex items-center justify-between px-4 pb-4">
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  <span>Enter to send • Shift+Enter for new line</span>
                </div>
                <button
                  type="submit"
                  disabled={!input.trim() || pending.streaming}
                  className="flex items-center gap-2 px-4 py-2 text-sm rounded-xl bg-slate-800 hover:bg-slate-700 dark:bg-slate-600 dark:hover:bg-slate-500 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 shadow-md hover:shadow-lg disabled:hover:shadow-md transform hover:scale-[1.02] disabled:hover:scale-100"
                >
                  {pending.streaming ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="m4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Sending...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                      </svg>
                      Send
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
