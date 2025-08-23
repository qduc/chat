// DB helper unit test stubs for persistence behaviors

describe('DB helpers', () => {
  describe('listConversations', () => {
    test.todo('orders by created_at DESC and paginates with next_cursor');
    test.todo('applies cursor filter (created_at < cursor) correctly');
  });

  describe('getMessagesPage', () => {
    test.todo('returns messages after after_seq with ascending seq ordering');
    test.todo('sets next_after_seq when page is full, null otherwise');
  });

  describe('retentionSweep', () => {
    test.todo('deletes conversations older than cutoff (including messages)');
    test.todo('skips conversations with metadata.pinned=true');
  });
});

