// Runs each scripted conversation through the legacy streaming tool loop and
// the agent-harness loop (AGENT_HARNESS_TOOL_LOOP), over the real
// /v1/chat/completions route, and checks both reach the same outcome.
import assert from 'node:assert/strict';
import request from 'supertest';
import { createChatProxyTestContext } from '../../test_utils/chatProxyTestUtils.js';
import { getMessagesPage } from '../../src/db/index.js';
import { updateUserMaxToolIterations } from '../../src/db/users.js';
import { config } from '../../src/env.js';

const { makeApp, upstream } = createChatProxyTestContext();

const mockUser = { id: 'harness-parity-user', email: 'parity@example.com' };

const sse = (obj) => `data: ${JSON.stringify(obj)}\n\n`;
const textChunks = (text, id = 'chatcmpl-text') => [
  sse({ id, model: 'gpt-3.5-turbo', choices: [{ delta: { content: text } }] }),
  sse({ id, choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } }),
  'data: [DONE]\n\n',
];
const toolCallChunks = (callId, id = 'chatcmpl-tool') => [
  sse({
    id,
    model: 'gpt-3.5-turbo',
    choices: [{ delta: { tool_calls: [{ index: 0, id: callId, type: 'function', function: { name: 'journal', arguments: '' } }] } }],
  }),
  sse({ id, choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"mode":"read"}' } }] } }] }),
  sse({ id, choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
  'data: [DONE]\n\n',
];
const reasoningOnlyChunks = (id = 'chatcmpl-think') => [
  sse({ id, model: 'gpt-3.5-turbo', choices: [{ delta: { reasoning_content: 'Thinking...' } }] }),
  sse({ id, choices: [{ delta: {}, finish_reason: 'stop' }] }),
  'data: [DONE]\n\n',
];

/** Answers upstream chat requests from a script; each entry is one response. */
function scriptUpstream(script) {
  const requests = [];
  upstream.setChatErrorResponder((req, res) => {
    // Title generation shares the endpoint but offers no tools; keep it off the script.
    if (!Array.isArray(req.body?.tools) || req.body.tools.length === 0) {
      return res.json({ id: 'title', choices: [{ message: { role: 'assistant', content: 'Title' }, finish_reason: 'stop' }] });
    }
    requests.push(req.body);
    const next = script[Math.min(requests.length - 1, script.length - 1)];
    if (typeof next === 'function') return next(req, res);
    res.setHeader('Content-Type', 'text/event-stream');
    for (const chunk of next) res.write(chunk);
    res.end();
  });
  return requests;
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
      /* ignore */
    }
  }
  return events;
}

/** Plain text the client renders from content deltas. */
const streamedContent = (events) =>
  events
    .map((e) => (typeof e === 'object' ? e?.choices?.[0]?.delta?.content : undefined))
    .filter((c) => typeof c === 'string')
    .join('');
const streamedToolCallNames = (events) =>
  events.flatMap((e) => (typeof e === 'object' ? e?.choices?.[0]?.delta?.tool_calls ?? [] : [])).map((tc) => tc.function?.name);
const streamedToolOutputIds = (events) => [
  ...new Set(
    events
      .map((e) => (typeof e === 'object' ? e?.choices?.[0]?.delta?.tool_output?.tool_call_id : undefined))
      .filter(Boolean),
  ),
];

async function runTurn({ harness, script, maxIterations }) {
  config.agentHarness.streamingToolLoop = harness;
  const requests = scriptUpstream(script);
  const app = makeApp({ mockUser });
  if (maxIterations) updateUserMaxToolIterations(mockUser.id, maxIterations);

  const res = await request(app)
    .post('/v1/chat/completions')
    .send({ messages: [{ role: 'user', content: 'Look in my journal' }], stream: true, tools: ['journal'] });
  assert.equal(res.status, 200);
  const events = parseSse(res.text);
  const meta = events.find((e) => typeof e === 'object' && e?._conversation);
  const conversationId = meta?._conversation?.id;
  const page = conversationId ? getMessagesPage({ conversationId, afterSeq: 0, limit: 50 }) : null;
  const assistant = page?.messages?.filter((m) => m.role === 'assistant').at(-1) ?? null;
  return {
    requests,
    events,
    done: events.at(-1) === '[DONE]',
    content: streamedContent(events),
    toolCallNames: streamedToolCallNames(events),
    toolOutputIds: streamedToolOutputIds(events),
    assistant,
  };
}

/** The outcome both loops must agree on. */
const summarize = (run) => ({
  upstreamRequests: run.requests.length,
  done: run.done,
  content: run.content,
  toolCallNames: run.toolCallNames,
  toolOutputIds: run.toolOutputIds,
  persistedContent: run.assistant?.content ?? null,
  persistedStatus: run.assistant?.status ?? null,
  persistedToolCalls: (run.assistant?.tool_calls ?? []).map((tc) => ({ id: tc.id, name: tc.function?.name, args: tc.function?.arguments })),
  persistedToolOutputs: (run.assistant?.tool_outputs ?? []).map((o) => ({ id: o.tool_call_id, status: o.status })),
});

async function bothLoops(options) {
  const legacy = await runTurn({ ...options, harness: false });
  const harness = await runTurn({ ...options, harness: true });
  return { legacy, harness };
}

describe('agent harness tool loop parity', () => {
  const original = config.agentHarness.streamingToolLoop;
  afterAll(() => {
    config.agentHarness.streamingToolLoop = original;
  });

  test('tool call then answer', async () => {
    const script = [toolCallChunks('call_1'), textChunks('Your journal is empty.')];
    const { legacy, harness } = await bothLoops({ script });

    assert.deepEqual(summarize(harness), summarize(legacy));
    assert.equal(harness.requests.length, 2);
    assert.equal(harness.content, 'Your journal is empty.');
    assert.deepEqual(harness.toolCallNames, ['journal']);
    assert.deepEqual(harness.toolOutputIds, ['call_1']);

    // The follow-up request carries the call and its result, as legacy sends them.
    const followUp = harness.requests[1].messages;
    const call = followUp.find((m) => m.role === 'assistant' && m.tool_calls);
    const result = followUp.find((m) => m.role === 'tool');
    assert.equal(call.tool_calls[0].id, 'call_1');
    assert.equal(call.tool_calls[0].function.name, 'journal');
    assert.equal(result.tool_call_id, 'call_1');
    const legacyResult = legacy.requests[1].messages.find((m) => m.role === 'tool');
    assert.equal(result.content, legacyResult.content);
  });

  test('reasoning-only response is retried', async () => {
    const script = [reasoningOnlyChunks(), textChunks('Here is the answer.')];
    const { legacy, harness } = await bothLoops({ script });

    assert.deepEqual(summarize(harness), summarize(legacy));
    assert.equal(harness.requests.length, 2);
    assert.equal(harness.content, 'Here is the answer.');
  });

  test('reasoning-only responses past the retry limit end with the warning', async () => {
    const script = [reasoningOnlyChunks('r1'), reasoningOnlyChunks('r2'), reasoningOnlyChunks('r3'), textChunks('unused')];
    const { legacy, harness } = await bothLoops({ script });

    assert.deepEqual(summarize(harness), summarize(legacy));
    assert.equal(harness.requests.length, 3);
    assert.match(harness.content, /^\[Warning: Model returned an incomplete reasoning response/);
    assert.equal(harness.assistant?.status, 'final');
  });

  test('user iteration limit stops a tool loop', async () => {
    const script = [toolCallChunks('call_a', 'a'), toolCallChunks('call_b', 'b'), toolCallChunks('call_c', 'c')];
    const { legacy, harness } = await bothLoops({ script, maxIterations: 2 });

    assert.deepEqual(summarize(harness), summarize(legacy));
    assert.equal(harness.requests.length, 2);
    assert.ok(harness.content.endsWith('[Maximum iterations reached]'));
  });

  test('upstream failure ends the stream with an error', async () => {
    const fail = (_req, res) => res.status(400).json({ error: { message: 'bad request from upstream' } });
    const { legacy, harness } = await bothLoops({ script: [fail] });

    for (const run of [legacy, harness]) {
      assert.ok(run.done, 'stream ends with [DONE]');
      assert.match(run.content, /\[Error: .*bad request from upstream.*\]/);
      assert.equal(run.assistant?.status, 'error');
    }
  });
});
