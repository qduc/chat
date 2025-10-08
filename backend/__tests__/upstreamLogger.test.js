import { describe, it, expect } from '@jest/globals';
import { formatSSEChunks } from '../src/lib/logging/upstreamLogger.js';

describe('upstreamLogger SSE formatting', () => {
  it('should format SSE chunks with content in a readable way', () => {
    const sseBody = `data: {"id":"test-1","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"},"finish_reason":null}]}

data: {"id":"test-1","choices":[{"index":0,"delta":{"content":" World"},"finish_reason":null}]}

data: {"id":"test-1","choices":[{"index":0,"delta":{"content":"!"},"finish_reason":"stop"}]}

data: {"id":"test-1","usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}

data: [DONE]`;

    const formatted = formatSSEChunks(sseBody);

    // Verify formatted output contains readable chunk summaries
    expect(formatted).toContain('[Chunk 0] Role: assistant, Content: "Hello"');
    expect(formatted).toContain('[Chunk 1] Content: " World"');
    expect(formatted).toContain('[Chunk 2] Content: "!", Finish reason: stop');
    expect(formatted).toContain('[Chunk 3] Usage:');
    expect(formatted).toContain('STREAM END');
  });

  it('should handle tool calls in SSE chunks (single complete chunk)', () => {
    const sseBody = `data: {"id":"test-2","choices":[{"index":0,"delta":{"tool_calls":[{"id":"call_123","type":"function","function":{"name":"get_weather","arguments":"{\\"location\\": \\"NYC\\"}"}}]},"finish_reason":null}]}

data: [DONE]`;

    const formatted = formatSSEChunks(sseBody);

    expect(formatted).toContain('Tool call streaming: get_weather');
    expect(formatted).toContain('Accumulated Tool Calls');
    expect(formatted).toContain('get_weather({"location": "NYC"})');
    expect(formatted).toContain('STREAM END');
  });

  it('should accumulate streamed tool call arguments', () => {
    const sseBody = `data: {"id":"test-tc","choices":[{"index":0,"delta":{"tool_calls":[{"id":"call_1","index":0,"type":"function","function":{"name":"search","arguments":""}}]},"finish_reason":null}]}

data: {"id":"test-tc","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"q"}}]},"finish_reason":null}]}

data: {"id":"test-tc","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"uery\\""}}]},"finish_reason":null}]}

data: {"id":"test-tc","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":": \\"te"}}]},"finish_reason":null}]}

data: {"id":"test-tc","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"st\\"}"}}]},"finish_reason":null}]}

data: {"id":"test-tc","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}

data: [DONE]`;

    const formatted = formatSSEChunks(sseBody);

    // Should show "Tool call streaming" once
    expect(formatted).toContain('Tool call streaming: search');

    // Should accumulate all arguments
    expect(formatted).toContain('Accumulated Tool Calls');
    expect(formatted).toContain('search({"query": "test"})');

    // Should not show every individual chunk
    expect(formatted.split('\n').filter(l => l.includes('Tool call')).length).toBeLessThan(6);
  });

  it('should handle unparseable chunks gracefully', () => {
    const sseBody = `data: {invalid json}

data: [DONE]`;

    const formatted = formatSSEChunks(sseBody);

    expect(formatted).toContain('(unparseable)');
    expect(formatted).toContain('{invalid json}');
  });

  it('should preserve non-data SSE lines', () => {
    const sseBody = `event: message
data: {"id":"test-3","choices":[{"index":0,"delta":{"content":"Test"},"finish_reason":null}]}

data: [DONE]`;

    const formatted = formatSSEChunks(sseBody);

    expect(formatted).toContain('event: message');
    expect(formatted).toContain('[Chunk 0] Content: "Test"');
  });

  it('should show role delta', () => {
    const sseBody = `data: {"id":"test-4","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}

data: [DONE]`;

    const formatted = formatSSEChunks(sseBody);

    expect(formatted).toContain('[Chunk 0] Role: assistant');
  });

  it('should show finish reason without content', () => {
    const sseBody = `data: {"id":"test-5","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]`;

    const formatted = formatSSEChunks(sseBody);

    expect(formatted).toContain('[Chunk 0] Finish reason: stop');
  });

  it('should show usage information', () => {
    const sseBody = `data: {"id":"test-6","usage":{"prompt_tokens":100,"completion_tokens":50,"total_tokens":150}}

data: [DONE]`;

    const formatted = formatSSEChunks(sseBody);

    expect(formatted).toContain('[Chunk 0] Usage:');
    expect(formatted).toContain('"prompt_tokens":100');
    expect(formatted).toContain('"completion_tokens":50');
  });

  it('should handle empty lines', () => {
    const sseBody = `data: {"id":"test-7","choices":[{"index":0,"delta":{"content":"Test"},"finish_reason":null}]}


data: [DONE]`;

    const formatted = formatSSEChunks(sseBody);

    expect(formatted).toContain('[Chunk 0] Content: "Test"');
    expect(formatted).toContain('STREAM END');
  });

  it('should handle multiple tool calls', () => {
    const sseBody = `data: {"id":"test-8","choices":[{"index":0,"delta":{"tool_calls":[{"id":"call_1","index":0,"type":"function","function":{"name":"tool1","arguments":"{}"}},{"id":"call_2","index":1,"type":"function","function":{"name":"tool2","arguments":"{}"}}]},"finish_reason":null}]}

data: [DONE]`;

    const formatted = formatSSEChunks(sseBody);

    expect(formatted).toContain('Tool call streaming: tool1, tool2');
    expect(formatted).toContain('Accumulated Tool Calls');
    expect(formatted).toContain('tool1({})');
    expect(formatted).toContain('tool2({})');
  });
});
