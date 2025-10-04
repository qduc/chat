/**
 * Message editing reducer
 * Handles message editing state and operations
 */

import type { ChatState, ChatAction } from '../types';

export function editReducer(state: ChatState, action: ChatAction): ChatState | null {
  switch (action.type) {
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

    default:
      return null; // Not handled by this reducer
  }
}
