import { useState, useCallback, useRef } from 'react';
import type { ChatMessage, Role } from '../lib/chat';
import { sendChat } from '../lib/chat';

// Define the tools available to the model.
const availableTools = {
  get_time: {
    type: 'function',
    function: {
      name: 'get_time',
      description: 'Get the current local time of the server',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    }
  },
  web_search: {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Perform a web search for a given query',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query' }
        },
        required: ['query']
      }
    }
  }
};

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
  const assistantMsgRef = useRef<ChatMessage | null>(null);
  const inFlightRef = useRef<boolean>(false);

  const sendMessage = useCallback(async (
    input: string,
    conversationId: string | null,
    model: string,
    useTools: boolean
  ) => {
  if (!input.trim()) return;
  // Prevent concurrent requests immediately (don't rely solely on state batching)
  if (inFlightRef.current) return;
  inFlightRef.current = true;

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: input.trim() };
    setMessages(m => [...m, userMsg]);

    const abort = new AbortController();
    const assistantMsg: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', content: '' };
    assistantMsgRef.current = assistantMsg;
    setMessages(m => [...m, assistantMsg]);
  setPending(prev => ({ ...prev, streaming: true, abort }));

    try {
      const result = await sendChat({
        messages: [...messages, userMsg].map(m => ({ role: m.role as Role, content: m.content })),
        model,
        signal: abort.signal,
        conversationId: conversationId || undefined,
        previousResponseId: previousResponseId || undefined,
        useResponsesAPI: !useTools,
        ...(useTools ? {
          tools: Object.values(availableTools),
          tool_choice: 'auto'
        } : {}),
        onEvent: (event) => {
          const msg = assistantMsgRef.current!;
          if (event.type === 'text') {
            msg.content += event.value;
          } else if (event.type === 'tool_call') {
            if (!msg.tool_calls) msg.tool_calls = [];
            msg.tool_calls.push(event.value);
          } else if (event.type === 'final') {
            msg.content = event.value; // Replace content with the final version
          } else if (event.type === 'tool_output') {
            if (!msg.tool_outputs) msg.tool_outputs = [] as any;
            msg.tool_outputs!.push(event.value);
          }
          setMessages(curr => curr.map(m => m.id === msg.id ? { ...msg } : m));
        }
      });
      if (result.responseId) {
        setPreviousResponseId(result.responseId);
      }
    } catch (e: any) {
      setPending(p => ({ ...p, error: e?.message || String(e) }));
      setMessages(curr => curr.map(msg => msg.id === assistantMsg.id ? { ...msg, content: msg.content + `\n[error: ${e.message}]` } : msg));
    } finally {
      setPending(p => ({ ...p, streaming: false, abort: undefined }));
      inFlightRef.current = false;
    }
  }, [messages, previousResponseId, pending.streaming]);

  const stopStreaming = useCallback(() => {
    pending.abort?.abort();
  }, [pending.abort]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    assistantMsgRef.current = null;
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
