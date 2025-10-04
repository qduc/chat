import type { ImageAttachment } from '../../../lib/chat/types';
import type { ChatAction } from '../types';

export interface UiActionsProps {
  dispatch: React.Dispatch<ChatAction>;
}

export function createUiActions({ dispatch }: UiActionsProps) {
  return {
    setInput: (input: string) => {
      dispatch({ type: 'SET_INPUT', payload: input });
    },

    setImages: (images: ImageAttachment[]) => {
      dispatch({ type: 'SET_IMAGES', payload: images });
    },

    toggleSidebar: () => {
      dispatch({ type: 'TOGGLE_SIDEBAR' });
    },

    toggleRightSidebar: () => {
      dispatch({ type: 'TOGGLE_RIGHT_SIDEBAR' });
    },
  };
}
