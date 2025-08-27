import { useState, useCallback, useRef, useEffect } from 'react';
import type { ChatMessage, Role, ToolSpec } from '../lib/chat';
import { sendChat, getToolSpecs } from '../lib/chat';

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
    useTools: boolean,
    shouldStream: boolean,
    reasoningEffort: string,
    verbosity: string,
    researchMode?: boolean,
    onConversationCreated?: (conversation: { id: string; title?: string | null; model?: string | null; created_at: string }) => void
  ) => Promise<void>;
  regenerateFromCurrent: (
    conversationId: string | null,
    model: string,
    useTools: boolean,
    shouldStream: boolean,
    reasoningEffort: string,
    verbosity: string,
    researchMode?: boolean
  ) => Promise<void>;
  regenerateFromBase: (
    baseMessages: ChatMessage[],
    conversationId: string | null,
    model: string,
    useTools: boolean,
    shouldStream: boolean,
    reasoningEffort: string,
    verbosity: string,
    researchMode?: boolean
  ) => Promise<void>;
  generateFromHistory: (
    model: string,
    useTools: boolean,
    reasoningEffort: string,
    verbosity: string,
    messagesOverride?: ChatMessage[],
    researchMode?: boolean
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
  const [availableTools, setAvailableTools] = useState<ToolSpec[] | null>(null);
  const assistantMsgRef = useRef<ChatMessage | null>(null);
  const inFlightRef = useRef<boolean>(false);
  const toolsPromiseRef = useRef<Promise<ToolSpec[]> | undefined>(undefined);

  // Fetch tool specifications from backend on mount
  useEffect(() => {
    const toolsPromise = getToolSpecs()
      .then(response => {
        setAvailableTools(response.tools);
        return response.tools;
      })
      .catch(error => {
        console.error('Failed to fetch tool specs:', error);
        setAvailableTools([]);
        return [];
      });
    toolsPromiseRef.current = toolsPromise;
  }, []);

  const handleStreamEvent = useCallback((event: any) => {
    const assistantId = assistantMsgRef.current!.id;
    setMessages(curr => curr.map(m => {
      if (m.id !== assistantId) return m;

      if (event.type === 'text') {
        return { ...m, content: m.content + event.value };
      } else if (event.type === 'tool_call') {
        return {
          ...m,
          tool_calls: [...(m.tool_calls || []), event.value]
        };
      } else if (event.type === 'final') {
        return { ...m, content: event.value };
      } else if (event.type === 'tool_output') {
        return {
          ...m,
          tool_outputs: [...(m.tool_outputs || []), event.value]
        };
      }
      return m;
    }));
  }, []);

  const sendMessage = useCallback(async (
    input: string,
    conversationId: string | null,
    model: string,
    useTools: boolean,
    shouldStream: boolean,
    reasoningEffort: string,
    verbosity: string,
    researchMode?: boolean,
    onConversationCreated?: (conversation: { id: string; title?: string | null; model?: string | null; created_at: string }) => void
  ) => {
    if (!input.trim()) return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: input.trim() };
    setMessages(m => [...m, userMsg]);

    const abort = new AbortController();
    const assistantMsg: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', content: '' };
    assistantMsgRef.current = assistantMsg;
    setMessages(m => [...m, assistantMsg]);
  // Make abort available immediately so callers can stop; but don't mark streaming true
  // until we actually receive data from the server — this keeps the input responsive.
  setPending(prev => ({ ...prev, abort }));

    try {
      // Ensure tools are loaded if needed
      const tools = useTools ? (availableTools ?? await toolsPromiseRef.current?.catch(() => [])) : undefined;

      // Optimization: when a conversation exists and tools are disabled (Responses API),
      // only send the latest user message; backend has full context persisted.
      const shouldOptimize = !!conversationId && !useTools;
      const outgoingForSend = shouldOptimize ? [userMsg] : [...messages, userMsg];

      const result = await sendChat({
        messages: outgoingForSend.map(m => ({ role: m.role as Role, content: m.content })),
        model,
        signal: abort.signal,
        conversationId: conversationId || undefined,
        previousResponseId: previousResponseId || undefined,
        useResponsesAPI: !useTools,
        shouldStream,
        reasoningEffort,
        verbosity,
        ...(useTools ? {
          tools: tools || [],
          tool_choice: 'auto',
          ...(researchMode && { research_mode: true })
        } : {}),
        onEvent: handleStreamEvent
      });
      // For non-streaming, update the assistant message content from the result
      if (!shouldStream) {
        const msg = assistantMsgRef.current!;
        setMessages(curr => curr.map(m => m.id === msg.id ? { ...m, content: result.content || m.content } : m));
      }
      if (result.responseId) {
        setPreviousResponseId(result.responseId);
      }
      // Handle auto-created conversation
      if (result.conversation && onConversationCreated) {
        onConversationCreated(result.conversation);
      }
    } catch (e: any) {
      setPending(p => ({ ...p, error: e?.message || String(e) }));
      setMessages(curr => curr.map(msg => msg.id === assistantMsg.id ? { ...msg, content: msg.content + `\n[error: ${e.message}]` } : msg));
    } finally {
      // Clear streaming/abort when finished
      setPending(p => ({ ...p, streaming: false, abort: undefined }));
      inFlightRef.current = false;
    }

    // Return immediately — caller shouldn't wait for network to finish to keep UI snappy
    return;
  }, [messages, previousResponseId, availableTools, toolsPromiseRef]);

  const generateFromHistory = useCallback(async (
    model: string,
    useTools: boolean,
    reasoningEffort: string,
    verbosity: string,
    messagesOverride?: ChatMessage[],
    researchMode?: boolean
  ) => {
    // Only proceed if there is a user message to respond to
    const history = messagesOverride ?? messages;
    if (!history.length || history[history.length - 1].role !== 'user') return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const abort = new AbortController();
    const assistantMsg: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', content: '' };
    assistantMsgRef.current = assistantMsg;
    setMessages(m => [...m, assistantMsg]);
    setPending(prev => ({ ...prev, streaming: true, abort }));

    // Ensure tools are loaded if needed
    const tools = useTools ? (availableTools ?? await toolsPromiseRef.current?.catch(() => [])) : undefined;

    // Start network operation in background so we don't block the caller/UI.
    const network = sendChat({
      messages: history.map(m => ({ role: m.role as Role, content: m.content })),
      model,
      signal: abort.signal,
      // No conversationId / previousResponseId for local, unsaved edits
      useResponsesAPI: !useTools,
      reasoningEffort,
      verbosity,
      ...(useTools ? {
        tools: tools || [],
        tool_choice: 'auto',
        ...(researchMode && { research_mode: true })
      } : {}),
      onEvent: handleStreamEvent
    });

    network.then(result => {
      if (result.responseId) setPreviousResponseId(result.responseId);
    }).catch((e: any) => {
      setPending(p => ({ ...p, error: e?.message || String(e) }));
      setMessages(curr => curr.map(msg => msg.id === assistantMsg.id ? { ...msg, content: msg.content + `\n[error: ${e.message}]` } : msg));
    }).finally(() => {
      setPending(p => ({ ...p, streaming: false, abort: undefined }));
      inFlightRef.current = false;
    });

    return;
  }, [messages, availableTools, toolsPromiseRef]);

  const regenerateFromBase = useCallback(async (
    baseMessages: ChatMessage[],
    conversationId: string | null,
    model: string,
    useTools: boolean,
    shouldStream: boolean,
    reasoningEffort: string,
    verbosity: string,
    researchMode?: boolean
  ) => {
    // Must have at least one user message to respond to
    if (baseMessages.length === 0) return;
    const last = baseMessages[baseMessages.length - 1];
    if (last.role !== 'user') return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    const abort = new AbortController();
    const assistantMsg: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', content: '' };
    assistantMsgRef.current = assistantMsg;
    setMessages(() => [...baseMessages, assistantMsg]);
    setPending(prev => ({ ...prev, streaming: true, abort }));

    try {
      // Ensure tools are loaded if needed
      const tools = useTools ? (availableTools ?? await toolsPromiseRef.current?.catch(() => [])) : undefined;

      // Optimization: when a conversation exists and tools are disabled, only send last user message
      const shouldOptimizeBase = !!conversationId && !useTools;
      const optimizedBase = shouldOptimizeBase
        ? (() => { const lastUser = [...baseMessages].reverse().find(m => m.role === 'user'); return lastUser ? [lastUser] : []; })()
        : baseMessages;

      const result = await sendChat({
        messages: optimizedBase.map(m => ({ role: m.role as Role, content: m.content })),
        model,
        signal: abort.signal,
        conversationId: conversationId || undefined,
        previousResponseId: previousResponseId || undefined,
        useResponsesAPI: !useTools,
        shouldStream,
        reasoningEffort,
        verbosity,
        ...(useTools ? {
          tools: tools || [],
          tool_choice: 'auto',
          ...(researchMode && { research_mode: true })
        } : {}),
        onEvent: handleStreamEvent
      });
      if (!shouldStream) {
        const msg = assistantMsgRef.current!;
        msg.content = result.content || msg.content;
        setMessages(curr => curr.map(m => m.id === msg.id ? { ...msg } : m));
      }
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
  }, [previousResponseId, availableTools, toolsPromiseRef]);

  const regenerateFromCurrent = useCallback(async (
    conversationId: string | null,
    model: string,
    useTools: boolean,
    shouldStream: boolean,
    reasoningEffort: string,
    verbosity: string,
    researchMode?: boolean
  ) => {
    const base = messages;
    await regenerateFromBase(base, conversationId, model, useTools, shouldStream, reasoningEffort, verbosity, researchMode);
  }, [messages, regenerateFromBase]);

  const stopStreaming = useCallback(() => {
    // Abort the current stream and immediately clear in-flight state
    try { pending.abort?.abort(); } catch {}
    // Ensure callers can immediately start a new request (e.g., after editing)
    inFlightRef.current = false;
    setPending(p => ({ ...p, streaming: false, abort: undefined }));
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
    regenerateFromBase,
    regenerateFromCurrent,
    generateFromHistory,
    stopStreaming,
    clearMessages,
    setMessages,
    setPreviousResponseId
  };
}
