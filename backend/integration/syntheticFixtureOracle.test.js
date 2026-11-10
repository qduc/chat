// Oracle for the replay fixtures: each provider's OFFICIAL SDK (openai,
// @anthropic-ai/sdk, @google/genai) reads them from the replay server exactly
// as it would read the real API, and must reconstruct the tool calls.
//
// Real recordings run first as calibration: an oracle that rejects real
// traffic proves nothing. Synthetic parallel fixtures must then come out with
// both calls intact. This checks the synthetic streams are well formed and
// consistent with what the vendors' own parsers accept; it cannot prove a
// provider would ever send that exact stream (see fixtures/PROVENANCE.md).
import assert from 'node:assert/strict';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { ReplayServer, loadFixture } from '../test_support/provider-replay/replayServer.js';
import { PARALLEL_VARIANTS, SECOND_CALL, parallelFixture, sourceFamily } from '../test_support/provider-replay/syntheticFixtures.js';

const replay = new ReplayServer();
const PROMPT = 'Use the fixture tool and then summarize its result.';
const parameters = { type: 'object', properties: { a: { type: 'number' } }, required: ['a'] };

/** Turn 1 through the official SDK; returns the calls it reconstructed as { id, name, args }. */
const READERS = {
  async 'openai-chat'(fixture) {
    const client = new OpenAI({ apiKey: 'replay', baseURL: `${replay.url}/v1`, maxRetries: 0 });
    const stream = client.chat.completions.stream({
      model: fixture.capture.model,
      messages: [{ role: 'user', content: PROMPT }],
      tools: [{ type: 'function', function: { name: 'fixture', description: 'fixture', parameters } }],
    });
    const completion = await stream.finalChatCompletion();
    return (completion.choices[0].message.tool_calls ?? []).map((call) => ({
      id: call.id,
      name: call.function.name,
      args: JSON.parse(call.function.arguments),
    }));
  },
  async 'openai-responses'(fixture) {
    const client = new OpenAI({ apiKey: 'replay', baseURL: `${replay.url}/v1`, maxRetries: 0 });
    const stream = client.responses.stream({
      model: fixture.capture.model,
      input: PROMPT,
      tools: [{ type: 'function', name: 'fixture', description: 'fixture', parameters, strict: false }],
    });
    const response = await stream.finalResponse();
    return response.output
      .filter((item) => item.type === 'function_call')
      .map((item) => ({ id: item.call_id, name: item.name, args: JSON.parse(item.arguments) }));
  },
  async anthropic(fixture) {
    const client = new Anthropic({ apiKey: 'replay', baseURL: replay.url, maxRetries: 0 });
    const stream = client.messages.stream({
      model: fixture.capture.model,
      max_tokens: 1024,
      messages: [{ role: 'user', content: PROMPT }],
      tools: [{ name: 'fixture', description: 'fixture', input_schema: parameters }],
    });
    const message = await stream.finalMessage();
    return message.content
      .filter((block) => block.type === 'tool_use')
      .map((block) => ({ id: block.id, name: block.name, args: block.input }));
  },
  async gemini(fixture) {
    // Separate process: see geminiSdkReader.mjs. Async, so this process keeps serving the replay.
    const reader = fileURLToPath(new URL('../test_support/provider-replay/geminiSdkReader.mjs', import.meta.url));
    const { stdout } = await promisify(execFile)(process.execPath, [reader, replay.url, fixture.capture.model]);
    const parsed = JSON.parse(stdout);
    const calls = parsed.map(({ signed: _signed, ...call }) => call);
    calls.signatures = parsed.map((call) => call.signed);
    return calls;
  },
};

/** The single call each real recording makes, read from its frames. */
function recordedCall(family, fixture) {
  const events = fixture.turns[0].frames
    .filter((frame) => frame.kind === 'sse-event' && frame.data !== '[DONE]')
    .map((frame) => JSON.parse(frame.data));
  switch (family) {
    case 'openai-chat': {
      const deltas = events.flatMap((e) => e.choices?.[0]?.delta?.tool_calls ?? []).filter((d) => (d.index ?? 0) === 0);
      return { id: deltas.find((d) => d.id).id, name: 'fixture', args: JSON.parse(deltas.map((d) => d.function?.arguments ?? '').join('')) };
    }
    case 'openai-responses': {
      const item = events.find((e) => e.type === 'response.output_item.done' && e.item?.type === 'function_call').item;
      return { id: item.call_id, name: item.name, args: JSON.parse(item.arguments) };
    }
    case 'anthropic': {
      const start = events.find((e) => e.type === 'content_block_start' && e.content_block?.type === 'tool_use');
      const json = events
        .filter((e) => e.type === 'content_block_delta' && e.index === start.index)
        .map((e) => e.delta.partial_json)
        .join('');
      return { id: start.content_block.id, name: start.content_block.name, args: JSON.parse(json) };
    }
    case 'gemini': {
      const part = events.flatMap((e) => e.candidates?.[0]?.content?.parts ?? []).find((p) => p.functionCall);
      return { id: null, name: part.functionCall.name, args: part.functionCall.args };
    }
    default:
      throw new Error(family);
  }
}

const plain = (value) => JSON.parse(JSON.stringify(value));

describe('official SDKs accept the replay fixtures', () => {
  beforeAll(() => replay.start());
  afterAll(() => replay.stop());

  describe.each(Object.keys(READERS))('%s', (family) => {
    test('calibration: the real recording parses to its recorded call', async () => {
      const fixture = loadFixture(family);
      replay.load(fixture);
      const calls = await READERS[family](fixture);
      assert.deepEqual(plain(calls), [recordedCall(family, fixture)]);
    });
  });

  describe.each(PARALLEL_VARIANTS)('synthetic %s', (variant) => {
    test('parses to both calls, in order, with their own ids and arguments', async () => {
      const family = sourceFamily(variant);
      const fixture = parallelFixture(variant);
      replay.load(fixture);
      const calls = await READERS[family](fixture);
      const first = recordedCall(family, loadFixture(family));
      const second = { id: family === 'gemini' ? null : SECOND_CALL.id, name: 'fixture', args: SECOND_CALL.args };
      assert.deepEqual(plain(calls), [first, second]);
      // Gemini: only the first call of a parallel response carries the thought signature.
      if (family === 'gemini') assert.deepEqual(calls.signatures, [true, false]);
    });
  });
});
