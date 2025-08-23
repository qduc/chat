// Test stubs for chat proxy observable behaviors

// These tests focus on how the /v1/chat/completions endpoint behaves from the client perspective.

describe('POST /v1/chat/completions (proxy)', () => {
  test.todo('proxies non-streaming requests and returns upstream JSON');
  test.todo('streams SSE responses line-by-line until [DONE]');
  test.todo('returns error JSON when upstream fails (status >= 400)');
  test.todo('sets Content-Type to text/event-stream and flushes headers for streaming');

  // Persistence-aware behavior (observable via side effects in responses / limits)
  test.todo('enforces max messages per conversation with 429');
  test.todo(
    'accepts optional conversation_id in body/header and continues streaming'
  );
  test.todo('persists user message and assistant draft; batches deltas and finalizes with finish_reason');

  // Connection lifecycle
  test.todo('closes stream when client aborts');
  test.todo('marks assistant message as error when upstream stream errors');
});

describe('POST /v1/responses (proxy)', () => {
  test.todo('proxies non-streaming requests and returns upstream JSON');
  test.todo('streams SSE responses line-by-line until [DONE]');
});

describe('Format transformation', () => {
  test.todo('converts Responses API non-streaming JSON to Chat Completions shape when hitting /v1/chat/completions');
  test.todo('converts Responses API streaming events to Chat Completions chunks when hitting /v1/chat/completions');
});

describe('Request shaping', () => {
  test.todo('when using Responses API and body.messages exists, forwards only last user message as input');
  test.todo('strips conversation_id, previous_response_id, disable_responses_api before forwarding upstream');
  test.todo('for Responses API, forwards previous_response_id when provided via body or header');
});
