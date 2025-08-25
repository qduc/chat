import React, { useReducer, useCallback, useRef } from 'react';
import type { ChatMessage, Role, ConversationMeta } from '../lib/chat';
import { sendChat, createConversation, getConversationApi, listConversationsApi, deleteConversationApi, editMessageApi } from '../lib/chat';

// Unified state structure
export interface ChatState {
  // UI State
  status: 'idle' | 'streaming' | 'loading' | 'error';
  input: string;
  
  // Chat State
  messages: ChatMessage[];
  conversationId: string | null;
  previousResponseId: string | null;
  
  // Settings
  model: string;
  useTools: boolean;
  shouldStream: boolean;
  reasoningEffort: string;
  verbosity: string;
  
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
  | { type: 'SET_CONVERSATION_ID'; payload: string | null }
  | { type: 'START_STREAMING'; payload: { abort: AbortController; userMessage: ChatMessage; assistantMessage: ChatMessage } }
  | { type: 'REGENERATE_START'; payload: { abort: AbortController; baseMessages: ChatMessage[]; assistantMessage: ChatMessage } }
  | { type: 'STREAM_TOKEN'; payload: { messageId: string; token: string } }
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
  | { type: 'NEW_CHAT' };

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
      return {
        ...state,
        messages: state.messages.map(m =>
          m.id === action.payload.messageId
            ? { ...m, content: m.content + action.payload.token }
            : m
        ),
      };
    
    case 'STREAM_COMPLETE':
      return {
        ...state,
        status: 'idle',
        abort: undefined,
        previousResponseId: action.payload.responseId || state.previousResponseId,
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
        previousResponseId: null,
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
        previousResponseId: null, // Reset for regeneration
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
      dispatch({ type: 'STREAM_TOKEN', payload: { messageId: assistantId, token: event.value } });
    } else if (event.type === 'final') {
      // For final events, we could update the entire content
      dispatch({ type: 'STREAM_TOKEN', payload: { messageId: assistantId, token: event.value } });
    }
    // Handle tool calls, tool outputs if needed
  }, []);

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

      try {
        const result = await sendChat({
          messages: [...state.messages, userMsg].map(m => ({ role: m.role as Role, content: m.content })),
          model: state.model,
          signal: abort.signal,
          conversationId: state.conversationId || undefined,
          previousResponseId: state.previousResponseId || undefined,
          useResponsesAPI: !state.useTools,
          shouldStream: state.shouldStream,
          reasoningEffort: state.reasoningEffort,
          verbosity: state.verbosity,
          ...(state.useTools ? {
            tools: Object.values(availableTools),
            tool_choice: 'auto'
          } : {}),
          onEvent: handleStreamEvent
        });

        dispatch({ 
          type: 'STREAM_COMPLETE', 
          payload: { responseId: result.responseId } 
        });
      } catch (e: any) {
        dispatch({ 
          type: 'STREAM_ERROR', 
          payload: e?.message || String(e) 
        });
      } finally {
        inFlightRef.current = false;
      }
    }, [state, handleStreamEvent]),

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

      try {
        const result = await sendChat({
          messages: baseMessages.map(m => ({ role: m.role as Role, content: m.content })),
          model: state.model,
          signal: abort.signal,
          conversationId: state.conversationId || undefined,
          previousResponseId: state.previousResponseId || undefined,
          useResponsesAPI: !state.useTools,
          shouldStream: state.shouldStream,
          reasoningEffort: state.reasoningEffort,
          verbosity: state.verbosity,
          ...(state.useTools ? {
            tools: Object.values(availableTools),
            tool_choice: 'auto'
          } : {}),
          onEvent: handleStreamEvent
        });

        dispatch({
          type: 'STREAM_COMPLETE',
          payload: { responseId: result.responseId }
        });
      } catch (e: any) {
        dispatch({
          type: 'STREAM_ERROR',
          payload: e?.message || String(e)
        });
      } finally {
        inFlightRef.current = false;
      }
    }, [state, handleStreamEvent]),

    stopStreaming: useCallback(() => {
      try { state.abort?.abort(); } catch {}
      inFlightRef.current = false;
      dispatch({ type: 'STOP_STREAMING' });
    }, [state.abort]),

    newChat: useCallback(async () => {
      if (state.status === 'streaming') {
        actions.stopStreaming();
      }
      
      dispatch({ type: 'NEW_CHAT' });

      if (state.historyEnabled) {
        try {
          const convo = await createConversation(undefined, { model: state.model });
          dispatch({ type: 'SET_CONVERSATION_ID', payload: convo.id });
          dispatch({ 
            type: 'ADD_CONVERSATION', 
            payload: {
              id: convo.id,
              title: convo.title || 'New chat',
              model: convo.model,
              created_at: convo.created_at
            }
          });
        } catch (e: any) {
          if (e.status === 501) {
            dispatch({ type: 'SET_HISTORY_ENABLED', payload: false });
          }
        }
      }
    }, [state.status, state.historyEnabled, state.model]),

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