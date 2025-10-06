import { renderHook, act } from '@testing-library/react';
import type { Dispatch, SetStateAction } from 'react';
import { useMessageEditing } from '../hooks/useMessageEditing';
import type { ChatMessage } from '../lib/chat/types';

const mockEditMessage = jest.fn();

jest.mock('../lib/chat', () => {
  const actual = jest.requireActual('../lib/chat');
  return {
    ...actual,
    ConversationManager: jest.fn(() => ({
      editMessage: mockEditMessage,
      clearListCache: jest.fn(),
      conversationCache: { clear: jest.fn() }
    }))
  };
});

describe('useMessageEditing', () => {
  beforeEach(() => {
    mockEditMessage.mockReset();
  });

  it('does not call edit endpoint when message lacks seq for optimistic intent', async () => {
    const { result } = renderHook(() => useMessageEditing());

    act(() => {
      result.current.handleEditMessage('user-1', 'Original');
      result.current.setEditingContent('Updated message');
    });

    let messages: ChatMessage[] = [
      { id: 'user-1', role: 'user', content: 'Original', seq: undefined }
    ];

    const onMessagesUpdate: Dispatch<SetStateAction<ChatMessage[]>> = (update) => {
      messages = typeof update === 'function' ? update(messages) : update;
    };

    await act(async () => {
      await result.current.handleSaveEdit('conv-123', onMessagesUpdate, async () => {});
    });

    expect(mockEditMessage).not.toHaveBeenCalled();
  });
});
