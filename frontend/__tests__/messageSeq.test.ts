/**
 * Tests for message seq handling
 */

import { chatReducer } from '../hooks/useChatState/reducer';
import { initialState } from '../hooks/useChatState/initialState';
import type { ChatState } from '../hooks/useChatState/types';

describe('Message seq handling', () => {
  it('should update seq for user and assistant messages after streaming', () => {
    // Start with initial state and add two messages (simulating streaming start)
    const userMsg = { id: 'user-1', role: 'user' as const, content: 'Hello' };
    const assistantMsg = { id: 'asst-1', role: 'assistant' as const, content: 'Hi there' };

    let state: ChatState = {
      ...initialState,
      messages: [userMsg, assistantMsg]
    };

    // Simulate receiving conversation metadata with seq from backend
    const action = {
      type: 'UPDATE_MESSAGE_SEQ' as const,
      payload: {
        userSeq: 1,
        assistantSeq: 2,
        assistantId: 'asst-1'
      }
    };

    state = chatReducer(state, action);

    // Verify both messages now have seq
    expect(state.messages[0].seq).toBe(1);
    expect(state.messages[1].seq).toBe(2);
  });

  it('should handle multiple conversation turns correctly', () => {
    // Simulate a conversation with multiple turns
    const messages = [
      { id: 'user-1', role: 'user' as const, content: 'First', seq: 1 },
      { id: 'asst-1', role: 'assistant' as const, content: 'Response 1', seq: 2 },
      { id: 'user-2', role: 'user' as const, content: 'Second', seq: 3 },
      { id: 'asst-2', role: 'assistant' as const, content: 'Response 2', seq: 4 },
      // New messages without seq
      { id: 'user-3', role: 'user' as const, content: 'Third' },
      { id: 'asst-3', role: 'assistant' as const, content: 'Response 3' },
    ];

    let state: ChatState = {
      ...initialState,
      messages
    };

    // Backend returns assistantSeq = 6 for the new assistant message
    const action = {
      type: 'UPDATE_MESSAGE_SEQ' as const,
      payload: {
        userSeq: 5,
        assistantSeq: 6,
        assistantId: 'asst-3'
      }
    };

    state = chatReducer(state, action);

    // Verify only the last two messages were updated
    expect(state.messages[0].seq).toBe(1); // unchanged
    expect(state.messages[1].seq).toBe(2); // unchanged
    expect(state.messages[2].seq).toBe(3); // unchanged
    expect(state.messages[3].seq).toBe(4); // unchanged
    expect(state.messages[4].seq).toBe(5); // NEW: updated
    expect(state.messages[5].seq).toBe(6); // NEW: updated
  });
});
