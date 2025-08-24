import { useState, useCallback, useRef } from 'react';
import type { ChatMessage, Role } from '../lib/chat';
import { sendChat } from '../lib/chat';

export interface PendingState {
  abort?: AbortController;
  streaming: boolean;
  error?: string;
}

export interface UseChatStreamReturn {
  messages: ChatMessage[];
  pending: PendingState;
  previousResponseId: string | null;
  sendMessage: (
    input: string, 
    conversationId: string | null, 
    model: string, 
    useTools: boolean
  ) => Promise<void>;
  stopStreaming: () => void;
  clearMessages: () => void;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setPreviousResponseId: (id: string | null) => void;
}

export function useChatStream(): UseChatStreamReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState<PendingState>({ streaming: false });
  const [previousResponseId, setPreviousResponseId] = useState<string | null>(null);
  const assistantRef = useRef<string>('');

  const sendMessage = useCallback(async (
    input: string, 
    conversationId: string | null, 
    model: string, 
    useTools: boolean
  ) => {
    if (!input.trim() || pending.streaming) return;
    
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: input.trim() };
    setMessages(m => [...m, userMsg]);

    const abort = new AbortController();
    assistantRef.current = '';
    const assistantMsg: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', content: '' };
    setMessages(m => [...m, assistantMsg]);
    setPending({ streaming: true, abort });
    
    try {
      const result = await sendChat({
        messages: [...messages, userMsg].map(m => ({ role: m.role as Role, content: m.content })),
        model,
        signal: abort.signal,
        conversationId: conversationId || undefined,
        previousResponseId: previousResponseId || undefined,
        // If tools are enabled, force Chat Completions and include get_time tool
        useResponsesAPI: !useTools,
        ...(useTools ? {
          tools: [
            {
              type: 'function',
              function: {
                name: 'get_time',
                description: 'Get the current local time of the server',
                parameters: { type: 'object', properties: {}, additionalProperties: false },
              }
            }
          ],
          tool_choice: 'auto'
        } : {}),
        onToken: (t) => {
          assistantRef.current += t;
          setMessages(curr => curr.map(msg => msg.id === assistantMsg.id ? { ...msg, content: assistantRef.current } : msg));
        }
      });
      // Store the response ID for the next request
      if (result.responseId) {
        setPreviousResponseId(result.responseId);
      }
    } catch (e: any) {
      setPending(p => ({ ...p, error: e.message }));
      setMessages(curr => curr.map(msg => msg.id === assistantMsg.id ? { ...msg, content: msg.content + `\n[error: ${e.message}]` } : msg));
    } finally {
      setPending({ streaming: false });
    }
  }, [messages, previousResponseId, pending.streaming]);

  const stopStreaming = useCallback(() => {
    pending.abort?.abort();
  }, [pending.abort]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    assistantRef.current = '';
    setPending({ streaming: false });
    setPreviousResponseId(null);
  }, []);

  return {
    messages,
    pending,
    previousResponseId,
    sendMessage,
    stopStreaming,
    clearMessages,
    setMessages,
    setPreviousResponseId
  };
}