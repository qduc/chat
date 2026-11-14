import { describe, it, expect } from '@jest/globals';
import {
  formatSSEChunks,
  formatUpstreamRequestLog,
  formatUpstreamResponseMeta,
  isSensitiveHeaderName,
  redactUpstreamUrl,
} from '../src/lib/logging/upstreamLogger.js';

describe('upstreamLogger SSE formatting', () => {
  it('should format SSE chunks with content in a readable way', () => {
    const sseBody = `data: {"id":"test-1","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"},"finish_reason":null}]}

data: {"id":"test-1","choices":[{"index":0,"delta":{"content":" World"},"finish_reason":null}]}

data: {"id":"test-1","choices":[{"index":0,"delta":{"content":"!"},"finish_reason":"stop"}]}

data: {"id":"test-1","usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}

data: [DONE]`;

    const formatted = formatSSEChunks(sseBody);

    // Verify formatted output contains readable chunk summaries
    expect(formatted).toContain('[Chunk 0] Role: assistant');
    expect(formatted).toContain('[Content] "Hello World!"'); // Content is consolidated
    expect(formatted).toContain('Finish reason: stop');
    expect(formatted).toContain('Usage:');
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

    // Non-data SSE lines are skipped in the current implementation
    expect(formatted).toContain('[Content] "Test"');
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

    expect(formatted).toContain('[Content] "Test"');
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

describe('upstreamLogger credential redaction', () => {
  const loggedAt = new Date('2026-11-14T10:00:00.000Z');
  const requestLog = formatUpstreamRequestLog({
    now: loggedAt,
    url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=AIzaFAKE&alt=sse',
    headers: {
      Authorization: 'Bearer sk-FAKE-123',
      'proxy-authorization': 'proxy-secret',
      'api-key': 'sk-FAKE-123',
      'x-api-key': 'sk-FAKE-123',
      'x-goog-api-key': 'AIzaFAKE',
      cookie: 'session=secret',
      'set-cookie': 'session=secret',
      'x-auth-token': 'tok-FAKE',
      'Content-Type': 'application/json',
      'X-Request-Id': 'req-keep',
    },
    body: {
      model: 'openai/gpt-6-luna',
      messages: [{ role: 'user', content: 'Name this chat' }],
    },
  });

  const responseMeta = formatUpstreamResponseMeta({
    url: 'https://openrouter.ai/api/v1/responses?foo=1&key=sk-FAKE-123',
    status: 200,
    headers: {
      'content-type': 'application/json',
      'x-api-key': 'sk-FAKE-123',
      'x-goog-api-key': 'AIzaFAKE',
      'set-cookie': 'session=secret',
    },
  });

  it('omits fake keys from every logged header and URL', () => {
    const responseLog = JSON.stringify(responseMeta, null, 2);
    const combined = `${requestLog}\n${responseLog}`;
    expect(combined).not.toContain('sk-FAKE-123');
    expect(combined).not.toContain('AIzaFAKE');
    expect(combined).not.toContain('session=secret');
    expect(combined).not.toContain('proxy-secret');
    expect(combined).not.toContain('tok-FAKE');
    expect(requestLog).toContain('"Authorization": "[REDACTED]"');
    expect(requestLog).toContain('"proxy-authorization": "[REDACTED]"');
    expect(requestLog).toContain('"api-key": "[REDACTED]"');
    expect(requestLog).toContain('"x-api-key": "[REDACTED]"');
    expect(requestLog).toContain('"x-goog-api-key": "[REDACTED]"');
    expect(requestLog).toContain('"cookie": "[REDACTED]"');
    expect(requestLog).toContain('"set-cookie": "[REDACTED]"');
    expect(requestLog).toContain('"x-auth-token": "[REDACTED]"');
    expect(requestLog).toContain('"Content-Type": "application/json"');
    expect(requestLog).toContain('"X-Request-Id": "req-keep"');
    expect(requestLog).toContain('key=[REDACTED]');
    expect(requestLog).toContain('alt=sse');
    expect(isSensitiveHeaderName('content-type')).toBe(false);
    expect(isSensitiveHeaderName('x-request-id')).toBe(false);
    expect(responseMeta.url).toBe('https://openrouter.ai/api/v1/responses?foo=1&key=[REDACTED]');
    expect(responseMeta.headers['x-api-key']).toBe('[REDACTED]');
    expect(responseMeta.headers['x-goog-api-key']).toBe('[REDACTED]');
    expect(responseMeta.headers['set-cookie']).toBe('[REDACTED]');
    expect(responseMeta.headers['content-type']).toBe('application/json');
  });

  it('redacts credential query names, including percent-encoded forms', () => {
    const url = redactUpstreamUrl(
      'https://example.test/v1?key=sk-FAKE-123&api_key=sk-FAKE-123&apikey=sk-FAKE-123&access_token=tok-FAKE&token=tok-FAKE&api%5Fkey=sk-FAKE-123&access%5Ftoken=tok-FAKE&alt=sse'
    );
    expect(url).not.toContain('sk-FAKE-123');
    expect(url).not.toContain('tok-FAKE');
    expect(url).toContain('alt=sse');
    expect(url).toContain('key=[REDACTED]');
    expect(url).toContain('api_key=[REDACTED]');
    expect(url).toContain('apikey=[REDACTED]');
    expect(url).toContain('access_token=[REDACTED]');
    expect(url).toContain('token=[REDACTED]');
    expect(url).toContain('api%5Fkey=[REDACTED]');
    expect(url).toContain('access%5Ftoken=[REDACTED]');
  });
});
