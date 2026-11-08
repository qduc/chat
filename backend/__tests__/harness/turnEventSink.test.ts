import { describe, expect, jest, test } from '@jest/globals';
import { config } from '../../src/env.js';
import { SimplifiedPersistence } from '../../src/lib/simplifiedPersistence.js';
import { MAX_ITERATIONS_NOTICE, TurnEventSink } from '../../src/lib/harness/turnEventSink.ts';
import type { SinkPersistence } from '../../src/lib/harness/turnEventSink.ts';
import type { ExecutionId, ItemId, ToolCallId, TurnEvent, TurnId } from '../../src/lib/harness/contracts.ts';

function fakeResponse() {
  const frames: string[] = [];
  const res = {
    writableEnded: false,
    write: (chunk: string) => frames.push(chunk),
    end: () => {
      res.writableEnded = true;
    },
  };
  /** Parsed `data:` payloads, `[DONE]` kept as a string. */
  const payloads = () =>
    frames
      .join('')
      .split('\n\n')
      .filter(Boolean)
      .map((frame) => frame.replace(/^data: /, ''))
      .map((data) => (data === '[DONE]' ? data : JSON.parse(data)));
  return { res, payloads };
}

/** Records persistence calls and keeps a content buffer, like SimplifiedPersistence. */
function recordingPersistence() {
  let content = '';
  const calls: Array<[string, ...unknown[]]> = [];
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
    };
  const persistence: SinkPersistence & { content(): string } = {
    persist: true,
    content: () => content,
    appendContent: (delta) => {
      content += delta;
      calls.push(['appendContent', delta]);
    },
    truncateContent: (length) => {
      content = content.slice(0, length);
      calls.push(['truncateContent', length]);
    },
    getContentLength: () => content.length,
    appendReasoningText: record('appendReasoningText'),
    setReasoningDetails: record('setReasoningDetails'),
    setReasoningTokens: record('setReasoningTokens'),
    setUsage: record('setUsage'),
    setResponseId: record('setResponseId'),
    addToolCalls: record('addToolCalls'),
    addToolOutputs: record('addToolOutputs'),
    addMessageEvent: record('addMessageEvent'),
    recordAssistantFinal: record('recordAssistantFinal'),
    markError: record('markError'),
  };
  return { persistence, calls };
}

const turnId = 'turn-1' as TurnId;
const exec = 'exec-1' as ExecutionId;
const callId = 'call_1' as ToolCallId;
const id = (value: string) => value as ItemId;

/** What the harness emits for: think, say "Let me check.", search, then answer. */
const toolTurn: TurnEvent[] = [
  { type: 'reasoning_delta', delta: 'Need a search.' },
  { type: 'text_delta', delta: 'Let me ', modelStep: 1 },
  { type: 'text_delta', delta: 'check.', modelStep: 1 },
  { type: 'tool_call_streaming_delta', turnId, modelStep: 1, callIndex: 0, callId, toolName: 'web_search', argumentCharCount: 5 },
  { type: 'tool_call_streaming_delta', turnId, modelStep: 1, callIndex: 0, callId, toolName: 'web_search', argumentCharCount: 19 },
  {
    type: 'item',
    modelStep: 1,
    item: { type: 'reasoning', id: id('r1'), summary: 'Need a search.', providerMetadata: { reasoning_details: [{ type: 'reasoning.text', index: 0, text: 'Need a search.' }] } },
  },
  { type: 'item', modelStep: 1, item: { type: 'assistant_message', id: id('a1'), content: [{ type: 'text', text: 'Let me check.' }] } },
  {
    type: 'item',
    modelStep: 1,
    item: { type: 'tool_call', id: id('t1'), callId, toolName: 'web_search', input: { query: 'node 24' }, rawArguments: '{"query":"node 24"}' },
  },
  { type: 'usage', modelStep: 1, usage: { inputTokens: 20, outputTokens: 9, cachedInputTokens: 0 } },
  {
    type: 'model_response_completed',
    modelStep: 1,
    stopReason: 'tool_use',
    continuation: 'chatcmpl-1',
    providerMetadata: {
      chatforge: { finishReason: 'tool_calls', responseId: 'chatcmpl-1', usage: { prompt_tokens: 20, completion_tokens: 9, reasoning_tokens: 4 }, model: 'gpt-x', provider: null },
    },
  },
  { type: 'tool_called', executionId: exec, callId, toolName: 'web_search', input: { query: 'node 24' } },
  { type: 'tool_start_requested', executionId: exec, callId, toolName: 'web_search', input: { query: 'node 24' } },
  { type: 'tool_execution_finished', executionId: exec, result: { output: '{"results":[]}', isError: false } },
  { type: 'item', item: { type: 'tool_result', id: id('tr1'), callId, output: '{"results":[]}', isError: false } },
  { type: 'text_delta', delta: 'Nothing found.', modelStep: 2 },
  { type: 'item', modelStep: 2, item: { type: 'assistant_message', id: id('a2'), content: [{ type: 'text', text: 'Nothing found.' }] } },
  {
    type: 'model_response_completed',
    modelStep: 2,
    stopReason: 'end_turn',
    providerMetadata: { chatforge: { finishReason: 'stop', responseId: 'chatcmpl-2', usage: { prompt_tokens: 40, completion_tokens: 3 }, model: 'gpt-x' } },
  },
  { type: 'turn_ended', result: { kind: 'completed' } },
];

describe('TurnEventSink', () => {
  test('streams and persists a tool turn the way the legacy loop does', () => {
    const { res, payloads } = fakeResponse();
    const { persistence, calls } = recordingPersistence();
    const sink = new TurnEventSink({ res, persistence, model: 'gpt-x', completionId: 'chatcmpl-req' });

    for (const event of toolTurn) sink.handle(event);

    const out = payloads();
    const deltas = out.flatMap((p) => (typeof p === 'object' && p.choices ? [p.choices[0].delta] : []));
    expect(deltas).toEqual([
      { reasoning_content: 'Need a search.' },
      { content: 'Let me ' },
      { content: 'check.' },
      { reasoning_details: [{ type: 'reasoning.text', index: 0, text: 'Need a search.' }] },
      {
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'web_search', arguments: '{"query":"node 24"}' }, index: 0 }],
      },
      { tool_output: { tool_call_id: 'call_1', name: 'web_search', output: '{"results":[]}' } },
      { tool_output: { tool_call_id: 'call_1', name: 'web_search', output: '{"results":[]}' } },
      { content: 'Nothing found.' },
    ]);
    expect(out).toContainEqual({ usage: { prompt_tokens: 20, completion_tokens: 9, reasoning_tokens: 4 }, model: 'gpt-x' });
    expect(out.at(-1)).toBe('[DONE]');
    expect(res.writableEnded).toBe(true);

    expect(persistence.content()).toBe('Let me check.Nothing found.');
    expect(calls).toContainEqual(['addMessageEvent', 'tool_call', { tool_call_id: 'call_1', tool_call_index: 0 }]);
    expect(calls).toContainEqual([
      'addToolCalls',
      [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'web_search', arguments: '{"query":"node 24"}' },
          index: 0,
          textOffset: 'Let me check.'.length,
        },
      ],
    ]);
    expect(calls).toContainEqual(['addToolOutputs', [{ tool_call_id: 'call_1', output: '{"results":[]}', status: 'success' }]]);
    expect(calls).toContainEqual(['setReasoningTokens', 4]);
    expect(calls.filter(([name]) => name === 'setResponseId')).toEqual([
      ['setResponseId', 'chatcmpl-1'],
      ['setResponseId', 'chatcmpl-2'],
    ]);
    expect(calls.at(-1)).toEqual(['recordAssistantFinal', { finishReason: 'stop', responseId: null }]);
  });

  test('withdrawn deltas are dropped from the checkpoint', () => {
    const { res, payloads } = fakeResponse();
    const { persistence } = recordingPersistence();
    const sink = new TurnEventSink({ res, persistence, model: 'm' });

    sink.handle({ type: 'text_delta', delta: 'Kept. ', modelStep: 1 });
    sink.handle({ type: 'text_delta', delta: 'Half an ans', modelStep: 2 });
    sink.handle({ type: 'text_delta', delta: '', modelStep: 2, withdrawn: true });
    sink.handle({ type: 'text_delta', delta: 'Full answer.', modelStep: 2 });
    sink.handle({ type: 'turn_ended', result: { kind: 'completed' } });

    expect(persistence.content()).toBe('Kept. Full answer.');
    expect(payloads()).toContainEqual({ type: 'content_withdrawn', value: { modelStep: 2 } });
  });

  test('cancel keeps the partial text and records a cancelled final', () => {
    const { res } = fakeResponse();
    const { persistence, calls } = recordingPersistence();
    const sink = new TurnEventSink({ res, persistence, model: 'm' });

    sink.handle({ type: 'text_delta', delta: 'Partial', modelStep: 1 });
    sink.handle({ type: 'turn_ended', result: { kind: 'cancelled' } });

    expect(persistence.content()).toBe('Partial');
    expect(calls.at(-1)).toEqual(['recordAssistantFinal', { finishReason: 'cancelled', responseId: null }]);
    expect(res.writableEnded).toBe(true);
  });

  test('the loop cap appends the legacy notice', () => {
    const { res } = fakeResponse();
    const { persistence } = recordingPersistence();
    const sink = new TurnEventSink({ res, persistence, model: 'm' });

    sink.handle({ type: 'turn_ended', result: { kind: 'interrupted', terminalCause: 'budget_exhausted' } });

    expect(persistence.content()).toBe(MAX_ITERATIONS_NOTICE);
  });

  test('a failed turn streams the error and marks persistence', () => {
    const { res, payloads } = fakeResponse();
    const { persistence, calls } = recordingPersistence();
    const sink = new TurnEventSink({ res, persistence, model: 'm' });

    sink.handle({
      type: 'turn_ended',
      result: { kind: 'failed', error: { kind: 'provider', message: 'Upstream API error (500): down', retryable: true } },
    });

    expect(persistence.content()).toBe('[Error: Upstream API error (500): down]');
    expect(calls.map(([name]) => name)).toContain('markError');
    expect(payloads().at(-1)).toBe('[DONE]');
  });

  test('retries surface as retry_status events', () => {
    const { res, payloads } = fakeResponse();
    const sink = new TurnEventSink({ res, model: 'm', providerId: 'p1' });

    sink.handle({ type: 'model_retrying', attempt: 1, maxRetries: 3, delayMs: 500 });

    expect(payloads()).toEqual([
      {
        type: 'retry_status',
        value: expect.objectContaining({ modelId: 'm', providerId: 'p1', attempt: 1, maxRetries: 3, retryAfterMs: 500 }),
      },
    ]);
  });

  test('ignores events after the turn ended', () => {
    const { res, payloads } = fakeResponse();
    const sink = new TurnEventSink({ res, model: 'm' });
    sink.handle({ type: 'turn_ended', result: { kind: 'completed' } });
    const count = payloads().length;
    sink.handle({ type: 'text_delta', delta: 'late' });
    expect(payloads()).toHaveLength(count);
    expect(sink.isEnded).toBe(true);
  });
});

describe('SimplifiedPersistence.truncateContent', () => {
  function livePersistence() {
    const persistence = new SimplifiedPersistence(config);
    persistence.persist = true;
    persistence.messageEventsEnabled = true;
    persistence.shouldCheckpoint = () => false;
    persistence.performCheckpoint = jest.fn(() => {
      persistence.lastCheckpointLength = persistence.assistantBuffer.length;
    });
    return persistence;
  }

  test('trims the buffer and the trailing content events', () => {
    const persistence = livePersistence();
    persistence.appendContent('Kept. ');
    persistence.addMessageEvent('tool_call', { tool_call_id: 'c1', tool_call_index: 0 });
    persistence.appendContent('Withdrawn text');

    persistence.truncateContent('Kept. '.length);

    expect(persistence.assistantBuffer).toBe('Kept. ');
    expect(persistence.messageEvents.map((e: { type: string; payload: unknown }) => [e.type, e.payload])).toEqual([
      ['content', { text: 'Kept. ' }],
      ['tool_call', { tool_call_id: 'c1', tool_call_index: 0 }],
    ]);
    expect(persistence.performCheckpoint).not.toHaveBeenCalled();
  });

  test('rewrites a checkpoint that already saved withdrawn text', () => {
    const persistence = livePersistence();
    persistence.appendContent('Kept. Withdrawn');
    persistence.lastCheckpointLength = persistence.assistantBuffer.length;

    persistence.truncateContent('Kept. '.length);

    expect(persistence.performCheckpoint).toHaveBeenCalledTimes(1);
    expect(persistence.lastCheckpointLength).toBe('Kept. '.length);
  });
});
