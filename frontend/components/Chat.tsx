"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../lib/chat';
import { sendChat } from '../lib/chat';

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
  const assistantRef = useRef<string>('');
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  };
  useEffect(scrollToBottom, [messages.length, pending.streaming]);

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
        messages: [...messages, userMsg].map(m => ({ role: m.role, content: m.content })),
        model,
        signal: abort.signal,
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
  }, [input, pending.streaming, messages, model]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-dvh max-h-dvh">
      <header className="p-3 border-b flex items-center gap-3">
        <h1 className="font-semibold text-lg">Chat</h1>
        <select className="border rounded px-2 py-1 text-sm" value={model} onChange={e => setModel(e.target.value)}>
          <option value="gpt-4.1-mini">gpt-4.1-mini</option>
          <option value="gpt-4o-mini">gpt-4o-mini</option>
          <option value="gpt-4o">gpt-4o</option>
        </select>
        {pending.streaming && (
          <button className="ml-auto text-xs px-2 py-1 border rounded" onClick={() => pending.abort?.abort()}>Stop</button>
        )}
      </header>
      <main className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-sm text-neutral-500">Start by asking a question...</div>
        )}
        {messages.map(m => (
          <div key={m.id} className={`whitespace-pre-wrap rounded-md px-3 py-2 text-sm border ${m.role === 'user' ? 'bg-blue-50 border-blue-200 dark:bg-blue-950/40 dark:border-blue-700' : 'bg-neutral-50 dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800'}`}>
            <div className="font-medium mb-1 text-xs uppercase tracking-wide opacity-70">{m.role}</div>
            {m.content || (m.role === 'assistant' && pending.streaming ? <span className="opacity-50">...</span> : null)}
          </div>
        ))}
        {pending.error && <div className="text-xs text-red-600">{pending.error}</div>}
        <div ref={bottomRef} />
      </main>
      <form className="p-3 border-t flex flex-col gap-2" onSubmit={e => { e.preventDefault(); handleSend(); }}>
        <textarea
          className="w-full resize-none border rounded p-2 text-sm h-24 focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Type your message..."
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
        />
        <div className="flex items-center justify-between">
          <div className="text-xs text-neutral-500">Enter to send • Shift+Enter for newline</div>
          <button type="submit" disabled={!input.trim() || pending.streaming} className="px-4 py-1.5 text-sm rounded bg-blue-600 text-white disabled:opacity-40">Send</button>
        </div>
      </form>
    </div>
  );
}
