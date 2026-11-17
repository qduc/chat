// Stored usage: cache tokens and provider-reported cost are persisted, and the
// client-facing `usage.cost` is computed on read.
import { describe, expect, test, beforeEach, beforeAll, afterAll } from '@jest/globals';
import { config } from '../src/env.js';
import { safeTestSetup } from '../test_support/databaseSafety.js';
import {
  getDb,
  resetDbCache,
  upsertSession,
  createConversation,
  insertUserMessage,
  insertAssistantFinal,
  getMessagesPage,
  updateMessageContent,
} from '../src/db/index.js';
import { createUser } from '../src/db/users.js';
import { createProvider } from '../src/db/providers.js';

let user;
let otherUser;

beforeAll(() => {
  safeTestSetup();
});

beforeEach(() => {
  config.persistence.enabled = true;
  config.persistence.dbUrl = 'file::memory:';
  resetDbCache();
  getDb().exec('DELETE FROM messages; DELETE FROM conversations; DELETE FROM sessions; DELETE FROM providers; DELETE FROM users;');
  user = createUser({ email: 'usage-cost@example.com', passwordHash: 'pw', displayName: 'U' });
  otherUser = createUser({ email: 'usage-cost-2@example.com', passwordHash: 'pw', displayName: 'O' });
  upsertSession('sess-usage-cost', { userId: user.id });
  createProvider({ id: 'test-anthropic', name: 'Test Anthropic', provider_type: 'anthropic', user_id: user.id });
  createProvider({
    id: 'test-local',
    name: 'Test Local',
    provider_type: 'openai',
    base_url: 'http://127.0.0.1:8080',
    user_id: user.id,
  });
  createProvider({
    id: 'foreign-local',
    name: 'Foreign Local',
    provider_type: 'openai',
    base_url: 'http://127.0.0.1:8080',
    user_id: otherUser.id,
  });
});

afterAll(() => {
  resetDbCache();
});

function newConversation(id, providerId = 'test-anthropic') {
  createConversation({ id, sessionId: 'sess-usage-cost', userId: user.id, title: 't', provider_id: providerId, model: 'claude-sonnet-4-5' });
  insertUserMessage({ conversationId: id, content: 'hi', seq: 1 });
}

function assistantUsage(conversationId) {
  const page = getMessagesPage({ conversationId });
  return page.messages.find((m) => m.role === 'assistant')?.usage;
}

describe('stored usage and cost', () => {
  test('persists cache tokens and returns a catalog cost with cache savings', () => {
    newConversation('conv-cost-1');
    insertAssistantFinal({
      conversationId: 'conv-cost-1',
      content: 'hello',
      seq: 2,
      tokensIn: 10000,
      tokensOut: 500,
      totalTokens: 10500,
      cacheReadTokens: 6000,
      cacheCreationTokens: 1000,
      providerId: 'test-anthropic',
      model: 'claude-sonnet-4-5-20250929',
    });

    expect(assistantUsage('conv-cost-1')).toEqual({
      prompt_tokens: 10000,
      completion_tokens: 500,
      total_tokens: 10500,
      cache_read_input_tokens: 6000,
      cache_creation_input_tokens: 1000,
      cost: { usd: 0.02205, source: 'catalog', cache_savings_usd: 0.0162 },
      model: 'claude-sonnet-4-5-20250929',
    });
  });

  test('a stored provider charge wins; per-request entries are summed and not exposed', () => {
    newConversation('conv-cost-2');
    insertAssistantFinal({
      conversationId: 'conv-cost-2',
      content: 'hello',
      seq: 2,
      tokensIn: 2000,
      tokensOut: 50,
      providerCostUsd: 0.0007,
      requestUsages: [
        { prompt_tokens: 1000, completion_tokens: 20, provider_cost_usd: 0.0003 },
        { prompt_tokens: 2000, completion_tokens: 50, provider_cost_usd: 0.0004, bogus: 'x' },
      ],
      model: 'anthropic/claude-sonnet-4.5',
    });

    const usage = assistantUsage('conv-cost-2');
    expect(usage.cost).toEqual({ usd: 0.0007, source: 'provider' });
    expect(usage).not.toHaveProperty('requests');
    expect(usage).not.toHaveProperty('provider_cost_usd');

    const raw = getDb().prepare("SELECT metadata_json FROM messages WHERE role = 'assistant'").get();
    expect(JSON.parse(raw.metadata_json).usage.requests).toEqual([
      { prompt_tokens: 1000, completion_tokens: 20, provider_cost_usd: 0.0003 },
      { prompt_tokens: 2000, completion_tokens: 50, provider_cost_usd: 0.0004 },
    ]);
  });

  test('unknown models and local providers get no cost (never $0)', () => {
    newConversation('conv-cost-3');
    insertAssistantFinal({ conversationId: 'conv-cost-3', content: 'a', seq: 2, tokensIn: 10, tokensOut: 5, model: 'mystery-model-xyz' });
    expect(assistantUsage('conv-cost-3')).not.toHaveProperty('cost');

    newConversation('conv-cost-4', 'test-local');
    insertAssistantFinal({ conversationId: 'conv-cost-4', content: 'a', seq: 2, tokensIn: 10, tokensOut: 5, model: 'gpt-4.1' });
    expect(assistantUsage('conv-cost-4')).not.toHaveProperty('cost');
  });

  test('another user\'s provider id is not used for pricing', () => {
    newConversation('conv-cost-5', null);
    insertAssistantFinal({
      conversationId: 'conv-cost-5',
      content: 'a',
      seq: 2,
      tokensIn: 1000,
      tokensOut: 100,
      providerId: 'foreign-local',
      model: 'gpt-4.1',
    });
    // The foreign (local) provider is ignored, so the model id prices from the catalog.
    expect(assistantUsage('conv-cost-5').cost).toEqual({ usd: 0.0028, source: 'catalog' });
  });

  test('falls back to the requested model id when the reported one does not price', () => {
    newConversation('conv-cost-6');
    insertAssistantFinal({
      conversationId: 'conv-cost-6',
      content: 'a',
      seq: 2,
      tokensIn: 1000,
      tokensOut: 100,
      model: 'some-upstream-alias-xyz',
      requestedModel: 'claude-sonnet-4-5',
    });
    expect(assistantUsage('conv-cost-6').cost).toEqual({ usd: 0.0045, source: 'catalog' });
  });

  test('updates keep fields that are not passed and replace ones that are', () => {
    newConversation('conv-cost-7');
    const { id } = insertAssistantFinal({
      conversationId: 'conv-cost-7',
      content: 'a',
      seq: 2,
      tokensIn: 1000,
      tokensOut: 100,
      cacheReadTokens: 400,
      model: 'claude-sonnet-4-5',
    });
    updateMessageContent({ messageId: id, conversationId: 'conv-cost-7', userId: user.id, content: 'b', tokensOut: 200 });
    const usage = assistantUsage('conv-cost-7');
    expect(usage.cache_read_input_tokens).toBe(400);
    expect(usage.completion_tokens).toBe(200);
  });
});
