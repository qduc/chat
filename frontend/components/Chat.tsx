"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
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
    <div className="flex h-dvh max-h-dvh bg-neutral-50 dark:bg-neutral-950">
      {historyEnabled && (
        <aside className="w-64 border-r bg-white/60 dark:bg-neutral-900/60 p-3 flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-medium">History</div>
            <button
              className="text-xs border rounded px-2 py-1"
              onClick={() => { setConvos([]); setNextCursor(null); (async()=>{ try { const list = await listConversationsApi(undefined, { limit: 20 }); setConvos(list.items); setNextCursor(list.next_cursor);} catch(e:any){ if (e.status===501) setHistoryEnabled(false);} })(); }}
            >Refresh</button>
          </div>
          <div className="flex-1 overflow-y-auto space-y-1">
            {convos.map(c => (
              <div key={c.id} className={`group flex items-center gap-2 text-xs p-2 rounded border ${conversationId===c.id ? 'bg-blue-50 border-blue-200 dark:bg-blue-950/20 dark:border-blue-900' : 'bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800'}`}>
                <button className="flex-1 text-left truncate" onClick={() => selectConversation(c.id)} title={c.title || c.id}>
                  {c.title || 'Untitled'}
                </button>
                <button className="opacity-50 group-hover:opacity-100" title="Delete" onClick={() => deleteConversation(c.id)}>🗑️</button>
              </div>
            ))}
            {convos.length === 0 && !loadingConvos && (
              <div className="text-xs text-neutral-500">No conversations.</div>
            )}
          </div>
          <div className="mt-2">
            {nextCursor && (
              <button className="w-full text-xs border rounded px-2 py-1" onClick={loadMoreConversations} disabled={loadingConvos}>
                {loadingConvos ? 'Loading…' : 'Load more'}
              </button>
            )}
          </div>
        </aside>
      )}
      <div className="flex flex-col flex-1">
        <header className="sticky top-0 z-10 border-b bg-white/70 dark:bg-neutral-950/70 backdrop-blur supports-[backdrop-filter]:bg-white/60 dark:supports-[backdrop-filter]:bg-neutral-950/60">
          <div className="mx-auto max-w-3xl px-4 py-3 flex items-center gap-3">
            <h1 className="font-semibold text-lg">Chat</h1>
            <select className="ml-1 border rounded-md px-2.5 py-1.5 text-sm bg-transparent" value={model} onChange={e => setModel(e.target.value)}>
              <option value="gpt-4.1-mini">gpt-4.1-mini</option>
              <option value="gpt-4o-mini">gpt-4o-mini</option>
              <option value="gpt-4o">gpt-4o</option>
            </select>
            <div className="ml-auto flex items-center gap-2">
              <button type="button" onClick={handleNewChat} className="text-xs px-2.5 py-1.5 rounded border bg-white hover:bg-neutral-50 dark:bg-neutral-900 dark:hover:bg-neutral-800">New</button>
              {pending.streaming ? (
                <button type="button" className="text-xs px-2.5 py-1.5 rounded border bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200" onClick={handleStop}>Stop</button>
              ) : null}
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-4 py-4 space-y-4">
            {messages.length === 0 && (
              <div className="rounded-xl border border-dashed bg-white/60 dark:bg-neutral-900/60 p-6 text-center text-sm text-neutral-600 dark:text-neutral-400">
                <div className="font-medium mb-1">Welcome to Chat</div>
                <div>Ask a question to get started.</div>
              </div>
            )}
            {messages.map((m) => {
              const isUser = m.role === 'user';
              return (
                <div key={m.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                  <div className={`relative max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm border shadow-sm ${isUser ? 'bg-blue-600 text-white border-blue-600' : 'bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800 text-neutral-900 dark:text-neutral-100'}`}>
                    {!isUser && m.content && (
                      <button type="button" onClick={() => handleCopy(m.content)} className="absolute -top-2 -right-2 text-[10px] px-1.5 py-0.5 rounded-full border bg-white dark:bg-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 shadow">
                        Copy
                      </button>
                    )}
                    {m.content || (m.role === 'assistant' && pending.streaming ? (
                      <span className="inline-flex items-center gap-1 text-neutral-500 dark:text-neutral-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: '300ms' }} />
                      </span>
                    ) : null)}
                  </div>
                </div>
              );
            })}
            {pending.error && (
              <div className="text-xs text-red-600 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded px-3 py-2">
                {pending.error}
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </main>
        <form className="border-t bg-white/70 dark:bg-neutral-950/70 backdrop-blur supports-[backdrop-filter]:bg-white/60 dark:supports-[backdrop-filter]:bg-neutral-950/60" onSubmit={e => { e.preventDefault(); handleSend(); }}>
          <div className="mx-auto max-w-3xl px-4 py-3">
            <div className="rounded-xl border bg-white dark:bg-neutral-900 shadow-sm">
              <textarea
                ref={inputRef}
                className="w-full resize-none bg-transparent border-0 outline-none p-3 text-sm"
                placeholder="Type your message..."
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKey}
              />
              <div className="flex items-center justify-between px-3 pb-3">
                <div className="text-xs text-neutral-500">Enter to send • Shift+Enter for newline</div>
                <button type="submit" disabled={!input.trim() || pending.streaming} className="px-3.5 py-1.5 text-sm rounded-md bg-blue-600 text-white disabled:opacity-40">Send</button>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
