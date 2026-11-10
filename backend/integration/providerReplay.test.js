// End-to-end: real recorded provider traffic, replayed over loopback, through
// ChatForge's own route, provider adapters, tool execution and persistence.
// No real API calls. Every recording runs through both streaming tool loops:
// the legacy loop and the agent harness (AGENT_HARNESS_TOOL_LOOP).
//
// Recordings: test_support/provider-replay/fixtures (copied from qduc/term2).
// Expectations about the answer and the tool call are read from the recording
// itself, per wire family, never from ChatForge's parsing of it.
import assert from 'node:assert/strict';
import request from 'supertest';
import { createChatProxyTestContext } from '../test_utils/chatProxyTestUtils.js';
import { ReplayServer, loadFixture } from '../test_support/provider-replay/replayServer.js';
import { getDb, getMessagesPage } from '../src/db/index.js';
import { tools as toolRegistry } from '../src/lib/tools/index.js';
import { createTool } from '../src/lib/tools/baseTool.js';
import { config } from '../src/env.js';

const { makeApp } = createChatProxyTestContext();
const replay = new ReplayServer();

const mockUser = { id: 'provider-replay-user', email: 'replay@example.com' };
const PROMPT = 'Use the fixture tool and then summarize its result.';
const TOOL_OUTPUT = { ok: true, value: 1 };

/** The tool every recording calls, registered for both loops. */
const fixtureTool = createTool({
  name: 'fixture',
  description: 'Returns deterministic fixture data.',
  validate: (args) => {
    if (typeof args?.a !== 'number') throw new Error('fixture.a must be a number');
    return { a: args.a };
  },
  handler: async () => TOOL_OUTPUT,
  openAI: {
    type: 'function',
    function: {
      name: 'fixture',
      description: 'Returns deterministic fixture data.',
      parameters: { type: 'object', properties: { a: { type: 'number' } }, required: ['a'] },
    },
  },
});

const sseData = (turn) =>
  turn.frames
    .filter((frame) => frame.kind === 'sse-event' && frame.data !== '[DONE]')
    .map((frame) => JSON.parse(frame.data));

/**
 * Per wire family: how ChatForge reaches it, and what the recording says
 * happened (the tool call in turn 1, the answer text in turn 2).
 */
const FAMILIES = {
  'openai-chat': {
    providerType: 'openai-completions',
    baseUrl: (url) => url,
    endpoint: /\/v1\/chat\/completions$/,
    recordedCall(turn) {
      const deltas = sseData(turn).flatMap((d) => d.choices?.[0]?.delta?.tool_calls ?? []);
      const call = deltas.find((tc) => tc.id);
      const args = deltas.map((tc) => tc.function?.arguments ?? '').join('');
      return { id: call.id, name: call.function.name, args: JSON.parse(args) };
    },
    answer: (turn) => sseData(turn).map((d) => d.choices?.[0]?.delta?.content ?? '').join(''),
  },
  'openai-responses': {
    providerType: 'openai-responses',
    baseUrl: (url) => url,
    endpoint: /\/v1\/responses$/,
    recordedCall(turn) {
      const item = sseData(turn).find((d) => d.type === 'response.output_item.done' && d.item?.type === 'function_call').item;
      return { id: item.call_id, name: item.name, args: JSON.parse(item.arguments) };
    },
    responseId: (turn) => sseData(turn).find((d) => d.type === 'response.completed').response.id,
    answer: (turn) =>
      sseData(turn)
        .filter((d) => d.type === 'response.output_text.delta')
        .map((d) => d.delta)
        .join(''),
  },
  anthropic: {
    providerType: 'anthropic',
    baseUrl: (url) => url,
    endpoint: /\/v1\/messages$/,
    recordedCall(turn) {
      const events = sseData(turn);
      const start = events.find((d) => d.type === 'content_block_start' && d.content_block?.type === 'tool_use');
      const json = events
        .filter((d) => d.type === 'content_block_delta' && d.index === start.index && d.delta?.type === 'input_json_delta')
        .map((d) => d.delta.partial_json)
        .join('');
      return { id: start.content_block.id, name: start.content_block.name, args: JSON.parse(json || '{}') };
    },
    answer: (turn) =>
      sseData(turn)
        .filter((d) => d.type === 'content_block_delta' && d.delta?.type === 'text_delta')
        .map((d) => d.delta.text)
        .join(''),
  },
  gemini: {
    providerType: 'gemini',
    baseUrl: (url) => `${url}/v1beta`,
    endpoint: /\/v1beta\/models\/[^/]+:streamGenerateContent/,
    // Gemini function calls carry no id; ChatForge mints one.
    recordedCall(turn) {
      const part = sseData(turn)
        .flatMap((d) => d.candidates?.[0]?.content?.parts ?? [])
        .find((p) => p.functionCall);
      return { id: null, name: part.functionCall.name, args: part.functionCall.args };
    },
    answer: (turn) =>
      sseData(turn)
        .flatMap((d) => d.candidates?.[0]?.content?.parts ?? [])
        .filter((p) => typeof p.text === 'string' && !p.thought)
        .map((p) => p.text)
        .join(''),
  },
};

function seedProvider(family, fixture) {
  const db = getDb();
  const now = new Date().toISOString();
  const id = `replay-${family}`;
  db.prepare(`
    INSERT OR REPLACE INTO providers (id, user_id, name, provider_type, api_key, base_url, is_default, enabled, extra_headers, metadata, created_at, updated_at)
    VALUES (@id, @userId, @name, @type, 'replay-key', @baseUrl, 0, 1, '{}', '{}', @now, @now)
  `).run({
    id,
    userId: mockUser.id,
    name: `Replay ${fixture.provider}`,
    type: FAMILIES[family].providerType,
    baseUrl: FAMILIES[family].baseUrl(replay.url),
    now,
  });
  return id;
}

function parseSse(text) {
  const events = [];
  for (const block of text.split('\n\n')) {
    const line = block.split('\n').find((l) => l.startsWith('data: '));
    if (!line) continue;
    const data = line.slice(6);
    if (data === '[DONE]') {
      events.push('[DONE]');
      continue;
    }
    try {
      events.push(JSON.parse(data));
    } catch {
      /* not JSON */
    }
  }
  return events;
}

/** Rows from the DB layer come from another realm under Jest; compare plain JSON. */
const plain = (value) => JSON.parse(JSON.stringify(value));
const toolValue = (output) => (typeof output === 'string' ? JSON.parse(output) : output)?.value;

const deltas = (events) => events.filter((e) => typeof e === 'object').map((e) => e?.choices?.[0]?.delta ?? {});

async function runRecording(family, { harness }) {
  const fixture = loadFixture(family);
  replay.load(fixture);
  config.agentHarness.streamingToolLoop = harness;
  const app = makeApp({ mockUser });
  const providerId = seedProvider(family, fixture);

  const res = await request(app)
    .post('/v1/chat/completions')
    .send({
      messages: [{ role: 'user', content: PROMPT }],
      model: fixture.capture.model,
      provider_id: providerId,
      stream: true,
      tools: [fixtureTool.spec],
    });

  const events = parseSse(res.text);
  const conversationId = events.find((e) => typeof e === 'object' && e?._conversation)?._conversation?.id;
  const page = conversationId ? getMessagesPage({ conversationId, afterSeq: 0, limit: 50 }) : null;
  return {
    fixture,
    status: res.status,
    events,
    content: deltas(events)
      .map((d) => d.content)
      .filter((c) => typeof c === 'string')
      .join(''),
    streamedToolCalls: deltas(events).flatMap((d) => d.tool_calls ?? []),
    streamedToolOutputs: deltas(events).map((d) => d.tool_output).filter(Boolean),
    assistant: plain(page?.messages?.filter((m) => m.role === 'assistant').at(-1) ?? null),
    // Tool results are stored as their own `tool` rows after the assistant message.
    toolOutputs: plain((page?.messages ?? []).filter((m) => m.role === 'tool').flatMap((m) => m.tool_outputs ?? [])),
    requests: replay.requests,
    unexpected: replay.unexpected,
  };
}

/** What a client and the database end up with; both loops must agree on it. */
const outcome = (run) => ({
  status: run.status,
  done: run.events.at(-1) === '[DONE]',
  content: run.content,
  streamedToolCalls: run.streamedToolCalls.map((tc) => ({ id: tc.id, name: tc.function?.name, args: JSON.parse(tc.function?.arguments || '{}') })),
  streamedToolOutputIds: [...new Set(run.streamedToolOutputs.map((o) => o.tool_call_id))],
  persistedStatus: run.assistant?.status ?? null,
  persistedContent: run.assistant?.content ?? null,
  persistedToolCalls: (run.assistant?.tool_calls ?? []).map((tc) => ({ id: tc.id, name: tc.function?.name })),
  persistedToolOutputs: run.toolOutputs.map((o) => ({ id: o.tool_call_id, status: o.status, output: o.output })),
  upstreamRequests: run.requests.length,
});

function assertMatchesRecording(family, run) {
  const spec = FAMILIES[family];
  const [turn1, turn2] = run.fixture.turns;
  const recordedCall = spec.recordedCall(turn1);
  const answer = spec.answer(turn2);
  assert.ok(answer.length > 0, `${family}: recording has an answer`);

  assert.equal(run.status, 200);
  assert.deepEqual(run.unexpected, [], `${family}: no requests beyond the recording`);
  assert.equal(run.requests.length, 2, `${family}: one request per recorded turn`);
  for (const sent of run.requests) assert.match(sent.path, spec.endpoint, `${family}: endpoint`);

  // Client stream: the recorded call, its result, the recorded answer, then [DONE].
  assert.equal(run.events.at(-1), '[DONE]');
  assert.equal(run.streamedToolCalls.length, 1, `${family}: one streamed tool call`);
  const streamedCall = run.streamedToolCalls[0];
  assert.equal(streamedCall.function.name, recordedCall.name);
  assert.deepEqual(JSON.parse(streamedCall.function.arguments), recordedCall.args, `${family}: recorded arguments`);
  if (recordedCall.id) assert.equal(streamedCall.id, recordedCall.id, `${family}: call id round-trips`);
  assert.ok(
    // Legacy streams the tool's raw object, the harness its serialized text; the UI renders either.
    run.streamedToolOutputs.some((o) => o.tool_call_id === streamedCall.id && toolValue(o.output) === TOOL_OUTPUT.value),
    `${family}: tool output streamed for the call`,
  );
  assert.equal(run.content, answer, `${family}: streamed answer is the recorded text`);

  // Persistence: final message with the answer, the call and its output.
  assert.equal(run.assistant?.status, 'final');
  assert.equal(run.assistant?.content, answer);
  assert.deepEqual(
    (run.assistant?.tool_calls ?? []).map((tc) => tc.function?.name),
    [recordedCall.name],
  );
  assert.deepEqual(
    run.toolOutputs.map((o) => ({ id: o.tool_call_id, status: o.status, value: toolValue(o.output) })),
    [{ id: streamedCall.id, status: 'success', value: TOOL_OUTPUT.value }],
  );

  // Wire: the follow-up request carries the call and the tool's output.
  const followUp = JSON.stringify(run.requests[1].body);
  assert.ok(followUp.includes('"fixture"'), `${family}: follow-up names the tool`);
  assert.match(followUp, /value\\?"\s*:\s*1/, `${family}: follow-up carries the tool output`);
  if (recordedCall.id) assert.ok(followUp.includes(recordedCall.id), `${family}: follow-up references the call id`);
  const chainedFrom = run.requests[1].body?.previous_response_id;
  if (chainedFrom) {
    // Continuation (legacy loop, Responses API): only new items, chained to turn 1's response.
    assert.equal(chainedFrom, spec.responseId(turn1), `${family}: chains to the recorded response`);
    assert.ok(!followUp.includes(PROMPT), `${family}: chained follow-up omits earlier history`);
  } else {
    assert.ok(followUp.includes(PROMPT), `${family}: self-contained follow-up keeps the user prompt`);
  }
}

describe('provider replay e2e (recorded real traffic, both tool loops)', () => {
  const originalFlag = config.agentHarness.streamingToolLoop;

  beforeAll(async () => {
    await replay.start();
    toolRegistry.fixture = fixtureTool;
  });

  afterAll(async () => {
    delete toolRegistry.fixture;
    config.agentHarness.streamingToolLoop = originalFlag;
    await replay.stop();
  });

  describe.each(Object.keys(FAMILIES))('%s', (family) => {
    test('legacy loop replays the recording', async () => {
      const run = await runRecording(family, { harness: false });
      assertMatchesRecording(family, run);
      if (family === 'openai-responses') assert.ok(run.requests[1].body?.previous_response_id, 'legacy chains Responses turns');
    });

    test('harness loop replays the recording', async () => {
      const run = await runRecording(family, { harness: true });
      assertMatchesRecording(family, run);
      // Known gap until TurnDeps.continuity is wired: no previous_response_id (see event-mapping doc).
      assert.equal(run.requests[1].body?.previous_response_id, undefined);
    });

    test('both loops reach the same outcome', async () => {
      const legacy = await runRecording(family, { harness: false });
      const harness = await runRecording(family, { harness: true });
      assert.deepEqual(outcome(harness), outcome(legacy));
    });
  });
});
