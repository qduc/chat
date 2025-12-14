import { jest } from '@jest/globals';

// Import the module under test
const modulePath = new URL('../src/lib/toolOrchestrationUtils.js', import.meta.url).href;
const utils = await import(modulePath);

describe.skip('executeToolCallsParallel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function delay(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  test('executes tools in parallel respecting concurrency and preserves order', async () => {
    // Mock executeToolCall to simulate varied durations
    jest.spyOn(utils, 'executeToolCall').mockImplementation(async (call) => {
      const name = call.function?.name;
      if (name === 'slow') await delay(100);
      if (name === 'medium') await delay(50);
      if (name === 'fast') await delay(10);
      return { name, output: `${name}-output` };
    });

    const toolCalls = [
      { id: 'c1', function: { name: 'slow', arguments: '{}' } },
      { id: 'c2', function: { name: 'fast', arguments: '{}' } },
      { id: 'c3', function: { name: 'medium', arguments: '{}' } },
    ];

    const t0 = Date.now();
    const results = await utils.executeToolCallsParallel(toolCalls, null, { concurrency: 3 });
    const elapsed = Date.now() - t0;

    // Parallel run should complete faster than sequential sum (100+10+50=160ms)
    expect(elapsed).toBeLessThan(160);

    // Results should be returned in original order
    expect(results.map((r) => r.name)).toEqual(['slow', 'fast', 'medium']);
    expect(results.map((r) => r.tool_call_id)).toEqual(['c1', 'c2', 'c3']);
  });

  test('respects concurrency limit', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;

    jest.spyOn(utils, 'executeToolCall').mockImplementation(async (call) => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await delay(40);
      concurrent--;
      return { name: call.function?.name, output: 'ok' };
    });

    const toolCalls = Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, function: { name: `t${i}`, arguments: '{}' } }));

    await utils.executeToolCallsParallel(toolCalls, null, { concurrency: 2 });
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  test('onToolComplete called as each tool finishes', async () => {
    const completionOrder = [];
    jest.spyOn(utils, 'executeToolCall').mockImplementation(async (call) => {
      if (call.function?.name === 'a') await delay(80);
      if (call.function?.name === 'b') await delay(10);
      if (call.function?.name === 'c') await delay(20);
      return { name: call.function?.name, output: `${call.function?.name}-out` };
    });

    const toolCalls = [
      { id: 'c_a', function: { name: 'a', arguments: '{}' } },
      { id: 'c_b', function: { name: 'b', arguments: '{}' } },
      { id: 'c_c', function: { name: 'c', arguments: '{}' } },
    ];

    const onToolComplete = jest.fn((res) => {
      completionOrder.push(res.name);
    });

    const results = await utils.executeToolCallsParallel(toolCalls, null, { concurrency: 3, onToolComplete });

    // b should finish before c, and a last
    expect(completionOrder).toEqual(['b', 'c', 'a']);
    // But results array preserves original order
    expect(results.map((r) => r.name)).toEqual(['a', 'b', 'c']);
  });
});
