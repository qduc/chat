// Test stubs for conversations API observable behaviors

describe('Conversations API', () => {
  describe('POST /v1/conversations', () => {
    test.todo(
      'creates a new conversation and returns 201 with id, title, model, created_at'
    );
    test.todo('enforces max conversations per session with 429');
    test.todo('returns 501 when persistence is disabled');
  });

  describe('GET /v1/conversations', () => {
    test.todo(
      'lists conversations for current session with pagination (cursor, limit)'
    );
    test.todo('supports include_deleted flag when enabled');
    test.todo('returns 501 when persistence is disabled');
  });

  describe('GET /v1/conversations/:id', () => {
    test.todo('returns 400 when session id is missing (no session resolver)');
    test.todo('returns 404 for non-existent conversation');
    test.todo(
      'returns metadata and first page of messages with next_after_seq'
    );
    test.todo('supports after_seq and limit query params');
    test.todo('returns 501 when persistence is disabled');
  });

  describe('DELETE /v1/conversations/:id', () => {
    test.todo('soft deletes an existing conversation and returns 204');
    test.todo('is idempotent when deleting already deleted conversation (204)');
    test.todo('returns 404 when conversation not found');
    test.todo('returns 501 when persistence is disabled');
  });
});
