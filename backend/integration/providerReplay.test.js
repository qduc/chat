// End-to-end: real recorded provider traffic, replayed over loopback, through
// ChatForge's own route, provider adapters, tool execution and persistence.
// No real API calls. Every recording runs through the streaming tool loop
// (agent harness).
//
// Recordings: test_support/provider-replay/fixtures (copied from qduc/term2).
// Expectations about the answer and the tool call are read from the recording
// itself, per wire family, never from ChatForge's parsing of it.
import assert from 'node:assert/strict';
import request from 'supertest';
import { createChatProxyTestContext } from '../test_utils/chatProxyTestUtils.js';
import { ReplayServer, loadFixture } from '../test_support/provider-replay/replayServer.js';
import { PARALLEL_VARIANTS, SECOND_CALL, parallelFixture, sourceFamily } from '../test_support/provider-replay/syntheticFixtures.js';
import { getDb, getMessagesPage } from '../src/db/index.js';
import { tools as toolRegistry } from '../src/lib/tools/index.js';
import { createTool } from '../src/lib/tools/baseTool.js';

const { makeApp, withServer } = createChatProxyTestContext();
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
  // Echoes `a` so parallel calls' results can be told apart.
  handler: async (args) => ({ ...TOOL_OUTPUT, a: args.a }),
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

async function runRecording(family, { fixture = loadFixture(family), cuts } = {}) {
  replay.load(fixture, { cuts });
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
    clientClosed: [...replay.clientClosed],
  };
}

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
    // Continuation (Responses API): only new items, chained to turn 1's response.
    assert.equal(chainedFrom, spec.responseId(turn1), `${family}: chains to the recorded response`);
    assert.ok(!followUp.includes(PROMPT), `${family}: chained follow-up omits earlier history`);
  } else {
    assert.ok(followUp.includes(PROMPT), `${family}: self-contained follow-up keeps the user prompt`);
  }
}

describe('provider replay e2e (recorded real traffic)', () => {
  beforeAll(async () => {
    await replay.start();
    toolRegistry.fixture = fixtureTool;
  });

  afterAll(async () => {
    delete toolRegistry.fixture;
    await replay.stop();
  });

  describe.each(Object.keys(FAMILIES))('%s', (family) => {
    test('replays the recording', async () => {
      const run = await runRecording(family);
      assertMatchesRecording(family, run);
      // Only the Responses API chains tool rounds; every other family sends full history.
      const chained = Boolean(run.requests[1].body?.previous_response_id);
      assert.equal(chained, family === 'openai-responses', `${family}: chains tool rounds only on the Responses API`);
    });
  });
});

// ---------------------------------------------------------------------------
// Parallel tool calls. SYNTHETIC: derived from the real recordings in the
// shape each official SDK parses (test_support/provider-replay/syntheticFixtures.js,
// checked by integration/syntheticFixtureOracle.test.js). Replace with real
// captures when available.
// ---------------------------------------------------------------------------

function assertParallel(variant, run) {
  const family = sourceFamily(variant);
  const spec = FAMILIES[family];
  const [turn1, turn2] = loadFixture(family).turns;
  const first = spec.recordedCall(turn1);
  const answer = spec.answer(turn2);

  assert.equal(run.status, 200);
  assert.deepEqual(run.unexpected, []);
  assert.equal(run.requests.length, 2, `${variant}: both calls answered in one follow-up`);
  assert.equal(run.events.at(-1), '[DONE]');

  // Client stream: both calls, in order, each with its own id and result.
  const calls = run.streamedToolCalls.map((tc) => ({ id: tc.id, name: tc.function?.name, args: JSON.parse(tc.function?.arguments || '{}') }));
  assert.deepEqual(calls.map(({ name, args }) => ({ name, args })), [
    { name: 'fixture', args: first.args },
    { name: 'fixture', args: SECOND_CALL.args },
  ], `${variant}: streamed calls`);
  if (first.id) assert.deepEqual(calls.map((c) => c.id), [first.id, SECOND_CALL.id], `${variant}: call ids`);
  assert.equal(new Set(calls.map((c) => c.id)).size, 2, `${variant}: distinct call ids`);
  const outputByCall = new Map(run.streamedToolOutputs.map((o) => [o.tool_call_id, typeof o.output === 'string' ? JSON.parse(o.output) : o.output]));
  assert.deepEqual(calls.map((c) => outputByCall.get(c.id)?.a), [first.args.a, SECOND_CALL.args.a], `${variant}: each result streamed for its call`);
  assert.equal(run.content, answer);

  // Persistence: both calls on the message, one tool row per call.
  assert.equal(run.assistant?.status, 'final');
  assert.equal(run.assistant?.content, answer);
  assert.deepEqual((run.assistant?.tool_calls ?? []).map((tc) => tc.id), calls.map((c) => c.id));
  assert.deepEqual(
    run.toolOutputs.map((o) => ({ id: o.tool_call_id, status: o.status, a: JSON.parse(o.output).a })).sort((x, y) => x.a - y.a),
    calls.map((c) => ({ id: c.id, status: 'success', a: c.args.a })).sort((x, y) => x.a - y.a),
  );

  // Wire: the follow-up answers both calls in the provider's own format.
  const body = run.requests[1].body;
  const results = FOLLOW_UP_RESULTS[family](body);
  assert.equal(results.length, 2, `${variant}: follow-up carries two results`);
  assert.deepEqual(results.map((r) => r.a).sort(), [first.args.a, SECOND_CALL.args.a].sort(), `${variant}: results' values`);
  if (first.id) assert.deepEqual(results.map((r) => r.id).sort(), [first.id, SECOND_CALL.id].sort(), `${variant}: results' call ids`);
}

const parseOutput = (value) => (typeof value === 'string' ? JSON.parse(value) : value);

/** Tool results in a follow-up request, per wire family: [{ id, a }]. Format rules asserted inline. */
const FOLLOW_UP_RESULTS = {
  'openai-chat'(body) {
    const toolMessages = body.messages.filter((m) => m.role === 'tool');
    // Results follow the assistant message that made the calls.
    const callerIdx = body.messages.findIndex((m) => m.role === 'assistant' && m.tool_calls?.length === 2);
    assert.ok(callerIdx >= 0, 'assistant message with both tool_calls');
    assert.deepEqual(body.messages.slice(callerIdx + 1, callerIdx + 3).map((m) => m.role), ['tool', 'tool']);
    return toolMessages.map((m) => ({ id: m.tool_call_id, a: parseOutput(m.content).a }));
  },
  'openai-responses'(body) {
    const items = Array.isArray(body.input) ? body.input : [];
    return items.filter((i) => i.type === 'function_call_output').map((i) => ({ id: i.call_id, a: parseOutput(i.output).a }));
  },
  anthropic(body) {
    // Results answer the assistant turn holding both tool_use blocks, in the user turn right after it.
    // ChatForge sends one user message per result; the API combines consecutive user messages into
    // one turn ("Consecutive user or assistant turns in your request will be combined into a single
    // turn" — @anthropic-ai/sdk MessageCreateParams.messages).
    const callerIdx = body.messages.findIndex(
      (m) => m.role === 'assistant' && Array.isArray(m.content) && m.content.filter((b) => b.type === 'tool_use').length === 2,
    );
    assert.ok(callerIdx >= 0, 'assistant message with both tool_use blocks');
    const nextAssistant = body.messages.findIndex((m, i) => i > callerIdx && m.role === 'assistant');
    const userTurn = body.messages.slice(callerIdx + 1, nextAssistant === -1 ? undefined : nextAssistant);
    assert.ok(userTurn.length > 0 && userTurn.every((m) => m.role === 'user'), 'results form the next user turn');
    return userTurn
      .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
      .filter((b) => b.type === 'tool_result')
      .map((b) => ({ id: b.tool_use_id, a: parseOutput(typeof b.content === 'string' ? b.content : b.content?.[0]?.text).a }));
  },
  gemini(body) {
    const callParts = body.contents.flatMap((c) => c.parts ?? []).filter((p) => p.functionCall);
    assert.equal(callParts.length, 2, 'model turn replays both functionCall parts');
    // The signature the model gave the first call goes back on that call only.
    assert.deepEqual(callParts.map((p) => Boolean(p.thoughtSignature)), [true, false], 'thoughtSignature on the first call only');
    const responses = body.contents.flatMap((c) => c.parts ?? []).filter((p) => p.functionResponse);
    return responses.map((p) => {
      const response = p.functionResponse.response;
      const payload = parseOutput(response?.content ?? response?.output ?? response);
      return { id: p.functionResponse.id ?? null, a: payload?.a };
    });
  },
};

describe('parallel tool calls (synthetic, derived from real recordings)', () => {
  beforeAll(async () => {
    await replay.start();
    toolRegistry.fixture = fixtureTool;
  });
  afterAll(async () => {
    delete toolRegistry.fixture;
    await replay.stop();
  });

  describe.each(PARALLEL_VARIANTS)('%s', (variant) => {
    const family = sourceFamily(variant);
    test('runs both calls and answers both', async () => {
      const run = await runRecording(family, { fixture: parallelFixture(variant) });
      assertParallel(variant, run);
    });
  });
});

// ---------------------------------------------------------------------------
// Interruptions, built by cutting the REAL recordings short.
// ---------------------------------------------------------------------------

/** The smallest number of turn-2 events after which the answer has started, and that partial text. */
function partialAnswerCut(family) {
  const spec = FAMILIES[family];
  const turn2 = loadFixture(family).turns[1];
  const events = turn2.frames.filter((f) => f.kind === 'sse-event');
  for (let n = 1; n < events.length; n++) {
    const text = spec.answer({ frames: events.slice(0, n) });
    if (text.length > 0) return { afterEvents: n, partial: text, full: spec.answer(turn2) };
  }
  throw new Error(`${family}: no answer text in turn 2`);
}

/** Streams a turn through a real HTTP server, so the client can press Stop mid-answer. */
async function runWithStop(family) {
  const fixture = loadFixture(family);
  const cut = partialAnswerCut(family);
  replay.load(fixture, { cuts: { 1: { afterEvents: cut.afterEvents, then: 'stall' } } });
  const app = makeApp({ mockUser });
  const providerId = seedProvider(family, fixture);
  const requestId = `stop-${family}-${Date.now()}`;

  return withServer(app, async (port) => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-client-request-id': requestId },
      body: JSON.stringify({
        messages: [{ role: 'user', content: PROMPT }],
        model: fixture.capture.model,
        provider_id: providerId,
        stream: true,
        tools: [fixtureTool.spec],
      }),
    });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    let stopped = null;
    const deadline = Date.now() + 8000;
    for (;;) {
      const next = await Promise.race([
        reader.read(),
        new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), Math.max(0, deadline - Date.now()))),
      ]);
      if (next.timeout) throw new Error(`${family}: stream did not finish after Stop`);
      if (next.done) break;
      text += decoder.decode(next.value, { stream: true });
      // Press Stop once the partial answer reached the client and upstream is holding.
      if (!stopped && streamedContentOf(text) === cut.partial) {
        await replay.waitForStall();
        const stop = await fetch(`http://127.0.0.1:${port}/v1/chat/completions/stop`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ request_id: requestId }),
        });
        stopped = plain(await stop.json());
      }
    }
    // Upstream may close just after [DONE]; allow a short grace period.
    const closeDeadline = Date.now() + 2000;
    while (replay.clientClosed.length === 0 && Date.now() < closeDeadline) await new Promise((resolve) => setTimeout(resolve, 25));
    const events = parseSse(text);
    const conversationId = events.find((e) => typeof e === 'object' && e?._conversation)?._conversation?.id;
    const page = conversationId ? getMessagesPage({ conversationId, afterSeq: 0, limit: 50 }) : null;
    return {
      cut,
      stopped,
      events,
      content: streamedContentOf(text),
      assistant: plain(page?.messages?.filter((m) => m.role === 'assistant').at(-1) ?? null),
      requests: replay.requests.length,
      clientClosed: [...replay.clientClosed],
    };
  });
}

const streamedContentOf = (text) =>
  deltas(parseSse(text))
    .map((d) => d.content)
    .filter((c) => typeof c === 'string')
    .join('');

describe('interruptions (real recordings cut short)', () => {
  beforeAll(async () => {
    await replay.start();
    toolRegistry.fixture = fixtureTool;
  });
  afterAll(async () => {
    delete toolRegistry.fixture;
    await replay.stop();
  });

  describe.each(Object.keys(FAMILIES))('%s', (family) => {
    test('Stop mid-answer keeps the partial text and closes upstream', async () => {
      const run = await runWithStop(family);
      assert.deepEqual(run.stopped, { stopped: true });
      assert.equal(run.events.at(-1), '[DONE]', 'stream closes cleanly');
      assert.equal(run.content, run.cut.partial, 'client saw exactly the partial answer');
      assert.equal(run.assistant?.content, run.cut.partial, 'partial answer persisted');
      assert.deepEqual(run.clientClosed, [1], 'ChatForge closed the stalled upstream request');
    });

    test('upstream drops mid-answer: fails fast, keeps the partial text, records an error', async () => {
      const { afterEvents, partial } = partialAnswerCut(family);
      const started = Date.now();
      const run = await runRecording(family, { cuts: { 1: { afterEvents, then: 'drop' } } });
      // Detected from the dropped connection, not the 30 s idle timeout (upstreamLogger tee fix).
      assert.ok(Date.now() - started < 5000, `detected in ${Date.now() - started} ms`);
      assert.equal(run.events.at(-1), '[DONE]', 'client stream closes');
      assert.ok(run.content.startsWith(partial), 'partial answer kept');
      assert.match(run.content.slice(partial.length), /^\[Error: .+\]$/, 'error notice follows the partial text');
      assert.equal(run.assistant?.status, 'error', 'not recorded as a finished answer');
      assert.equal(run.assistant?.content, run.content);
    });
  });
});
