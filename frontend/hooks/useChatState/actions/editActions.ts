/**
 * Message editing action creators
 *
 * Handles the message editing workflow including starting edits,
 * updating content, canceling, and saving. Preserves images and
 * handles mixed content (text + images).
 *
 * @module editActions
 */

import { createMixedContent, extractImagesFromContent } from '../../../lib/chat/content-utils';
import type { ChatState, ChatAction } from '../types';

/**
 * Props for creating edit actions
 */
export interface EditActionsProps {
  /** Current chat state */
  state: ChatState;
  /** Dispatch function for chat state updates */
  dispatch: React.Dispatch<ChatAction>;
}

/**
 * Creates edit action creators
 *
 * @param props - Configuration object
 * @returns Object containing edit action functions
 *
 * @example
 * ```typescript
 * const editActions = createEditActions({ state, dispatch });
 *
 * editActions.startEdit('msg-123', 'Original text');
 * editActions.updateEditContent('Edited text');
 * await editActions.saveEdit();
 * editActions.cancelEdit();
 * ```
 */
export function createEditActions({
  state,
  dispatch,
}: EditActionsProps) {
  return {
    /**
     * Starts editing a message
     *
     * @param messageId - ID of message to edit
     * @param content - Current message content
     */
    startEdit: (messageId: string, content: string) => {
      dispatch({ type: 'START_EDIT', payload: { messageId, content } });
    },

    /**
     * Updates the content being edited
     *
     * @param content - New content text
     */
    updateEditContent: (content: string) => {
      dispatch({ type: 'UPDATE_EDIT_CONTENT', payload: content });
    },

    /**
     * Cancels the current edit operation
     */
    cancelEdit: () => {
      dispatch({ type: 'CANCEL_EDIT' });
    },

    /**
     * Saves the edited message and potentially triggers regeneration
     * Preserves existing images while updating text content
     */
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
