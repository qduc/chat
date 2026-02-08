/**
 * Unit tests for useConversationHydration pure helpers.
 *
 * These cover the extracted pure functions (hydrateMessages, resolveModelAndProvider,
 * buildLinkedConversationMap, mergeLinkedMessages) independently from React state.
 * Integration-level tests for selectConversation remain in hooks.useChat.test.tsx.
 */

import {
  hydrateMessages,
  resolveModelAndProvider,
  buildLinkedConversationMap,
  mergeLinkedMessages,
} from '../hooks/useConversationHydration';

// ---------------------------------------------------------------------------
// hydrateMessages
// ---------------------------------------------------------------------------

describe('hydrateMessages', () => {
  const now = new Date().toISOString();

  test('maps raw API messages to Message shape', () => {
    const raw = [
      { id: 'u1', role: 'user', content: 'Hello', created_at: now },
      { id: 'a1', role: 'assistant', content: 'Hi there', created_at: now },
    ];
    const result = hydrateMessages(raw);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: 'u1', role: 'user', content: 'Hello' });
    expect(result[1]).toMatchObject({ id: 'a1', role: 'assistant', content: 'Hi there' });
  });

  test('prepends reasoning text to assistant content when no message_events', () => {
    const raw = [
      {
        id: 'a1',
        role: 'assistant',
        content: 'Answer',
        created_at: now,
        reasoning_details: [{ text: 'Thought A' }, { text: 'Thought B' }],
      },
    ];
    const result = hydrateMessages(raw);
    // prependReasoningToContent wraps reasoning in <details> block
    expect(typeof result[0].content).toBe('string');
    expect(result[0].content as string).toContain('Thought A');
    expect(result[0].content as string).toContain('Answer');
  });

  test('does NOT prepend reasoning when message_events exist', () => {
    const raw = [
      {
        id: 'a1',
        role: 'assistant',
        content: 'Answer',
        created_at: now,
        reasoning_details: [{ text: 'Thought' }],
        message_events: [{ type: 'tool_use', data: {} }],
      },
    ];
    const result = hydrateMessages(raw);
    // content should remain unchanged because message_events are present
    expect(result[0].content).toBe('Answer');
  });

  test('preserves usage and provider fields', () => {
    const raw = [
      {
        id: 'a1',
        role: 'assistant',
        content: 'X',
        created_at: now,
        usage: { prompt_tokens: 10, completion_tokens: 5 },
        provider: 'openai',
      },
    ];
    const result = hydrateMessages(raw);
    expect(result[0].usage).toEqual({ prompt_tokens: 10, completion_tokens: 5 });
    expect(result[0].provider).toBe('openai');
  });

  test('handles null/undefined content gracefully', () => {
    const raw = [
      { id: 'u1', role: 'user', content: null, created_at: now },
      { id: 'a1', role: 'assistant', created_at: now },
    ];
    const result = hydrateMessages(raw);
    expect(result[0].content).toBe('');
    expect(result[1].content).toBe('');
  });
});

// ---------------------------------------------------------------------------
// resolveModelAndProvider
// ---------------------------------------------------------------------------

describe('resolveModelAndProvider', () => {
  const modelToProvider: Record<string, string> = {
    'gpt-4o': 'openai',
    'gpt-4o-mini': 'openai',
    'claude-3-opus': 'anthropic',
  };

  test('returns null model when rawModel is null', () => {
    const result = resolveModelAndProvider(null, 'openai', modelToProvider);
    expect(result).toEqual({ modelValue: null, providerId: 'openai' });
  });

  test('prefixes model with explicit provider', () => {
    const result = resolveModelAndProvider('gpt-4o', 'openai', modelToProvider);
    expect(result).toEqual({ modelValue: 'openai::gpt-4o', providerId: 'openai' });
  });

  test('looks up provider from map when not provided', () => {
    const result = resolveModelAndProvider('gpt-4o', null, modelToProvider);
    expect(result).toEqual({ modelValue: 'openai::gpt-4o', providerId: 'openai' });
  });

  test('handles model already containing :: prefix', () => {
    const result = resolveModelAndProvider('openai::gpt-4o', null, modelToProvider);
    expect(result).toEqual({ modelValue: 'openai::gpt-4o', providerId: 'openai' });
  });

  test('prefers explicit provider over :: prefix', () => {
    const result = resolveModelAndProvider('anthropic::gpt-4o', 'custom', modelToProvider);
    expect(result).toEqual({ modelValue: 'custom::gpt-4o', providerId: 'custom' });
  });

  test('returns raw model when no provider available', () => {
    const result = resolveModelAndProvider('unknown-model', null, {});
    expect(result).toEqual({ modelValue: 'unknown-model', providerId: undefined });
  });
});

// ---------------------------------------------------------------------------
// buildLinkedConversationMap
// ---------------------------------------------------------------------------

describe('buildLinkedConversationMap', () => {
  const modelToProvider: Record<string, string> = {
    'gpt-4o': 'openai',
    'gpt-4o-mini': 'openai',
  };

  test('returns empty for undefined linked conversations', () => {
    const result = buildLinkedConversationMap(undefined, modelToProvider, 'openai::gpt-4o');
    expect(result).toEqual({ linkedMap: {}, compareModelIds: [] });
  });

  test('returns empty for empty array', () => {
    const result = buildLinkedConversationMap([], modelToProvider, 'openai::gpt-4o');
    expect(result).toEqual({ linkedMap: {}, compareModelIds: [] });
  });

  test('builds map and excludes primary model from compareModelIds', () => {
    const linked = [
      { id: 'conv-mini', model: 'gpt-4o-mini', provider_id: 'openai' },
      { id: 'conv-claude', model: 'claude-3-opus', provider_id: 'anthropic' },
    ];
    const result = buildLinkedConversationMap(linked, modelToProvider, 'openai::gpt-4o');
    expect(result.linkedMap).toEqual({
      'openai::gpt-4o-mini': 'conv-mini',
      'anthropic::claude-3-opus': 'conv-claude',
    });
    expect(result.compareModelIds).toEqual(['openai::gpt-4o-mini', 'anthropic::claude-3-opus']);
  });

  test('normalizes models already containing :: prefix', () => {
    const linked = [{ id: 'conv-1', model: 'openai::gpt-4o-mini', provider_id: '' }];
    const result = buildLinkedConversationMap(linked, modelToProvider, 'openai::gpt-4o');
    expect(result.linkedMap).toEqual({ 'openai::gpt-4o-mini': 'conv-1' });
  });

  test('excludes primary model from compare list', () => {
    const linked = [
      { id: 'conv-self', model: 'gpt-4o', provider_id: 'openai' },
      { id: 'conv-other', model: 'gpt-4o-mini', provider_id: 'openai' },
    ];
    const result = buildLinkedConversationMap(linked, modelToProvider, 'openai::gpt-4o');
    // Primary model is excluded from compareModelIds but present in map
    expect(result.compareModelIds).toEqual(['openai::gpt-4o-mini']);
    expect(Object.keys(result.linkedMap)).toHaveLength(2);
  });

  test('skips entries without model', () => {
    const linked = [
      { id: 'conv-no-model' },
      { id: 'conv-ok', model: 'gpt-4o-mini', provider_id: 'openai' },
    ];
    const result = buildLinkedConversationMap(linked, modelToProvider, 'openai::gpt-4o');
    expect(Object.keys(result.linkedMap)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// mergeLinkedMessages
// ---------------------------------------------------------------------------

describe('mergeLinkedMessages', () => {
  const modelToProvider: Record<string, string> = { 'gpt-4o-mini': 'openai' };

  test('returns empty for undefined linked conversations', () => {
    expect(mergeLinkedMessages(undefined, modelToProvider)).toEqual([]);
  });

  test('returns empty for empty array', () => {
    expect(mergeLinkedMessages([], modelToProvider)).toEqual([]);
  });

  test('skips entries with no messages', () => {
    const linked = [{ id: 'c1', model: 'gpt-4o-mini', provider_id: 'openai', messages: [] }];
    expect(mergeLinkedMessages(linked, modelToProvider)).toEqual([]);
  });

  test('extracts assistant messages grouped by normalized model', () => {
    const linked = [
      {
        id: 'c1',
        model: 'gpt-4o-mini',
        provider_id: 'openai',
        messages: [
          { id: 'u1', role: 'user', content: 'Q' },
          { id: 'a1', role: 'assistant', content: 'A1' },
          { id: 'a2', role: 'assistant', content: 'A2' },
        ],
      },
    ];
    const result = mergeLinkedMessages(linked, modelToProvider);
    expect(result).toHaveLength(1);
    expect(result[0].normalizedModel).toBe('openai::gpt-4o-mini');
    expect(result[0].assistants).toHaveLength(2);
    expect(result[0].assistants[0].content).toBe('A1');
  });

  test('handles multiple linked conversations', () => {
    const linked = [
      {
        id: 'c1',
        model: 'gpt-4o-mini',
        provider_id: 'openai',
        messages: [{ id: 'a1', role: 'assistant', content: 'Mini' }],
      },
      {
        id: 'c2',
        model: 'claude-3',
        provider_id: 'anthropic',
        messages: [{ id: 'a2', role: 'assistant', content: 'Claude' }],
      },
    ];
    const result = mergeLinkedMessages(linked, modelToProvider);
    expect(result).toHaveLength(2);
  });
});
