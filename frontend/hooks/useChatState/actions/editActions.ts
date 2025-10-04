import { createMixedContent, extractImagesFromContent } from '../../../lib/chat/content-utils';
import type { ChatState, ChatAction } from '../types';

export interface EditActionsProps {
  state: ChatState;
  dispatch: React.Dispatch<ChatAction>;
}

export function createEditActions({
  state,
  dispatch,
}: EditActionsProps) {
  return {
    startEdit: (messageId: string, content: string) => {
      dispatch({ type: 'START_EDIT', payload: { messageId, content } });
    },

    updateEditContent: (content: string) => {
      dispatch({ type: 'UPDATE_EDIT_CONTENT', payload: content });
    },

    cancelEdit: () => {
      dispatch({ type: 'CANCEL_EDIT' });
    },

    saveEdit: async () => {
      if (!state.editingMessageId) return;

      const messageId = state.editingMessageId;

      const idx = state.messages.findIndex(m => m.id === messageId);
      if (idx === -1) return;

      const trimmedText = state.editingContent.trim();
      const targetMessage = state.messages[idx];
      const existingImages = extractImagesFromContent(targetMessage.content);

      if (!trimmedText && existingImages.length === 0) {
        return;
      }

      const nextContent = existingImages.length > 0
        ? createMixedContent(trimmedText, existingImages)
        : trimmedText;

      const baseMessages = [
        ...state.messages.slice(0, idx),
        { ...targetMessage, content: nextContent }
      ];

      dispatch({
        type: 'SAVE_EDIT_SUCCESS',
        payload: { messageId, content: nextContent, baseMessages }
      });

      if (baseMessages.length > 0 && baseMessages[baseMessages.length - 1].role === 'user') {
        // Trigger regeneration (similar to sendMessage but with existing messages)
        // This would be implemented similar to the current regenerateFromBase logic
      }
    },
  };
}
