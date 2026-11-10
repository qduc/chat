// The streaming tool loop (agent harness) over the real /v1/chat/completions
// route, against a scripted upstream. Expected outcomes are the ones the
// legacy loop produced for the same scripts before it was removed.
import assert from 'node:assert/strict';
import request from 'supertest';
import { createChatProxyTestContext } from '../../test_utils/chatProxyTestUtils.js';
import { getMessagesPage } from '../../src/db/index.js';
import { updateUserMaxToolIterations } from '../../src/db/users.js';
import { tools as toolRegistry } from '../../src/lib/tools/index.js';
import { createTool } from '../../src/lib/tools/baseTool.js';

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

const badArgsChunks = (callId, id = 'chatcmpl-bad') => [
  sse({
    id,
    model: 'gpt-3.5-turbo',
    choices: [{ delta: { tool_calls: [{ index: 0, id: callId, type: 'function', function: { name: 'journal', arguments: '{"mode":' } }] } }],
  }),
  sse({ id, choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
  'data: [DONE]\n\n',
];
const throwingToolChunks = (callId, id = 'chatcmpl-boom') => [
  sse({
    id,
    model: 'gpt-3.5-turbo',
    choices: [{ delta: { tool_calls: [{ index: 0, id: callId, type: 'function', function: { name: 'boom', arguments: '{}' } }] } }],
  }),
  sse({ id, choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
  'data: [DONE]\n\n',
];
/** A non-streaming upstream reply (one JSON body). */
const jsonReply = (message, finishReason) => (_req, res) =>
  res.json({
    id: 'chatcmpl-json',
    model: 'gpt-3.5-turbo',
    choices: [{ index: 0, message, finish_reason: finishReason }],
    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
  });

const boomTool = createTool({
  name: 'boom',
  description: 'Always throws.',
  validate: (args) => args ?? {},
  handler: async () => {
    throw new Error('kaboom');
  },
  openAI: {
    type: 'function',
    function: { name: 'boom', description: 'Always throws.', parameters: { type: 'object', properties: {} } },
  },
});

async function runTurn({ script, maxIterations = 10, tools = ['journal'], extra = {} }) {
  const requests = scriptUpstream(script);
  const app = makeApp({ mockUser });
  updateUserMaxToolIterations(mockUser.id, maxIterations);

  const res = await request(app)
    .post('/v1/chat/completions')
    .send({ messages: [{ role: 'user', content: 'Look in my journal' }], stream: true, tools, ...extra });
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
    // Tool results are stored as their own `tool` rows after the assistant message.
    // Rows come from another realm under jest's VM modules; plain copies compare strictly.
    toolRows: JSON.parse(
      JSON.stringify(
        (page?.messages ?? [])
          .filter((m) => m.role === 'tool')
          .flatMap((m) => m.tool_outputs ?? [])
          .map((o) => ({ id: o.tool_call_id, status: o.status, output: o.output })),
      ),
    ),
  };
}

/** What the client and the database end up with. */
const summarize = (run) => ({
  upstreamRequests: run.requests.length,
  done: run.done,
  content: run.content,
  toolCallNames: run.toolCallNames,
  toolOutputIds: run.toolOutputIds,
  persistedContent: run.assistant?.content ?? null,
  persistedStatus: run.assistant?.status ?? null,
  persistedToolCalls: (run.assistant?.tool_calls ?? []).map((tc) => ({ id: tc.id, name: tc.function?.name, args: tc.function?.arguments })),
});

const INCOMPLETE_REASONING =
  '[Warning: Model returned an incomplete reasoning response (no tool call and no completion). Proceeding after retries.]';
const JOURNAL_READ = { name: 'journal', args: '{"mode":"read"}' };

describe('streaming tool loop', () => {
  beforeAll(() => {
    toolRegistry.boom = boomTool;
  });
  afterAll(() => {
    delete toolRegistry.boom;
  });

  test('tool call then answer', async () => {
    const run = await runTurn({ script: [toolCallChunks('call_1'), textChunks('Your journal is empty.')] });

    assert.deepEqual(summarize(run), {
      upstreamRequests: 2,
      done: true,
      content: 'Your journal is empty.',
      toolCallNames: ['journal'],
      toolOutputIds: ['call_1'],
      persistedContent: 'Your journal is empty.',
      persistedStatus: 'final',
      persistedToolCalls: [{ id: 'call_1', ...JOURNAL_READ }],
    });

    // The follow-up request carries the call and its result.
    const followUp = run.requests[1].messages;
    const call = followUp.find((m) => m.role === 'assistant' && m.tool_calls);
    const result = followUp.find((m) => m.role === 'tool');
    assert.equal(call.tool_calls[0].id, 'call_1');
    assert.equal(call.tool_calls[0].function.name, 'journal');
    assert.equal(result.tool_call_id, 'call_1');
    assert.deepEqual(JSON.parse(result.content), { entries: [], page: 1, pageSize: 10 });
    assert.deepEqual(run.toolRows, [{ id: 'call_1', status: 'success', output: result.content }]);
  });

  test('reasoning-only response is retried', async () => {
    const run = await runTurn({ script: [reasoningOnlyChunks(), textChunks('Here is the answer.')] });

    assert.deepEqual(summarize(run), {
      upstreamRequests: 2,
      done: true,
      content: 'Here is the answer.',
      toolCallNames: [],
      toolOutputIds: [],
      persistedContent: 'Here is the answer.',
      persistedStatus: 'final',
      persistedToolCalls: [],
    });
  });

  test('reasoning-only responses past the retry limit end with the warning', async () => {
    const script = [reasoningOnlyChunks('r1'), reasoningOnlyChunks('r2'), reasoningOnlyChunks('r3'), textChunks('unused')];
    const run = await runTurn({ script });

    assert.deepEqual(summarize(run), {
      upstreamRequests: 3,
      done: true,
      content: INCOMPLETE_REASONING,
      toolCallNames: [],
      toolOutputIds: [],
      persistedContent: INCOMPLETE_REASONING,
      persistedStatus: 'final',
      persistedToolCalls: [],
    });
  });

  test('user iteration limit stops a tool loop', async () => {
    const script = [toolCallChunks('call_a', 'a'), toolCallChunks('call_b', 'b'), toolCallChunks('call_c', 'c')];
    const run = await runTurn({ script, maxIterations: 2 });

    assert.deepEqual(summarize(run), {
      upstreamRequests: 2,
      done: true,
      content: '\n\n[Maximum iterations reached]',
      toolCallNames: ['journal', 'journal'],
      toolOutputIds: ['call_a', 'call_b'],
      persistedContent: '\n\n[Maximum iterations reached]',
      persistedStatus: 'final',
      persistedToolCalls: [
        { id: 'call_a', ...JOURNAL_READ },
        { id: 'call_b', ...JOURNAL_READ },
      ],
    });
  });

  test('upstream failure ends the stream with an error', async () => {
    const fail = (_req, res) => res.status(400).json({ error: { message: 'bad request from upstream' } });
    const run = await runTurn({ script: [fail] });

    const error = '[Error: Upstream API error (400): bad request from upstream]';
    assert.deepEqual(summarize(run), {
      upstreamRequests: 1,
      done: true,
      content: error,
      toolCallNames: [],
      toolOutputIds: [],
      persistedContent: error,
      persistedStatus: 'error',
      persistedToolCalls: [],
    });
  });

  test('a throwing tool reports the error to the model and the turn continues', async () => {
    const run = await runTurn({ script: [throwingToolChunks('call_boom'), textChunks('The tool failed.')], tools: [boomTool.spec] });

    assert.equal(run.requests.length, 2);
    assert.equal(run.content, 'The tool failed.');
    assert.equal(run.assistant?.status, 'final');
    const expected = "Error executing tool 'boom': kaboom. Please check the arguments and try again.";
    assert.equal(run.requests[1].messages.find((m) => m.role === 'tool')?.content, expected);
    assert.deepEqual(run.toolRows, [{ id: 'call_boom', status: 'error', output: expected }]);
  });

  test('malformed tool arguments tell the model what it sent', async () => {
    const run = await runTurn({ script: [badArgsChunks('call_bad'), textChunks('Sorry.')] });

    // Same text the legacy loop sent, so the model can fix its JSON.
    const expected =
      'Error: Invalid JSON in tool arguments. Please check the JSON syntax and try again. ' +
      'Arguments received: {"mode":. Error details: Unexpected end of JSON input';
    assert.equal(run.requests.length, 2);
    assert.equal(run.requests[1].messages.find((m) => m.role === 'tool')?.content, expected);
    assert.deepEqual(run.toolRows, [{ id: 'call_bad', status: 'error', output: expected }]);
    assert.equal(run.content, 'Sorry.');
    assert.equal(run.assistant?.status, 'final');
  });

  test('provider_stream:false sends non-streaming upstream requests', async () => {
    const script = [
      jsonReply(
        { role: 'assistant', content: null, tool_calls: [{ id: 'call_j', type: 'function', function: { name: 'journal', arguments: '{"mode":"read"}' } }] },
        'tool_calls',
      ),
      jsonReply({ role: 'assistant', content: 'Done without streaming.' }, 'stop'),
    ];
    const run = await runTurn({ script, extra: { provider_stream: false } });

    // The frontend falls back to this when a model can't stream; upstream must see stream:false.
    assert.deepEqual(run.requests.map((r) => r.stream), [false, false]);
    assert.deepEqual(summarize(run), {
      upstreamRequests: 2,
      done: true,
      content: 'Done without streaming.',
      toolCallNames: ['journal'],
      toolOutputIds: ['call_j'],
      persistedContent: 'Done without streaming.',
      persistedStatus: 'final',
      persistedToolCalls: [{ id: 'call_j', ...JOURNAL_READ }],
    });
  });

  test('streams upstream by default', async () => {
    const run = await runTurn({ script: [toolCallChunks('call_s'), textChunks('ok')] });
    assert.deepEqual(run.requests.map((r) => r.stream), [true, true]);
  });
});
