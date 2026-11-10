// A cancelled plain (no tools) reply must not keep a response id for the next
// message to continue from: chunk ids before response.completed can be placeholders.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { handleRegularStreaming } from '../src/lib/streamingHandler.js';

function fakeRes() {
  const res = new EventEmitter();
  res.writableEnded = false;
  res.write = () => true;
  res.end = () => {
    res.writableEnded = true;
  };
  return res;
}

function recordingPersistence() {
  const calls = [];
  const record = (name) => (...args) => calls.push([name, ...args]);
  return {
    calls,
    persistence: {
      persist: true,
      setResponseId: record('setResponseId'),
      clearResponseId: record('clearResponseId'),
      appendContent: record('appendContent'),
      appendReasoningText: record('appendReasoningText'),
      setReasoningDetails: record('setReasoningDetails'),
      setUsage: record('setUsage'),
      setProvider: record('setProvider'),
      setModel: record('setModel'),
      addToolCalls: record('addToolCalls'),
      setGeneratedImages: record('setGeneratedImages'),
      recordAssistantFinal: record('recordAssistantFinal'),
      markError: record('markError'),
    },
  };
}

async function run({ cancel }) {
  const body = new PassThrough();
  const controller = new AbortController();
  const cancelState = { cancelled: false };
  const { persistence, calls } = recordingPersistence();
  await handleRegularStreaming({
    upstream: { body, ok: true, status: 200 },
    res: fakeRes(),
    req: new EventEmitter(),
    persistence,
    provider: null,
    abortContext: { signal: controller.signal, cancelState },
  });
  body.write(`data: ${JSON.stringify({ id: 'resp_placeholder', choices: [{ delta: { content: 'Part' } }] })}\n\n`);
  await new Promise((resolve) => setImmediate(resolve));
  if (cancel) {
    cancelState.cancelled = true;
    controller.abort();
  } else {
    body.end(`data: ${JSON.stringify({ id: 'resp_done', choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
  }
  await new Promise((resolve) => setImmediate(resolve));
  return calls;
}

describe('plain streaming: response id after cancel', () => {
  test('a cancelled reply clears it before the final write', async () => {
    const calls = await run({ cancel: true });
    const names = calls.map(([name]) => name);
    assert.deepEqual(calls.at(-1), ['recordAssistantFinal', { finishReason: 'cancelled' }]);
    assert.ok(names.indexOf('clearResponseId') >= 0 && names.indexOf('clearResponseId') < names.lastIndexOf('recordAssistantFinal'));
  });

  test('a completed reply keeps it', async () => {
    const calls = await run({ cancel: false });
    assert.ok(!calls.some(([name]) => name === 'clearResponseId'));
    assert.deepEqual(calls.at(-1), ['recordAssistantFinal', { finishReason: 'stop' }]);
  });
});
