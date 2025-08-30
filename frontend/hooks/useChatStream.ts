import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { ChatMessage, Role, ToolSpec } from '../lib/chat';
import { ChatClient, ToolsClient } from '../lib/chat';

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
    onConversationCreated?: (conversation: { id: string; title?: string | null; model?: string | null; created_at: string }) => void,
    qualityLevel?: string
  ) => Promise<void>;
  regenerateFromCurrent: (
    conversationId: string | null,
    model: string,
    useTools: boolean,
    shouldStream: boolean,
    reasoningEffort: string,
    verbosity: string,
    qualityLevel?: string
  ) => Promise<void>;
  regenerateFromBase: (
    baseMessages: ChatMessage[],
    conversationId: string | null,
    model: string,
    useTools: boolean,
    shouldStream: boolean,
    reasoningEffort: string,
    verbosity: string,
    qualityLevel?: string
  ) => Promise<void>;
  generateFromHistory: (
    model: string,
    useTools: boolean,
    reasoningEffort: string,
    verbosity: string,
    messagesOverride?: ChatMessage[],
    qualityLevel?: string
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

  // Create client instances
  const chatClient = useMemo(() => new ChatClient(), []);
  const toolsClient = useMemo(() => new ToolsClient(), []);

  // Fetch tool specifications from backend on mount
  useEffect(() => {
    const toolsPromise = toolsClient.getToolSpecs()
      .then((response: any) => {
        setAvailableTools(response.tools);
        return response.tools;
      })
      .catch((error: any) => {
        console.error('Failed to fetch tool specs:', error);
        setAvailableTools([]);
        return [];
      });
    toolsPromiseRef.current = toolsPromise;
  }, [toolsClient]);

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

  // --- DRY helpers -------------------------------------------------------
  // Ensure tools are loaded if needed
  const loadToolsIfNeeded = useCallback(async (useTools: boolean) => {
    if (!useTools) return undefined as undefined | ToolSpec[];
    return availableTools ?? (await toolsPromiseRef.current?.catch(() => []) ?? []);
  }, [availableTools]);

  // Start an operation by creating an assistant message and an AbortController
  const startOperation = useCallback((options: {
    attachTo?: 'append' | 'replaceWithBase';
    baseMessages?: ChatMessage[];
    setStreaming: boolean;
  }) => {
    const { attachTo = 'append', baseMessages, setStreaming } = options;
    const abort = new AbortController();
    const assistantMsg: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', content: '' };
    assistantMsgRef.current = assistantMsg;

    if (attachTo === 'replaceWithBase' && baseMessages) {
      setMessages(() => [...baseMessages, assistantMsg]);
    } else {
      setMessages(m => [...m, assistantMsg]);
    }

    setPending(prev => ({ ...prev, abort, error: undefined, streaming: setStreaming ? true : prev.streaming }));
    return { abort, assistantMsg };
  }, []);

  // Build the common payload for sendChat
  const buildChatPayload = useCallback(async (args: {
    history: ChatMessage[];
    model: string;
    signal: AbortSignal;
    conversationId?: string | null;
    shouldStream: boolean;
    useTools: boolean;
    reasoningEffort: string;
    verbosity: string;
    qualityLevel?: string;
  }) => {
    const {
      history, model, signal, conversationId,
      shouldStream, useTools, reasoningEffort, verbosity,
      qualityLevel
    } = args;

    const tools = await loadToolsIfNeeded(useTools);

    return {
      messages: history.map(m => ({ role: m.role as Role, content: m.content })),
      model,
      signal,
      conversationId: conversationId || undefined,
      shouldStream,
      reasoningEffort,
      verbosity,
      streamingEnabled: shouldStream,
      toolsEnabled: useTools,
      qualityLevel: qualityLevel ?? undefined,
      ...(useTools ? {
        tools: tools || [],
        tool_choice: 'auto',
      } : {}),
      onEvent: handleStreamEvent
    };
  }, [handleStreamEvent, loadToolsIfNeeded]);

  const recordResultMeta = useCallback((result: any, onConversationCreated?: (conversation: { id: string; title?: string | null; model?: string | null; created_at: string }) => void) => {
    if (result?.responseId) setPreviousResponseId(result.responseId);
    if (result?.conversation && onConversationCreated) onConversationCreated(result.conversation);
  }, []);

  const applyNonStreamingContent = useCallback((content?: string) => {
    const msg = assistantMsgRef.current!;
    setMessages(curr => curr.map(m => m.id === msg.id ? { ...m, content: content ?? m.content } : m));
  }, []);

  const handleOperationError = useCallback((e: any, assistantId: string) => {
    setPending(p => ({ ...p, error: e?.message || String(e) }));
    setMessages(curr => curr.map(msg => msg.id === assistantId ? { ...msg, content: msg.content + `\n[error: ${e?.message ?? String(e)}]` } : msg));
  }, []);

  const finalizeOperation = useCallback(() => {
    setPending(p => ({ ...p, streaming: false, abort: undefined }));
    inFlightRef.current = false;
  }, []);

  const sendMessage = useCallback(async (
    input: string,
    conversationId: string | null,
    model: string,
    useTools: boolean,
    shouldStream: boolean,
    reasoningEffort: string,
    verbosity: string,
    onConversationCreated?: (conversation: { id: string; title?: string | null; model?: string | null; created_at: string }) => void,
    qualityLevel?: string
  ) => {
    if (!input.trim()) return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: input.trim() };
    setMessages(m => [...m, userMsg]);

    // Start operation without setting streaming true yet (preserve original behavior)
    const { abort, assistantMsg } = startOperation({ setStreaming: false });

    try {
      const outgoingForSend = [...messages, userMsg];
      const payload = await buildChatPayload({
        history: outgoingForSend,
        model,
        signal: abort.signal,
        conversationId,
        shouldStream,
        useTools,
        reasoningEffort,
        verbosity,
        qualityLevel
      });

      // Use appropriate client method based on tools usage
      const result = useTools && payload.tools && payload.tools.length > 0
        ? await chatClient.sendMessageWithTools(payload)
        : await chatClient.sendMessage(payload);

      // For non-streaming, update the assistant message content from the result
      if (!shouldStream) {
        applyNonStreamingContent(result.content);
      }
      recordResultMeta(result, onConversationCreated);
    } catch (e: any) {
      handleOperationError(e, assistantMsg.id);
    } finally {
      // Clear streaming/abort when finished
      finalizeOperation();
    }

    // Return immediately — caller shouldn't wait for network to finish to keep UI snappy
    return;
  }, [messages, startOperation, buildChatPayload, recordResultMeta, handleOperationError, finalizeOperation, chatClient]);

  const generateFromHistory = useCallback(async (
    model: string,
    useTools: boolean,
    reasoningEffort: string,
    verbosity: string,
    messagesOverride?: ChatMessage[],
    qualityLevel?: string
  ) => {
    // Only proceed if there is a user message to respond to
    const history = messagesOverride ?? messages;
    if (!history.length || history[history.length - 1].role !== 'user') return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const { abort, assistantMsg } = startOperation({ setStreaming: true });

    // Start network operation in background so we don't block the caller/UI.
    const network = (async () => {
      const payload = await buildChatPayload({
        history,
        model,
        signal: abort.signal,
        conversationId: undefined,
        shouldStream: true, // default for generateFromHistory
        useTools,
        reasoningEffort,
        verbosity,
        qualityLevel
      });
      return useTools && payload.tools && payload.tools.length > 0
        ? chatClient.sendMessageWithTools(payload)
        : chatClient.sendMessage(payload);
    })();

    network.then(result => {
      if (result.responseId) setPreviousResponseId(result.responseId);
    }).catch((e: any) => {
      handleOperationError(e, assistantMsg.id);
    }).finally(() => {
      finalizeOperation();
    });

    return;
  }, [messages, startOperation, buildChatPayload, finalizeOperation, handleOperationError, chatClient]);

  const regenerateFromBase = useCallback(async (
    baseMessages: ChatMessage[],
    conversationId: string | null,
    model: string,
    useTools: boolean,
    shouldStream: boolean,
    reasoningEffort: string,
    verbosity: string,
    qualityLevel?: string
  ) => {
    // Must have at least one user message to respond to
    if (baseMessages.length === 0) return;
    const last = baseMessages[baseMessages.length - 1];
    if (last.role !== 'user') return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    const { abort, assistantMsg } = startOperation({ attachTo: 'replaceWithBase', baseMessages, setStreaming: true });

    try {
      const payload = await buildChatPayload({
        history: baseMessages,
        model,
        signal: abort.signal,
        conversationId,
        shouldStream,
        useTools,
        reasoningEffort,
        verbosity,
        qualityLevel
      });
      const result = useTools && payload.tools && payload.tools.length > 0
        ? await chatClient.sendMessageWithTools(payload)
        : await chatClient.sendMessage(payload);
      if (!shouldStream) {
        applyNonStreamingContent(result.content);
      }
      recordResultMeta(result);
    } catch (e: any) {
      handleOperationError(e, assistantMsg.id);
    } finally {
      finalizeOperation();
    }
  }, [startOperation, buildChatPayload, finalizeOperation, handleOperationError, recordResultMeta, chatClient]);

  const regenerateFromCurrent = useCallback(async (
    conversationId: string | null,
    model: string,
    useTools: boolean,
    shouldStream: boolean,
    reasoningEffort: string,
    verbosity: string,
    qualityLevel?: string
  ) => {
    const base = messages;
    await regenerateFromBase(base, conversationId, model, useTools, shouldStream, reasoningEffort, verbosity, qualityLevel);
  }, [messages, regenerateFromBase]);

  const stopStreaming = useCallback(() => {
    // Abort the current stream and immediately clear in-flight state
    try { pending.abort?.abort(); } catch {}
    // Ensure callers can immediately start a new request (e.g., after editing)
    inFlightRef.current = false;
    // Also clear any previous error when stopping the stream
    setPending(p => ({ ...p, streaming: false, abort: undefined, error: undefined }));
  }, [pending.abort]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    assistantMsgRef.current = null;
    // Clear pending state and any previous errors when clearing messages
    setPending({ streaming: false, error: undefined });
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
