/**
 * UI state action creators
 *
 * Manages UI-related state including user input, image attachments, sidebar visibility,
 * and error states. These actions control the visual and interactive elements of the chat.
 *
 * @module uiActions
 */

import type { ImageAttachment } from '../../../lib/chat/types';
import type { ChatAction } from '../types';

/**
 * Props for creating UI actions
 */
export interface UiActionsProps {
  /** Dispatch function for chat state updates */
  dispatch: React.Dispatch<ChatAction>;
}

/**
 * Creates UI action creators
 *
 * @param props - Configuration object
 * @param props.dispatch - React dispatch function for state updates
 * @returns Object containing UI action functions
 *
 * @example
 * ```typescript
 * const uiActions = createUiActions({ dispatch });
 * uiActions.setInput('Hello world');
 * uiActions.setImages([image1, image2]);
 * uiActions.toggleLeftSidebar();
 * uiActions.toggleSidebar(); // alias for toggleLeftSidebar
 * uiActions.toggleRightSidebar();
 * ```
 */
export function createUiActions({ dispatch }: UiActionsProps) {
  return {
    /**
     * Updates the user input text
     *
     * @param value - New input text value
     */
    setInput: (value: string) => dispatch({ type: 'SET_INPUT', payload: value }),

    /**
     * Updates the attached images for the current message
     *
     * @param images - Array of image attachments
     */
    setImages: (images: ImageAttachment[]) => dispatch({ type: 'SET_IMAGES', payload: images }),

    /**
     * Toggles the visibility of the left sidebar (conversations list)
     */
    toggleLeftSidebar: () => dispatch({ type: 'TOGGLE_SIDEBAR' }),

    /**
     * Toggles the visibility of the left sidebar (alias for toggleLeftSidebar)
     */
    toggleSidebar: () => dispatch({ type: 'TOGGLE_SIDEBAR' }),

    /**
     * Toggles the visibility of the right sidebar
     */
    toggleRightSidebar: () => dispatch({ type: 'TOGGLE_RIGHT_SIDEBAR' }),

    /**
     * Sets an error message to display to the user
     *
     * @param error - Error message text
     */
    setError: (error: string) => dispatch({ type: 'STREAM_ERROR', payload: error }),
  };
}
