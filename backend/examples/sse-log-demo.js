#!/usr/bin/env node
/**
 * Demonstration of SSE chunk formatting improvement
 *
 * This script shows how the upstream logger now formats SSE chunks
 * in a more readable way compared to raw SSE output.
 */

import { formatSSEChunks } from '../src/lib/logging/upstreamLogger.js';

// Example SSE stream from a typical LLM API response
const exampleSSE = `data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{"content":"!"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{"content":" How"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{"content":" can"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{"content":" I"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{"content":" help"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{"content":" you"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{"content":" today"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{"content":"?"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","usage":{"prompt_tokens":20,"completion_tokens":10,"total_tokens":30}}

data: [DONE]`;

console.log('='.repeat(80));
console.log('BEFORE: Raw SSE chunks (hard to read, must scan each JSON object)');
console.log('='.repeat(80));
console.log(exampleSSE);
console.log();

console.log('='.repeat(80));
console.log('AFTER: Formatted chunks (easy to scan, highlights important info)');
console.log('='.repeat(80));
console.log(formatSSEChunks(exampleSSE));
console.log();

console.log('='.repeat(80));
console.log('Benefits:');
console.log('='.repeat(80));
console.log('✓ Quickly see the complete response: "Hello! How can I help you today?"');
console.log('✓ Identify role changes, finish reasons, and usage at a glance');
console.log('✓ Original raw stream still preserved for detailed debugging');
console.log('✓ Works with tool calls, reasoning tokens, and other SSE formats');
console.log();

// Example with tool call streaming
const toolCallExample = `data: {"id":"tc-1","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"id":"call_abc","index":0,"type":"function","function":{"name":"web_search","arguments":""}}]},"finish_reason":null}]}

data: {"id":"tc-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"q"}}]},"finish_reason":null}]}

data: {"id":"tc-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"uery\\""}}]},"finish_reason":null}]}

data: {"id":"tc-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":": \\"AI"}}]},"finish_reason":null}]}

data: {"id":"tc-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":" trends"}}]},"finish_reason":null}]}

data: {"id":"tc-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"}"}}]},"finish_reason":null}]}

data: {"id":"tc-1","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}

data: [DONE]`;

console.log('='.repeat(80));
console.log('TOOL CALL EXAMPLE: Streamed incrementally (character by character)');
console.log('='.repeat(80));
console.log('BEFORE: 6+ chunks of partial JSON fragments');
console.log('  [Chunk 0] Tool calls: [{"index":0,"function":{"arguments":"{\\"q"}}]');
console.log('  [Chunk 1] Tool calls: [{"index":0,"function":{"arguments":"uery\\""}}]');
console.log('  [Chunk 2] Tool calls: [{"index":0,"function":{"arguments":": \\"AI"}}]');
console.log('  ... (hard to read, fragments everywhere)');
console.log();
console.log('AFTER: Accumulated and presented cleanly');
console.log(formatSSEChunks(toolCallExample));
