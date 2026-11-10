// SYNTHETIC fixtures derived from the real recordings in ./fixtures.
//
// No real capture of a parallel tool-call response exists yet, so these take a
// recorded tool-call turn and add a second call in the shape each provider's
// OFFICIAL SDK documents and parses. Every other frame (reasoning, usage,
// terminal events, the answer turn) is the recorded one. Sources per family
// are cited on each builder and in fixtures/PROVENANCE.md; the official SDKs
// themselves check these streams in integration/syntheticFixtureOracle.test.js.
//
// They are a best guess, not proof of provider behavior: replace each with a
// real capture when one exists.
import { loadFixture } from './replayServer.js';

export const SECOND_CALL = Object.freeze({ id: 'call_<parallel-2>', args: { a: 7 } });

const clone = (value) => structuredClone(value);
const sse = (data, event) => ({ kind: 'sse-event', ...(event ? { event } : {}), data: JSON.stringify(data) });

function withTurn1(fixture, frames, probe) {
  const derived = clone(fixture);
  derived.turns[0].frames = frames.map((frame, seq) => ({ ...frame, seq }));
  derived.kind = 'real-traffic-recording';
  derived.synthetic = { derivedFrom: fixture.capture.probeScenario, probe };
  return derived;
}

/**
 * Chat Completions: calls are told apart by `delta.tool_calls[].index`; `id`,
 * `type` and `function.name` arrive on a call's first chunk only, and argument
 * fragments may follow call by call or interleave across indexes.
 * Source: openai/openai-node tests/lib/ChatCompletionStream.test.ts
 * (customToolChunks; "preserves interleaved non-strict tool completion notifications").
 */
function chatParallel(fixture, { interleave }) {
  const frames = fixture.turns[0].frames;
  const parsed = frames.map((frame) => (frame.kind === 'sse-event' && frame.data !== '[DONE]' ? JSON.parse(frame.data) : null));
  const toolFrame = (i) => parsed[i]?.choices?.[0]?.delta?.tool_calls?.[0];
  const toolIdx = parsed.map((_, i) => i).filter((i) => toolFrame(i));
  const template = parsed[toolIdx[0]];
  const chunk = (toolCall) => ({ ...clone(template), choices: [{ ...clone(template.choices[0]), delta: { tool_calls: [toolCall] } }] });

  const header = chunk({ index: 1, id: SECOND_CALL.id, type: 'function', function: { name: 'fixture', arguments: '' } });
  const argText = JSON.stringify(SECOND_CALL.args);
  const fragments = [argText.slice(0, 4), argText.slice(4)].map((piece) => chunk({ index: 1, function: { arguments: piece } }));
  const second = [header, ...fragments];

  // The recorded call's frames are contiguous: header, then argument fragments.
  const first = toolIdx.map((i) => frames[i]);
  if (toolIdx.at(-1) - toolIdx[0] + 1 !== toolIdx.length) throw new Error('recorded tool-call frames are not contiguous');
  const merged = [];
  if (interleave) {
    // Both headers first, then argument fragments alternating 0,1,0,1,... (rest of call 0 after).
    merged.push(first[0], sse(second[0]));
    const rest0 = first.slice(1);
    const rest1 = second.slice(1).map((extra) => sse(extra));
    while (rest0.length || rest1.length) {
      if (rest0.length) merged.push(rest0.shift());
      if (rest1.length) merged.push(rest1.shift());
    }
  } else {
    merged.push(...first, ...second.map((extra) => sse(extra)));
  }
  const out = [...frames.slice(0, toolIdx[0]), ...merged, ...frames.slice(toolIdx.at(-1) + 1)];
  return withTurn1(fixture, out, interleave ? 'parallel-tool-calls-interleaved' : 'parallel-tool-calls');
}

/**
 * Responses API: each call is its own output item with its own `output_index`:
 * response.output_item.added (function_call, call_id, name) ->
 * response.function_call_arguments.delta* -> .done -> response.output_item.done.
 * response.completed lists every output item. `sequence_number` stays monotonic.
 * Source: openai/openai-node src/lib/responses/ResponseStream.ts (state keyed by output_index).
 */
function responsesParallel(fixture) {
  const frames = fixture.turns[0].frames;
  const events = frames.map((frame) => (frame.kind === 'sse-event' ? JSON.parse(frame.data) : null));
  const doneIdx = events.findIndex((e) => e?.type === 'response.output_item.done' && e.item?.type === 'function_call');
  const firstItem = events[doneIdx].item;
  const outputIndex = events[doneIdx].output_index + 1;
  const itemId = 'fc_<parallel-2>';
  const args = JSON.stringify(SECOND_CALL.args);
  const item = { ...firstItem, id: itemId, call_id: SECOND_CALL.id, arguments: args, status: 'completed' };
  const added = [
    { type: 'response.output_item.added', item: { ...item, status: 'in_progress', arguments: '' }, output_index: outputIndex },
    { type: 'response.function_call_arguments.delta', delta: args.slice(0, 4), item_id: itemId, output_index: outputIndex },
    { type: 'response.function_call_arguments.delta', delta: args.slice(4), item_id: itemId, output_index: outputIndex },
    { type: 'response.function_call_arguments.done', arguments: args, item_id: itemId, output_index: outputIndex },
    { type: 'response.output_item.done', item, output_index: outputIndex },
  ];

  const out = [];
  frames.forEach((frame, i) => {
    if (events[i]?.type === 'response.completed') {
      const completed = clone(events[i]);
      completed.response.output = [...(completed.response.output ?? []), item];
      out.push(sse(completed, frame.event));
      return;
    }
    out.push(frame);
    if (i === doneIdx) for (const event of added) out.push(sse(event, event.type));
  });
  // Renumber sequence_number across the whole turn.
  let sequence = 0;
  const renumbered = out.map((frame) => {
    if (frame.kind !== 'sse-event') return frame;
    const data = JSON.parse(frame.data);
    if (typeof data.sequence_number === 'number' || data.type?.startsWith('response.')) data.sequence_number = sequence++;
    return { ...frame, data: JSON.stringify(data) };
  });
  return withTurn1(fixture, renumbered, 'parallel-tool-calls');
}

/**
 * Anthropic Messages: each tool call is its own `tool_use` content block with
 * its own `index` (content_block_start with id/name/input {}, input_json_delta
 * partial_json fragments, content_block_stop); blocks follow one another.
 * Source: anthropics/anthropic-sdk-typescript src/lib/MessageStream.ts
 * (snapshot.content[event.index]); the recorded turn already shows block
 * sequencing (thinking index 0 stops before tool_use index 1 starts).
 */
function anthropicParallel(fixture) {
  const frames = fixture.turns[0].frames;
  const events = frames.map((frame) => (frame.kind === 'sse-event' ? JSON.parse(frame.data) : null));
  const toolStart = events.findIndex((e) => e?.type === 'content_block_start' && e.content_block?.type === 'tool_use');
  const blockIndex = events[toolStart].index;
  const stopIdx = events.findIndex((e, i) => i > toolStart && e?.type === 'content_block_stop' && e.index === blockIndex);
  const index = blockIndex + 1;
  const args = JSON.stringify(SECOND_CALL.args);
  const added = [
    { type: 'content_block_start', index, content_block: { type: 'tool_use', id: SECOND_CALL.id, name: 'fixture', input: {} } },
    { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: args.slice(0, 4) } },
    { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: args.slice(4) } },
    { type: 'content_block_stop', index },
  ];
  const out = [];
  frames.forEach((frame, i) => {
    out.push(frame);
    if (i === stopIdx) for (const event of added) out.push(sse(event, event.type));
  });
  return withTurn1(fixture, out, 'parallel-tool-calls');
}

/**
 * Gemini API: parallel calls are several `functionCall` parts in the
 * candidate's content; `id` is optional; Gemini API parts carry complete args
 * (partialArgs/willContinue are Vertex-only). Only the first function call of a
 * response carries `thoughtSignature`.
 * Sources: googleapis/js-genai src/types.ts (FunctionCall); vercel/ai
 * packages/google/src/convert-to-google-messages.ts ("Gemini 3 returns a single
 * signature for a parallel function-call response on the first standard
 * function call") and its real Vertex recording google-stream-no-args-tool-call.
 */
function geminiParallel(fixture) {
  const frames = fixture.turns[0].frames;
  const out = frames.map((frame) => {
    if (frame.kind !== 'sse-event') return frame;
    const data = JSON.parse(frame.data);
    const parts = data.candidates?.[0]?.content?.parts;
    if (!parts?.some((part) => part.functionCall)) return frame;
    parts.push({ functionCall: { name: 'fixture', args: SECOND_CALL.args } });
    return { ...frame, data: JSON.stringify(data) };
  });
  return withTurn1(fixture, out, 'parallel-tool-calls');
}

const BUILDERS = {
  'openai-chat': (fixture) => chatParallel(fixture, { interleave: false }),
  'openai-chat-interleaved': (fixture) => chatParallel(fixture, { interleave: true }),
  'openai-responses': responsesParallel,
  anthropic: anthropicParallel,
  gemini: geminiParallel,
};

/** The family a synthetic variant is derived from (its real recording). */
export const sourceFamily = (variant) => variant.replace(/-interleaved$/, '');

export const PARALLEL_VARIANTS = Object.keys(BUILDERS);

export function parallelFixture(variant) {
  return BUILDERS[variant](loadFixture(sourceFamily(variant)));
}
