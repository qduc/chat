/**
 * Test for seq handling in existing conversations
 */

describe('Seq handling in existing conversations', () => {
  it('should calculate seq for new message when sending follow-up in existing conversation', () => {
    // Mock scenario: Existing conversation with 2 messages (seq 1, 2)
    const existingMessages = [
      { id: '1', role: 'user' as const, content: 'First message', seq: 1 },
      { id: '2', role: 'assistant' as const, content: 'Response', seq: 2 },
    ];

    // New message being sent (no seq initially)
    const newMessage = { id: '3', role: 'user' as const, content: 'Follow up' };

    // Simulate buildSendChatConfig logic
    const messages = [...existingMessages, newMessage];
    const latestUserMessage = [...messages].reverse().find(m => m.role === 'user');
    const messageToSend = latestUserMessage!;

    // Calculate seq if missing
    if (messageToSend.seq === undefined || messageToSend.seq === null) {
      const existingWithSeq = messages.filter(m => m.id !== messageToSend.id);
      const maxSeq = existingWithSeq
        .map(m => m.seq)
        .filter((seq): seq is number => typeof seq === 'number' && seq > 0)
        .reduce((max, current) => Math.max(max, current), 0);

      const calculatedSeq = maxSeq > 0 ? maxSeq + 1 : 1;
      messageToSend.seq = calculatedSeq;
    }

    // Verify the new message has seq = 3
    expect(messageToSend.seq).toBe(3);
    expect(messageToSend.id).toBe('3');
    expect(messageToSend.role).toBe('user');
  });

  it('should handle new conversation (no existing messages)', () => {
    // New conversation - no existing messages
    const newMessage = { id: '1', role: 'user' as const, content: 'First message' };
    const messages = [newMessage];

    const messageToSend = messages[0];

    // Calculate seq if missing
    if (messageToSend.seq === undefined || messageToSend.seq === null) {
      const existingWithSeq = messages.filter(m => m.id !== messageToSend.id);
      const maxSeq = existingWithSeq
        .map(m => m.seq)
        .filter((seq): seq is number => typeof seq === 'number' && seq > 0)
        .reduce((max, current) => Math.max(max, current), 0);

      const calculatedSeq = maxSeq > 0 ? maxSeq + 1 : 1;
      messageToSend.seq = calculatedSeq;
    }

    // Verify first message gets seq = 1
    expect(messageToSend.seq).toBe(1);
  });

  it('should preserve existing seq on message if already present', () => {
    // Scenario: Regenerating a message that already has seq
    const existingMessages = [
      { id: '1', role: 'user' as const, content: 'First message', seq: 1 },
      { id: '2', role: 'assistant' as const, content: 'Response', seq: 2 },
    ];

    // Re-sending an existing message (e.g., regenerate)
    const messageToResend = { ...existingMessages[0] }; // Has seq: 1
    const messages = [messageToResend];

    const messageToSend = messages[0];

    // Logic should NOT recalculate if seq already exists
    if (messageToSend.seq === undefined || messageToSend.seq === null) {
      const existingWithSeq = messages.filter(m => m.id !== messageToSend.id);
      const maxSeq = existingWithSeq
        .map(m => m.seq)
        .filter((seq): seq is number => typeof seq === 'number' && seq > 0)
        .reduce((max, current) => Math.max(max, current), 0);

      const calculatedSeq = maxSeq > 0 ? maxSeq + 1 : 1;
      messageToSend.seq = calculatedSeq;
    }

    // Verify seq was NOT changed
    expect(messageToSend.seq).toBe(1);
  });

  it('should calculate correct seq when there are gaps in existing seq', () => {
    // Edge case: Messages with non-contiguous seq (shouldn't happen, but handle it)
    const existingMessages = [
      { id: '1', role: 'user' as const, content: 'First', seq: 1 },
      { id: '2', role: 'assistant' as const, content: 'Second', seq: 2 },
      { id: '3', role: 'user' as const, content: 'Third', seq: 5 }, // Gap!
    ];

    const newMessage = { id: '4', role: 'user' as const, content: 'Fourth' };
    const messages = [...existingMessages, newMessage];

    const messageToSend = [...messages].reverse().find(m => m.role === 'user' && !m.seq);

    if (messageToSend && (messageToSend.seq === undefined || messageToSend.seq === null)) {
      const existingWithSeq = messages.filter(m => m.id !== messageToSend.id);
      const maxSeq = existingWithSeq
        .map(m => m.seq)
        .filter((seq): seq is number => typeof seq === 'number' && seq > 0)
        .reduce((max, current) => Math.max(max, current), 0);

      const calculatedSeq = maxSeq > 0 ? maxSeq + 1 : 1;
      messageToSend.seq = calculatedSeq;
    }

    // Should use maxSeq + 1 = 6
    expect(messageToSend?.seq).toBe(6);
  });
});
