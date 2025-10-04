/**
 * Conversation management reducer
 * Handles conversation CRUD, loading, and selection
 */

import type { ChatState, ChatAction } from '../types';

export function conversationReducer(state: ChatState, action: ChatAction): ChatState | null {
  switch (action.type) {
    case 'SET_CONVERSATION_ID':
      return {
        ...state,
        conversationId: action.payload,
        // Reset previousResponseId when switching conversations
        previousResponseId: null
      };

    case 'SET_CURRENT_CONVERSATION_TITLE':
      return {
        ...state,
        currentConversationTitle: action.payload
      };

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
        messages: state.conversationId === action.payload ? [] : state.messages,
      };

    case 'NEW_CHAT':
      return {
        ...state,
        messages: [],
        input: '',
        images: [],
        conversationId: null,
        currentConversationTitle: null,
        previousResponseId: null,
        editingMessageId: null,
        editingContent: '',
        error: null,
      };

    default:
      return null; // Not handled by this reducer
  }
}
