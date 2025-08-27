import React, { useReducer, useCallback, useRef } from 'react';
import type { ChatMessage, Role, ConversationMeta } from '../lib/chat';
import { sendChat, getConversationApi, listConversationsApi, deleteConversationApi, editMessageApi } from '../lib/chat';
import type { QualityLevel } from '../components/ui/QualitySlider';

// Unified state structure
export interface ChatState {
  // UI State
  status: 'idle' | 'streaming' | 'loading' | 'error';
  input: string;

  // Chat State
  messages: ChatMessage[];
  conversationId: string | null;
  // ...existing code...

  // Settings
  model: string;
  useTools: boolean;
  shouldStream: boolean;
  reasoningEffort: string;
  verbosity: string;
  researchMode: boolean;
  qualityLevel: QualityLevel;

  // Conversations
  conversations: ConversationMeta[];
  nextCursor: string | null;
  historyEnabled: boolean;
  loadingConversations: boolean;

  // Message Editing
  editingMessageId: string | null;
  editingContent: string;

  // Error handling
  error: string | null;

  // Internal state
  abort?: AbortController;
}

// Action types
export type ChatAction =
  | { type: 'SET_INPUT'; payload: string }
  | { type: 'SET_MODEL'; payload: string }
  | { type: 'SET_USE_TOOLS'; payload: boolean }
  | { type: 'SET_SHOULD_STREAM'; payload: boolean }
  | { type: 'SET_REASONING_EFFORT'; payload: string }
  | { type: 'SET_VERBOSITY'; payload: string }
  | { type: 'SET_RESEARCH_MODE'; payload: boolean }
  | { type: 'SET_QUALITY_LEVEL'; payload: QualityLevel }
  | { type: 'SET_CONVERSATION_ID'; payload: string | null }
  | { type: 'START_STREAMING'; payload: { abort: AbortController; userMessage: ChatMessage; assistantMessage: ChatMessage } }
  | { type: 'REGENERATE_START'; payload: { abort: AbortController; baseMessages: ChatMessage[]; assistantMessage: ChatMessage } }
  | { type: 'STREAM_TOKEN'; payload: { messageId: string; token: string } }
  | { type: 'STREAM_TOOL_CALL'; payload: { messageId: string; toolCall: any } }
  | { type: 'STREAM_TOOL_OUTPUT'; payload: { messageId: string; toolOutput: any } }
  | { type: 'STREAM_COMPLETE'; payload: { responseId?: string } }
  | { type: 'STREAM_ERROR'; payload: string }
  | { type: 'STOP_STREAMING' }
  | { type: 'CLEAR_MESSAGES' }
  | { type: 'SET_MESSAGES'; payload: ChatMessage[] }
  | { type: 'LOAD_CONVERSATIONS_START' }
  | { type: 'LOAD_CONVERSATIONS_SUCCESS'; payload: { conversations: ConversationMeta[]; nextCursor: string | null; replace?: boolean } }
  | { type: 'LOAD_CONVERSATIONS_ERROR' }
  | { type: 'SET_HISTORY_ENABLED'; payload: boolean }
  | { type: 'ADD_CONVERSATION'; payload: ConversationMeta }
  | { type: 'DELETE_CONVERSATION'; payload: string }
  | { type: 'START_EDIT'; payload: { messageId: string; content: string } }
  | { type: 'UPDATE_EDIT_CONTENT'; payload: string }
  | { type: 'CANCEL_EDIT' }
  | { type: 'SAVE_EDIT_SUCCESS'; payload: { messageId: string; content: string; baseMessages: ChatMessage[] } }
  | { type: 'CLEAR_ERROR' }
  | { type: 'NEW_CHAT' }
  | { type: 'SYNC_ASSISTANT'; payload: ChatMessage };

const initialState: ChatState = {
  status: 'idle',
  input: '',
  messages: [],
  conversationId: null,
  previousResponseId: null,
  model: 'gpt-4.1-mini',
  useTools: true,
  shouldStream: true,
  reasoningEffort: 'medium',
  verbosity: 'medium',
  researchMode: false,
  qualityLevel: 'balanced',
  conversations: [],
  nextCursor: null,
  historyEnabled: true,
  loadingConversations: false,
  editingMessageId: null,
  editingContent: '',
  error: null,
};

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'SET_INPUT':
      return { ...state, input: action.payload };

    case 'SET_MODEL':
      return { ...state, model: action.payload };

    case 'SET_USE_TOOLS':
      return { ...state, useTools: action.payload };

    case 'SET_SHOULD_STREAM':
      return { ...state, shouldStream: action.payload };

    case 'SET_REASONING_EFFORT':
      return { ...state, reasoningEffort: action.payload };

    case 'SET_VERBOSITY':
      return { ...state, verbosity: action.payload };

    case 'SET_RESEARCH_MODE':
      return { ...state, researchMode: action.payload };

    case 'SET_QUALITY_LEVEL': {
      // Map quality level to derived settings for backward compatibility
      const map: Record<QualityLevel, { reasoningEffort: string; verbosity: string }> = {
        quick: { reasoningEffort: 'minimal', verbosity: 'low' },
        balanced: { reasoningEffort: 'medium', verbosity: 'medium' },
        thorough: { reasoningEffort: 'high', verbosity: 'high' },
      };
      const derived = map[action.payload];
      return {
        ...state,
        qualityLevel: action.payload,
        reasoningEffort: derived.reasoningEffort,
        verbosity: derived.verbosity,
      };
    }

    case 'SET_CONVERSATION_ID':
      return { ...state, conversationId: action.payload };

    case 'START_STREAMING':
      return {
        ...state,
        status: 'streaming',
        input: '', // Clear input immediately
        messages: [...state.messages, action.payload.userMessage, action.payload.assistantMessage],
        abort: action.payload.abort,
        error: null,
      };

    case 'REGENERATE_START':
      return {
        ...state,
        status: 'streaming',
        input: '',
        messages: [...action.payload.baseMessages, action.payload.assistantMessage],
        abort: action.payload.abort,
        error: null,
      };

    case 'STREAM_TOKEN':
      {
        let updated = false;
        const next = state.messages.map(m => {
          if (m.id === action.payload.messageId) {
            updated = true;
            return { ...m, content: m.content + action.payload.token };
          }
          return m;
        });
        if (!updated) {
          // Fallback: update the last assistant message if present
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i].role === 'assistant') {
              next[i] = { ...next[i], content: next[i].content + action.payload.token } as any;
              break;
            }
          }
        }
        return { ...state, messages: next };
      }

    case 'STREAM_TOOL_CALL':
      {
        let updated = false;
        const next = state.messages.map(m => {
          if (m.id === action.payload.messageId) {
            updated = true;
            return { ...m, tool_calls: [...(m.tool_calls || []), action.payload.toolCall] } as any;
          }
          return m;
        });
        if (!updated) {
          // Fallback: update last assistant message
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i].role === 'assistant') {
              const tc = [ ...((next[i] as any).tool_calls || []), action.payload.toolCall ];
              next[i] = { ...(next[i] as any), tool_calls: tc } as any;
              break;
            }
          }
        }
        return { ...state, messages: next };
      }

    case 'STREAM_TOOL_OUTPUT':
      {
        let updated = false;
        const next = state.messages.map(m => {
          if (m.id === action.payload.messageId) {
            updated = true;
            return { ...m, tool_outputs: [...(m.tool_outputs || []), action.payload.toolOutput] } as any;
          }
          return m;
        });
        if (!updated) {
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i].role === 'assistant') {
              const to = [ ...((next[i] as any).tool_outputs || []), action.payload.toolOutput ];
              next[i] = { ...(next[i] as any), tool_outputs: to } as any;
              break;
            }
          }
        }
        return { ...state, messages: next };
      }

    case 'STREAM_COMPLETE':
      return {
        ...state,
        status: 'idle',
        abort: undefined,
      };

    case 'STREAM_ERROR':
      return {
        ...state,
        status: 'error',
        error: action.payload,
        abort: undefined,
      };

    case 'STOP_STREAMING':
      return {
        ...state,
        status: 'idle',
        abort: undefined,
      };

    case 'CLEAR_MESSAGES':
      return {
        ...state,
        messages: [],
        error: null,
      };

    case 'SET_MESSAGES':
      return { ...state, messages: action.payload };

    case 'LOAD_CONVERSATIONS_START':
      return { ...state, loadingConversations: true };

    case 'LOAD_CONVERSATIONS_SUCCESS':
      return {
        ...state,
        loadingConversations: false,
        conversations: action.payload.replace
          ? action.payload.conversations
          : [...state.conversations, ...action.payload.conversations],
        nextCursor: action.payload.nextCursor,
      };

    case 'LOAD_CONVERSATIONS_ERROR':
      return { ...state, loadingConversations: false };

    case 'SET_HISTORY_ENABLED':
      return { ...state, historyEnabled: action.payload };

    case 'ADD_CONVERSATION':
      return {
        ...state,
        conversations: [action.payload, ...state.conversations],
      };

    case 'DELETE_CONVERSATION':
      return {
        ...state,
        conversations: state.conversations.filter(c => c.id !== action.payload),
        conversationId: state.conversationId === action.payload ? null : state.conversationId,
      };

    case 'START_EDIT':
      return {
        ...state,
        editingMessageId: action.payload.messageId,
        editingContent: action.payload.content,
      };

    case 'UPDATE_EDIT_CONTENT':
      return { ...state, editingContent: action.payload };

    case 'CANCEL_EDIT':
      return { ...state, editingMessageId: null, editingContent: '' };

    case 'SAVE_EDIT_SUCCESS':
      return {
        ...state,
        messages: action.payload.baseMessages,
        editingMessageId: null,
        editingContent: '',
      };

    case 'SYNC_ASSISTANT':
      return {
        ...state,
        messages: state.messages.map(m => m.id === action.payload.id ? { ...m, ...action.payload } : m),
      };

    case 'CLEAR_ERROR':
      return { ...state, error: null };

    case 'NEW_CHAT':
      return {
        ...state,
        messages: [],
        input: '',
        conversationId: null,
        previousResponseId: null,
        editingMessageId: null,
        editingContent: '',
        error: null,
      };

    default:
      return state;
  }
}

// Available tools (moved from useChatStream)
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

export function useChatState() {
  const [state, dispatch] = useReducer(chatReducer, initialState);
  const assistantMsgRef = useRef<ChatMessage | null>(null);
  const inFlightRef = useRef<boolean>(false);

  // Initialize conversations on mount
  const refreshConversations = useCallback(async () => {
    try {
      dispatch({ type: 'LOAD_CONVERSATIONS_START' });
      const list = await listConversationsApi(undefined, { limit: 20 });
      dispatch({
        type: 'LOAD_CONVERSATIONS_SUCCESS',
        payload: { conversations: list.items, nextCursor: list.next_cursor, replace: true }
      });
      dispatch({ type: 'SET_HISTORY_ENABLED', payload: true });
    } catch (e: any) {
      if (e.status === 501) {
        dispatch({ type: 'SET_HISTORY_ENABLED', payload: false });
      }
      dispatch({ type: 'LOAD_CONVERSATIONS_ERROR' });
    }
  }, []);

  // Initialize conversations on first render
  React.useEffect(() => {
    const timer = setTimeout(() => {
      refreshConversations();
    }, 0);
    return () => clearTimeout(timer);
  }, [refreshConversations]);

  // Stream event handler
  const handleStreamEvent = useCallback((event: any) => {
    const assistantId = assistantMsgRef.current!.id;

    if (event.type === 'text') {
      // Keep a local snapshot for robustness in case state isn't committed yet
      if (assistantMsgRef.current) {
        assistantMsgRef.current.content += event.value;
      }
      dispatch({ type: 'STREAM_TOKEN', payload: { messageId: assistantId, token: event.value } });
    } else if (event.type === 'final') {
      // For final events, we could update the entire content
      if (assistantMsgRef.current) {
        assistantMsgRef.current.content += event.value;
      }
      dispatch({ type: 'STREAM_TOKEN', payload: { messageId: assistantId, token: event.value } });
    } else if (event.type === 'tool_call') {
      if (assistantMsgRef.current) {
        assistantMsgRef.current.tool_calls = [...(assistantMsgRef.current.tool_calls || []), event.value];
      }
      dispatch({ type: 'STREAM_TOOL_CALL', payload: { messageId: assistantId, toolCall: event.value } });
    } else if (event.type === 'tool_output') {
      if (assistantMsgRef.current) {
        assistantMsgRef.current.tool_outputs = [...(assistantMsgRef.current.tool_outputs || []), event.value];
      }
      dispatch({ type: 'STREAM_TOOL_OUTPUT', payload: { messageId: assistantId, toolOutput: event.value } });
    }
  }, []);

  // Helpers to remove duplicate sendChat setup and error handling
  const buildSendChatConfig = useCallback(
    (messages: ChatMessage[], signal: AbortSignal) => {
      const outgoing = messages;

      return ({
        messages: outgoing.map(m => ({ role: m.role as Role, content: m.content })),
        model: state.model,
        signal,
        conversationId: state.conversationId || undefined,
        shouldStream: state.shouldStream,
        reasoningEffort: state.reasoningEffort,
        verbosity: state.verbosity,
        researchMode: state.researchMode,
        qualityLevel: state.qualityLevel,
        ...(state.useTools
          ? {
              tools: Object.values(availableTools),
              tool_choice: 'auto',
            }
          : {}),
        onEvent: handleStreamEvent,
      });
    },
    [state, handleStreamEvent]
  );

  const runSend = useCallback(
    async (config: Parameters<typeof sendChat>[0]) => {
      try {
        const result = await sendChat(config);
        // For non-streaming requests, ensure the assistant message is populated
        // since there are no incremental text events to update content.
        if (config.shouldStream === false && result?.content) {
          const assistantId = assistantMsgRef.current?.id;
          if (assistantId) {
            dispatch({
              type: 'STREAM_TOKEN',
              payload: { messageId: assistantId, token: result.content },
            });
          }
        }
        // If backend auto-created a conversation, set id and refresh history
        if (result.conversation) {
          dispatch({ type: 'SET_CONVERSATION_ID', payload: result.conversation.id });
          // Refresh to reflect server ordering/title rather than optimistic add
          void refreshConversations();
        }
        // Sync the assistant message from the latest snapshot and the final content
        if (assistantMsgRef.current) {
          const merged = { ...assistantMsgRef.current };
          if (result?.content) merged.content = result.content;
          dispatch({ type: 'SYNC_ASSISTANT', payload: merged });
        }
        dispatch({
          type: 'STREAM_COMPLETE',
          payload: { responseId: result.responseId },
        });
      } catch (e: any) {
        const message = e?.message || String(e);
        // Append error message to the assistant bubble for visibility
        const assistantId = assistantMsgRef.current?.id;
        if (assistantId) {
          dispatch({ type: 'STREAM_TOKEN', payload: { messageId: assistantId, token: `\n[error: ${message}]` } });
        }
        dispatch({ type: 'STREAM_ERROR', payload: message });
      } finally {
        inFlightRef.current = false;
      }
    },
    [state.model, refreshConversations]
  );

  // Actions
  const actions = {
    // UI Actions
    setInput: useCallback((input: string) => {
      dispatch({ type: 'SET_INPUT', payload: input });
    }, []),

    setModel: useCallback((model: string) => {
      dispatch({ type: 'SET_MODEL', payload: model });
    }, []),

    setUseTools: useCallback((useTools: boolean) => {
      dispatch({ type: 'SET_USE_TOOLS', payload: useTools });
    }, []),

    setShouldStream: useCallback((shouldStream: boolean) => {
      dispatch({ type: 'SET_SHOULD_STREAM', payload: shouldStream });
    }, []),

    setReasoningEffort: useCallback((effort: string) => {
      dispatch({ type: 'SET_REASONING_EFFORT', payload: effort });
    }, []),

    setVerbosity: useCallback((verbosity: string) => {
      dispatch({ type: 'SET_VERBOSITY', payload: verbosity });
    }, []),

    setResearchMode: useCallback((val: boolean) => {
      dispatch({ type: 'SET_RESEARCH_MODE', payload: val });
    }, []),

    setQualityLevel: useCallback((level: QualityLevel) => {
      dispatch({ type: 'SET_QUALITY_LEVEL', payload: level });
    }, []),

    // Chat Actions
    sendMessage: useCallback(async () => {
      const input = state.input.trim();
      if (!input || state.status === 'streaming' || inFlightRef.current) return;

      inFlightRef.current = true;
      const abort = new AbortController();
      const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: input };
      const assistantMsg: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', content: '' };
      assistantMsgRef.current = assistantMsg;

      dispatch({
        type: 'START_STREAMING',
        payload: { abort, userMessage: userMsg, assistantMessage: assistantMsg }
      });

      // Ensure the START_STREAMING state is applied before streaming events arrive
      await new Promise(resolve => setTimeout(resolve, 0));

      const config = buildSendChatConfig([...state.messages, userMsg], abort.signal);
      await runSend(config);
    }, [state, handleStreamEvent, buildSendChatConfig, runSend]),

    regenerate: useCallback(async (baseMessages: ChatMessage[]) => {
      if (state.status === 'streaming' || inFlightRef.current) return;

      inFlightRef.current = true;
      const abort = new AbortController();
      const assistantMsg: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', content: '' };
      assistantMsgRef.current = assistantMsg;

      dispatch({
        type: 'REGENERATE_START',
        payload: { abort, baseMessages, assistantMessage: assistantMsg }
      });

      // Ensure state commit before events arrive
      await new Promise(resolve => setTimeout(resolve, 0));

      const config = buildSendChatConfig(baseMessages, abort.signal);
      await runSend(config);
    }, [state, handleStreamEvent, buildSendChatConfig, runSend]),

    stopStreaming: useCallback(() => {
      try { state.abort?.abort(); } catch {}
      inFlightRef.current = false;
      dispatch({ type: 'STOP_STREAMING' });
    }, [state.abort]),

    newChat: useCallback(async () => {
      if (state.status === 'streaming') {
        actions.stopStreaming();
      }

      // Align with v1 behavior: don't pre-create; first send will autocreate
      // and the sidebar will refresh on `_conversation` signal.
      dispatch({ type: 'NEW_CHAT' });
    }, [state.status]),

    // Conversation Actions
    selectConversation: useCallback(async (id: string) => {
      if (state.status === 'streaming') {
        actions.stopStreaming();
      }

      dispatch({ type: 'SET_CONVERSATION_ID', payload: id });
      dispatch({ type: 'CLEAR_MESSAGES' });
      dispatch({ type: 'CANCEL_EDIT' });

      try {
        const data = await getConversationApi(undefined, id, { limit: 200 });
        const msgs = data.messages.map(m => ({
          id: String(m.id),
          role: m.role as Role,
          content: m.content || ''
        }));
        dispatch({ type: 'SET_MESSAGES', payload: msgs });
      } catch (e: any) {
        // ignore
      }
    }, [state.status]),

    loadMoreConversations: useCallback(async () => {
      if (!state.nextCursor || state.loadingConversations) return;

      dispatch({ type: 'LOAD_CONVERSATIONS_START' });
      try {
        const list = await listConversationsApi(undefined, { cursor: state.nextCursor, limit: 20 });
        dispatch({
          type: 'LOAD_CONVERSATIONS_SUCCESS',
          payload: { conversations: list.items, nextCursor: list.next_cursor }
        });
      } catch (e: any) {
        dispatch({ type: 'LOAD_CONVERSATIONS_ERROR' });
      }
    }, [state.nextCursor, state.loadingConversations]),

    deleteConversation: useCallback(async (id: string) => {
      try {
        await deleteConversationApi(undefined, id);
        dispatch({ type: 'DELETE_CONVERSATION', payload: id });
      } catch (e: any) {
        // ignore
      }
    }, []),

    // Editing Actions
    startEdit: useCallback((messageId: string, content: string) => {
      dispatch({ type: 'START_EDIT', payload: { messageId, content } });
    }, []),

    updateEditContent: useCallback((content: string) => {
      dispatch({ type: 'UPDATE_EDIT_CONTENT', payload: content });
    }, []),

    cancelEdit: useCallback(() => {
      dispatch({ type: 'CANCEL_EDIT' });
    }, []),

    saveEdit: useCallback(async () => {
      if (!state.editingMessageId || !state.editingContent.trim()) return;

      const messageId = state.editingMessageId;
      const newContent = state.editingContent.trim();

      // Find base messages (up to and including edited message)
      const idx = state.messages.findIndex(m => m.id === messageId);
      if (idx === -1) return;

      const baseMessages = [
        ...state.messages.slice(0, idx),
        { ...state.messages[idx], content: newContent }
      ];

      dispatch({
        type: 'SAVE_EDIT_SUCCESS',
        payload: { messageId, content: newContent, baseMessages }
      });

      // If last message is user message, regenerate response
      if (baseMessages.length > 0 && baseMessages[baseMessages.length - 1].role === 'user') {
        // Trigger regeneration (similar to sendMessage but with existing messages)
        // This would be implemented similar to the current regenerateFromBase logic
      }
    }, [state.editingMessageId, state.editingContent, state.messages]),

    setMessages: useCallback((messages: ChatMessage[]) => {
      dispatch({ type: 'SET_MESSAGES', payload: messages });
    }, []),

    refreshConversations,
  };

  return { state, actions };
}
