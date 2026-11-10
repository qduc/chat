// The plain (no tools) chat path on a Responses API provider: a second message
// in the same conversation continues from the first reply's stored response.
import assert from 'node:assert/strict';
import request from 'supertest';
import { createChatProxyTestContext } from '../test_utils/chatProxyTestUtils.js';
import { getDb, getMessagesPage } from '../src/db/index.js';

const { makeApp, upstream } = createChatProxyTestContext();
const mockUser = { id: 'responses-chaining-user', email: 'chain@example.com' };

function seedResponsesProvider() {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO providers (id, user_id, name, provider_type, api_key, base_url, is_default, enabled, extra_headers, metadata, created_at, updated_at)
       VALUES ('responses-provider', @userId, 'Responses', 'openai-responses', 'k', @baseUrl, 0, 1, '{}', '{}', @now, @now)`,
    )
    .run({ userId: mockUser.id, baseUrl: upstream.getUrl(), now });
  return 'responses-provider';
}

async function send(app, providerId, content, conversationId) {
  const res = await request(app)
    .post('/v1/chat/completions')
    .send({
      messages: [{ role: 'user', content }],
      ...(conversationId ? { conversation_id: conversationId } : {}),
      provider_id: providerId,
      model: 'gpt-r',
      stream: true,
    });
  assert.equal(res.status, 200, res.text);
  const meta = res.text
    .split('\n\n')
    .map((block) => block.replace(/^data: /, ''))
    .filter((data) => data.startsWith('{'))
    .map((data) => JSON.parse(data))
    .find((obj) => obj._conversation);
  return meta?._conversation?.id;
}

describe('Responses API chaining across messages (no tools)', () => {
  test('the second message continues from the first reply and sends only itself', async () => {
    const app = makeApp({ mockUser });
    const providerId = seedResponsesProvider();

    const conversationId = await send(app, providerId, 'First question');
    assert.ok(conversationId);
    // The fake upstream sends [DONE] after response.completed; the reply still ends cleanly.
    const firstReply = getMessagesPage({ conversationId, afterSeq: 0, limit: 10 }).messages.find((m) => m.role === 'assistant');
    assert.equal(firstReply.status, 'final');
    assert.equal(firstReply.content, 'Hello world');
    assert.equal(upstream.lastResponsesRequestBody.previous_response_id, undefined);

    await send(app, providerId, 'Second question', conversationId);
    const second = upstream.lastResponsesRequestBody;
    assert.equal(second.previous_response_id, 'resp_123');
    const sent = JSON.stringify(second.input);
    assert.ok(sent.includes('Second question'));
    assert.ok(!sent.includes('First question'), 'earlier history stays server-side');
  });
});
