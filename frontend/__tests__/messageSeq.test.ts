/**
 * Tests for message ID synchronization logic
 */

import { chatReducer } from '../hooks/useChatState/reducer';
import { initialState } from '../hooks/useChatState/initialState';
import type { ChatState } from '../hooks/useChatState/types';

describe('Message ID synchronization', () => {
  it('updates the matching message ID when backend provides mapping', () => {
    const userMsg = { id: 'temp-user', role: 'user' as const, content: 'Hello' };
    const assistantMsg = { id: 'temp-asst', role: 'assistant' as const, content: 'Hi there' };

    const state: ChatState = {
      ...initialState,
      messages: [userMsg, assistantMsg]
    };

    const action = {
      type: 'SYNC_MESSAGE_ID' as const,
      payload: {
        role: 'user' as const,
        tempId: 'temp-user',
        persistedId: 'db-user-1'
      }
    };

    const next = chatReducer(state, action);

    expect(next.messages[0].id).toBe('db-user-1');
    expect(next.messages[1].id).toBe('temp-asst');
  });

  it('updates assistant IDs and preserves other metadata', () => {
    const userMsg = { id: 'user-1', role: 'user' as const, content: 'Hello' };
    const assistantMsg = { id: 'temp-asst', role: 'assistant' as const, content: 'Hi there', seq: 2 };

    const state: ChatState = {
      ...initialState,
      messages: [userMsg, assistantMsg]
    };

    const action = {
      type: 'SYNC_MESSAGE_ID' as const,
      payload: {
        role: 'assistant' as const,
        tempId: 'temp-asst',
        persistedId: 'db-asst-1'
      }
    };

    const next = chatReducer(state, action);

    expect(next.messages[1].id).toBe('db-asst-1');
    expect(next.messages[1].seq).toBe(2);
  });

  it('keeps editing state aligned with new IDs', () => {
    const userMsg = { id: 'temp-user', role: 'user' as const, content: 'Editing me' };
    const state: ChatState = {
      ...initialState,
      messages: [userMsg],
      editingMessageId: 'temp-user'
    };

    const action = {
      type: 'SYNC_MESSAGE_ID' as const,
      payload: {
        role: 'user' as const,
        tempId: 'temp-user',
        persistedId: 'db-user'
      }
    };

    const next = chatReducer(state, action);

    expect(next.messages[0].id).toBe('db-user');
    expect(next.editingMessageId).toBe('db-user');
  });
});
