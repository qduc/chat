// The tool loop (agent harness) over the real /v1/chat/completions route,
// against a scripted upstream, as a streamed reply and as one JSON reply
// (`stream: false`). Streaming expectations are the ones the legacy loop
// produced for the same scripts before it was removed.
import assert from 'node:assert/strict';
import request from 'supertest';
import { createChatProxyTestContext } from '../../test_utils/chatProxyTestUtils.js';
import { getMessagesPage } from '../../src/db/index.js';
import { updateUserMaxToolIterations } from '../../src/db/users.js';
import { tools as toolRegistry } from '../../src/lib/tools/index.js';
import { createTool } from '../../src/lib/tools/baseTool.js';
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


/** Echoes its arguments, to check they reach the tool and the model intact. */
const echoTool = createTool({
  name: 'echo',
  description: 'Returns its input.',
  validate: (args) => args ?? {},
  handler: async (args) => ({ echoed: args }),
  openAI: {
    type: 'function',
    function: { name: 'echo', description: 'Returns its input.', parameters: { type: 'object', properties: { text: { type: 'string' } } } },
  },
});
/** Returns a large result. */
const LARGE_OUTPUT = 'x'.repeat(200_000);
const largeTool = createTool({
  name: 'large',
  description: 'Returns a large result.',
  validate: (args) => args ?? {},
  handler: async () => LARGE_OUTPUT,
  openAI: { type: 'function', function: { name: 'large', description: 'Returns a large result.', parameters: { type: 'object', properties: {} } } },
});

const callChunks = (calls, id = 'chatcmpl-calls', leadingText = '') => [
  ...(leadingText ? [sse({ id, model: 'gpt-3.5-turbo', choices: [{ delta: { content: leadingText } }] })] : []),
  sse({
    id,
    model: 'gpt-3.5-turbo',
    choices: [
      {
        delta: {
          tool_calls: calls.map(([callId, name, args], index) => ({ index, id: callId, type: 'function', function: { name, arguments: args } })),
        },
      },
    ],
  }),
  sse({ id, choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
  'data: [DONE]\n\n',
];

/** What a provider returns for the same scripted answer when asked not to stream. */
function chunksToCompletion(chunks) {
  const message = { role: 'assistant', content: '' };
  let reasoning = '';
  const calls = [];
  let finish = null;
  let id = null;
  let model = null;
  let usage;
  for (const raw of chunks) {
    const data = raw.replace(/^data: /, '').trim();
    if (!data || data === '[DONE]') continue;
    const obj = JSON.parse(data);
    id ??= obj.id;
    model ??= obj.model;
    if (obj.usage) usage = obj.usage;
    const choice = obj.choices?.[0] ?? {};
    const delta = choice.delta ?? {};
    if (delta.content) message.content += delta.content;
    if (delta.reasoning_content) reasoning += delta.reasoning_content;
    for (const tc of delta.tool_calls ?? []) {
      const slot = (calls[tc.index] ??= { id: tc.id, type: 'function', function: { name: '', arguments: '' } });
      if (tc.id) slot.id = tc.id;
      if (tc.function?.name) slot.function.name = tc.function.name;
      if (tc.function?.arguments) slot.function.arguments += tc.function.arguments;
    }
    if (choice.finish_reason) finish = choice.finish_reason;
  }
  if (reasoning) message.reasoning_content = reasoning;
  if (calls.length) message.tool_calls = calls;
  if (!message.content && calls.length) message.content = null;
  return { id, object: 'chat.completion', model, choices: [{ index: 0, message, finish_reason: finish }], ...(usage ? { usage } : {}) };
}

/** Script entries answer as SSE, or as one JSON completion when the request asks not to stream. */
const streamOrJson = (script) =>
  script.map((entry) =>
    typeof entry === 'function'
      ? entry
      : (req, res) => {
          if (req.body?.stream === false) return res.json(chunksToCompletion(entry));
          res.setHeader('Content-Type', 'text/event-stream');
          for (const chunk of entry) res.write(chunk);
          res.end();
        },
  );

/** Plain copies: rows come from another realm under jest's VM modules. */
const plain = (value) => JSON.parse(JSON.stringify(value));

function readConversation(conversationId) {
  const page = conversationId ? getMessagesPage({ conversationId, afterSeq: 0, limit: 50 }) : null;
  const assistant = page?.messages?.filter((m) => m.role === 'assistant').at(-1) ?? null;
  const toolRows = (page?.messages ?? [])
    .filter((m) => m.role === 'tool')
    .flatMap((m) => m.tool_outputs ?? [])
    .map((o) => ({ id: o.tool_call_id, status: o.status, output: o.output }));
  return plain({ assistant, toolRows });
}

async function runTurn({ script, maxIterations = 10, tools = ['journal'], extra = {} }) {
  const requests = scriptUpstream(streamOrJson(script));
  const app = makeApp({ mockUser });
  updateUserMaxToolIterations(mockUser.id, maxIterations);

  const res = await request(app)
    .post('/v1/chat/completions')
    .send({ messages: [{ role: 'user', content: 'Look in my journal' }], stream: true, tools, ...extra });
  assert.equal(res.status, 200);
  const events = parseSse(res.text);
  const meta = events.find((e) => typeof e === 'object' && e?._conversation);
  const { assistant, toolRows } = readConversation(meta?._conversation?.id);
  return {
    requests,
    events,
    done: events.at(-1) === '[DONE]',
    content: streamedContent(events),
    toolCallNames: streamedToolCallNames(events),
    toolOutputIds: streamedToolOutputIds(events),
    streamedToolCalls: events.flatMap((e) => (typeof e === 'object' ? (e?.choices?.[0]?.delta?.tool_calls ?? []) : [])),
    streamedToolOutputs: events.map((e) => (typeof e === 'object' ? e?.choices?.[0]?.delta?.tool_output : undefined)).filter(Boolean),
    assistant,
    toolRows,
  };
}

/** The same request with `stream: false`: one JSON reply. */
async function runJson({ script, maxIterations = 10, tools = ['journal'], extra = {} }) {
  const requests = scriptUpstream(streamOrJson(script));
  const app = makeApp({ mockUser });
  updateUserMaxToolIterations(mockUser.id, maxIterations);

  const res = await request(app)
    .post('/v1/chat/completions')
    .send({ messages: [{ role: 'user', content: 'Look in my journal' }], stream: false, tools, ...extra });
  const body = plain(res.body ?? null);
  const { assistant, toolRows } = readConversation(body?._conversation?.id);
  return { status: res.status, body, requests, assistant, toolRows };
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

const TEST_TOOLS = { boom: boomTool, echo: echoTool, large: largeTool };
beforeAll(() => Object.assign(toolRegistry, TEST_TOOLS));
afterAll(() => {
  for (const name of Object.keys(TEST_TOOLS)) delete toolRegistry[name];
});

const EMPTY_JOURNAL = '{"entries":[],"page":1,"pageSize":10}';

describe('streaming tool loop', () => {

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

describe('streaming tool loop: edge cases', () => {
  test('text and tool calls in one response keep their order and offsets', async () => {
    const run = await runTurn({ script: [callChunks([['call_t', 'journal', '{"mode":"read"}']], 'tt', 'Let me check. '), textChunks('Empty.')] });

    assert.equal(run.content, 'Let me check. Empty.');
    assert.equal(run.assistant?.content, 'Let me check. Empty.');
    assert.deepEqual(run.toolCallNames, ['journal']);
    // The call sits after the text that preceded it.
    assert.equal(run.assistant?.tool_calls?.[0]?.textOffset, 'Let me check. '.length);
  });

  test('two calls in one response get indexes 0 and 1', async () => {
    const run = await runTurn({
      script: [callChunks([['call_x', 'journal', '{"mode":"read"}'], ['call_y', 'journal', '{"mode":"read"}']], 'two'), textChunks('Both empty.')],
    });

    assert.deepEqual(run.streamedToolCalls.map((tc) => [tc.id, tc.index]), [['call_x', 0], ['call_y', 1]]);
    assert.deepEqual(run.assistant?.tool_calls?.map((tc) => [tc.id, tc.index]), [['call_x', 0], ['call_y', 1]]);
    assert.deepEqual(run.toolRows.map((r) => r.id).sort(), ['call_x', 'call_y']);
    assert.equal(run.content, 'Both empty.');
  });

  test('special characters in tool arguments reach the tool and the model intact', async () => {
    const text = 'quote " backslash \\ newline \n emoji 🧪 accents éàü <tag> & ${x}';
    const args = JSON.stringify({ text });
    const run = await runTurn({ script: [callChunks([['call_e', 'echo', args]], 'echo'), textChunks('ok')], tools: [echoTool.spec] });

    assert.deepEqual(JSON.parse(run.streamedToolOutputs[0].output), { echoed: { text } });
    assert.deepEqual(JSON.parse(run.requests[1].messages.find((m) => m.role === 'tool').content), { echoed: { text } });
    assert.equal(run.assistant?.tool_calls?.[0]?.function?.arguments, args);
  });

  test('a large tool output is streamed, sent upstream and stored whole', async () => {
    const run = await runTurn({ script: [callChunks([['call_l', 'large', '{}']], 'large'), textChunks('done')], tools: [largeTool.spec] });

    assert.equal(run.streamedToolOutputs[0].output, LARGE_OUTPUT);
    assert.equal(run.requests[1].messages.find((m) => m.role === 'tool').content, LARGE_OUTPUT);
    assert.deepEqual(run.toolRows, [{ id: 'call_l', status: 'success', output: LARGE_OUTPUT }]);
  });

  test('malformed SSE lines from the provider are skipped', async () => {
    const garbled = [
      sse({ id: 'g', model: 'gpt-3.5-turbo', choices: [{ delta: { content: 'Hello' } }] }),
      'data: {not json\n\n',
      ': keep-alive comment\n\n',
      sse({ id: 'g', choices: [{ delta: { content: ' world' } }] }),
      sse({ id: 'g', choices: [{ delta: {}, finish_reason: 'stop' }] }),
      'data: [DONE]\n\n',
    ];
    const run = await runTurn({ script: [garbled] });

    assert.equal(run.content, 'Hello world');
    assert.equal(run.assistant?.content, 'Hello world');
    assert.equal(run.assistant?.status, 'final');
  });

  test('an upstream that goes quiet fails after the idle timeout', async () => {
    const original = config.providerConfig.streamTimeoutMs;
    config.providerConfig.streamTimeoutMs = 300;
    try {
      const stall = (_req, res) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.write(sse({ id: 's', model: 'gpt-3.5-turbo', choices: [{ delta: { content: 'Partial' } }] }));
        // Never ends; the test server closes it on teardown.
      };
      const started = Date.now();
      const run = await runTurn({ script: [stall] });

      assert.ok(Date.now() - started < 5000, `failed after ${Date.now() - started} ms`);
      assert.ok(run.done, 'stream ends with [DONE]');
      assert.equal(run.content, 'Partial[Error: Stream timeout - no response from upstream API]');
      assert.equal(run.assistant?.status, 'error');
      assert.equal(run.assistant?.content, run.content);
    } finally {
      config.providerConfig.streamTimeoutMs = original;
    }
  });
});

describe('non-streaming tool loop (stream: false)', () => {
  test('tool call then answer, as one JSON reply', async () => {
    const run = await runJson({ script: [toolCallChunks('call_1'), textChunks('Your journal is empty.')] });

    assert.equal(run.status, 200);
    // Upstream is asked not to stream either, unless provider_stream says otherwise.
    assert.deepEqual(run.requests.map((r) => r.stream), [false, false]);
    assert.equal(run.body.object, 'chat.completion');
    assert.deepEqual(run.body.choices[0].message, { role: 'assistant', content: 'Your journal is empty.' });
    assert.equal(run.body.choices[0].finish_reason, 'stop');
    assert.equal(run.body.usage.total_tokens, 7);
    assert.ok(run.body._conversation?.id, 'conversation metadata');
    assert.deepEqual(run.body.tool_events, [
      { type: 'tool_call', value: { id: 'call_1', type: 'function', function: { name: 'journal', arguments: '{"mode":"read"}' }, index: 0 } },
      // The journal ran for the signed-in user (the legacy JSON loop dropped the user on single calls).
      { type: 'tool_output', value: { tool_call_id: 'call_1', name: 'journal', output: EMPTY_JOURNAL } },
      { type: 'text', value: 'Your journal is empty.' },
    ]);
    assert.equal(run.assistant?.content, 'Your journal is empty.');
    assert.equal(run.assistant?.status, 'final');
    assert.deepEqual(run.toolRows, [{ id: 'call_1', status: 'success', output: EMPTY_JOURNAL }]);
  });

  test('text before a tool call is its own event; message.content is the final answer', async () => {
    const run = await runJson({ script: [callChunks([['call_t', 'journal', '{"mode":"read"}']], 'tt', 'Let me check. '), textChunks('Empty.')] });

    assert.deepEqual(run.body.tool_events.map((e) => e.type), ['text', 'tool_call', 'tool_output', 'text']);
    assert.equal(run.body.tool_events[0].value, 'Let me check. ');
    assert.equal(run.body.choices[0].message.content, 'Empty.');
    assert.equal(run.assistant?.content, 'Let me check. Empty.');
  });

  test('two calls in one response', async () => {
    const run = await runJson({
      script: [callChunks([['call_x', 'journal', '{"mode":"read"}'], ['call_y', 'journal', '{"mode":"read"}']], 'two'), textChunks('Both empty.')],
    });

    const calls = run.body.tool_events.filter((e) => e.type === 'tool_call').map((e) => [e.value.id, e.value.index]);
    assert.deepEqual(calls, [['call_x', 0], ['call_y', 1]]);
    const outputs = run.body.tool_events.filter((e) => e.type === 'tool_output').map((e) => e.value.tool_call_id).sort();
    assert.deepEqual(outputs, ['call_x', 'call_y']);
    assert.equal(run.body.choices[0].message.content, 'Both empty.');
  });

  test('reasoning-only responses are retried; reasoning is on the message', async () => {
    const run = await runJson({ script: [reasoningOnlyChunks(), textChunks('Here is the answer.')] });

    assert.equal(run.requests.length, 2);
    assert.deepEqual(run.body.choices[0].message, { role: 'assistant', content: 'Here is the answer.', reasoning_content: 'Thinking...' });
  });

  test('the iteration cap ends with the notice and no extra model call', async () => {
    const script = [toolCallChunks('call_a', 'a'), toolCallChunks('call_b', 'b'), toolCallChunks('call_c', 'c')];
    const run = await runJson({ script, maxIterations: 2 });

    assert.equal(run.status, 200);
    assert.equal(run.requests.length, 2);
    assert.equal(run.body.choices[0].message.content, '\n\n[Maximum iterations reached]');
    assert.deepEqual(run.body.tool_events.at(-1), { type: 'text', value: '\n\n[Maximum iterations reached]' });
    assert.equal(run.assistant?.content, '\n\n[Maximum iterations reached]');
    assert.equal(run.assistant?.status, 'final');
  });

  test('a throwing tool is reported to the model and stored as an error', async () => {
    const run = await runJson({ script: [throwingToolChunks('call_boom'), textChunks('The tool failed.')], tools: [boomTool.spec] });

    const expected = "Error executing tool 'boom': kaboom. Please check the arguments and try again.";
    assert.equal(run.status, 200);
    assert.deepEqual(run.body.tool_events[1], { type: 'tool_output', value: { tool_call_id: 'call_boom', name: 'boom', output: expected } });
    assert.deepEqual(run.toolRows, [{ id: 'call_boom', status: 'error', output: expected }]);
    assert.equal(run.body.choices[0].message.content, 'The tool failed.');
  });

  test('upstream failure answers 500 with the error and records it', async () => {
    const fail = (_req, res) => res.status(400).json({ error: { message: 'bad request from upstream' } });
    const run = await runJson({ script: [fail] });

    const message = 'Upstream API error (400): bad request from upstream';
    assert.equal(run.status, 500);
    assert.deepEqual(run.body, {
      error: { message, type: 'tool_orchestration_error' },
      tool_events: [{ type: 'text', value: `[Error: ${message}]` }],
    });
  });

  test('provider_stream: true streams upstream and still answers with JSON', async () => {
    const run = await runJson({ script: [toolCallChunks('call_p'), textChunks('Streamed upstream.')], extra: { provider_stream: true } });

    assert.equal(run.status, 200);
    assert.deepEqual(run.requests.map((r) => r.stream), [true, true]);
    assert.equal(run.body.choices[0].message.content, 'Streamed upstream.');
    assert.equal(run.assistant?.status, 'final');
    assert.deepEqual(run.toolRows, [{ id: 'call_p', status: 'success', output: EMPTY_JOURNAL }]);
  });
});
