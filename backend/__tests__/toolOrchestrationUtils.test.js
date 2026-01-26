import { jest } from '@jest/globals';
import { logger } from '../src/logger.js';

// Mock logger to suppress output during tests
jest.spyOn(logger, 'warn').mockImplementation(() => {});
jest.spyOn(logger, 'debug').mockImplementation(() => {});
jest.spyOn(logger, 'info').mockImplementation(() => {});

// Dynamic import to get the module after mocks are set up
const toolOrchestrationModule = await import('../src/lib/toolOrchestrationUtils.js');

const {
  extractSystemPrompt,
  buildConversationMessages,
  executeToolCall,
  executeToolCallsParallel,
} = toolOrchestrationModule;

describe('toolOrchestrationUtils', () => {
  describe('extractSystemPrompt', () => {
    beforeAll(() => {
      // Mock Date for consistent testing
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2025-01-15'));
    });

    afterAll(() => {
      jest.useRealTimers();
    });

    test('should extract system prompt from messages array', () => {
      const result = extractSystemPrompt({
        body: {
          messages: [
            { role: 'system', content: 'You are a helpful assistant' },
            { role: 'user', content: 'Hello' },
          ],
        },
        bodyIn: {},
        persistence: {},
      });

      expect(result).toContain('You are a helpful assistant');
      expect(result).toContain('<system_instructions>');
      expect(result).toContain('<user_instructions>');
    });

    test('should extract from bodyIn.systemPrompt', () => {
      const result = extractSystemPrompt({
        body: { messages: [] },
        bodyIn: { systemPrompt: 'Custom system prompt' },
        persistence: {},
      });

      expect(result).toContain('Custom system prompt');
    });

    test('should extract from bodyIn.system_prompt (snake_case)', () => {
      const result = extractSystemPrompt({
        body: { messages: [] },
        bodyIn: { system_prompt: 'Snake case prompt' },
        persistence: {},
      });

      expect(result).toContain('Snake case prompt');
    });

    test('should extract from persistence metadata', () => {
      const result = extractSystemPrompt({
        body: { messages: [] },
        bodyIn: {},
        persistence: {
          conversationMeta: {
            metadata: {
              system_prompt: 'Persisted prompt',
            },
          },
        },
      });

      expect(result).toContain('Persisted prompt');
    });

    test('should return minimal prompt with date when no system prompt provided', () => {
      const result = extractSystemPrompt({
        body: { messages: [] },
        bodyIn: {},
        persistence: {},
      });

      expect(result).toContain('2025-01-15');
      expect(result).toContain('<system_instructions>');
    });

    test('should skip empty system messages', () => {
      const result = extractSystemPrompt({
        body: {
          messages: [
            { role: 'system', content: '' },
            { role: 'system', content: '   ' },
            { role: 'user', content: 'Hello' },
          ],
        },
        bodyIn: {},
        persistence: {},
      });

      // Should fall back to minimal date prompt
      expect(result).toContain('2025-01-15');
    });

    test('should not re-wrap already structured prompts', () => {
      const structuredPrompt = '<system_instructions>\nExisting structure\n</system_instructions>\n\n<user_instructions>\nUser content\n</user_instructions>';
      const result = extractSystemPrompt({
        body: { messages: [] },
        bodyIn: {},
        persistence: {
          conversationMeta: {
            metadata: {
              system_prompt: structuredPrompt,
            },
          },
        },
      });

      expect(result).toBe(structuredPrompt);
    });

    test('should prioritize messages over bodyIn', () => {
      const result = extractSystemPrompt({
        body: {
          messages: [{ role: 'system', content: 'From messages' }],
        },
        bodyIn: { systemPrompt: 'From bodyIn' },
        persistence: {},
      });

      expect(result).toContain('From messages');
      expect(result).not.toContain('From bodyIn');
    });
  });

  describe('buildConversationMessages', () => {
    beforeAll(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2025-01-15'));
    });

    afterAll(() => {
      jest.useRealTimers();
    });

    test('should build messages with system prompt first', () => {
      const result = buildConversationMessages({
        body: {
          messages: [
            { role: 'system', content: 'Be helpful' },
            { role: 'user', content: 'Hello' },
          ],
        },
        bodyIn: {},
        persistence: {},
      });

      expect(result[0].role).toBe('system');
      expect(result[0].content).toContain('Be helpful');
      expect(result[1].role).toBe('user');
      expect(result[1].content).toBe('Hello');
    });

    test('should filter out system messages from non-system position', () => {
      const result = buildConversationMessages({
        body: {
          messages: [
            { role: 'user', content: 'Hello' },
            { role: 'assistant', content: 'Hi there' },
          ],
        },
        bodyIn: {},
        persistence: {},
      });

      // Only the injected system message should have role 'system'
      const systemMessages = result.filter((m) => m.role === 'system');
      expect(systemMessages).toHaveLength(1);
    });

    test('should handle empty messages array', () => {
      const result = buildConversationMessages({
        body: { messages: [] },
        bodyIn: {},
        persistence: {},
      });

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('system');
    });

    test('should handle null messages', () => {
      const result = buildConversationMessages({
        body: {},
        bodyIn: { messages: [{ role: 'user', content: 'From bodyIn' }] },
        persistence: {},
      });

      expect(result).toHaveLength(2);
      expect(result[1].content).toBe('From bodyIn');
    });
  });

  describe('executeToolCall', () => {
    test('should return error for unknown tool', async () => {
      const result = await executeToolCall({
        function: { name: 'nonexistent_tool', arguments: '{}' },
      });

      expect(result.name).toBe('nonexistent_tool');
      expect(result.output).toContain('Error: Unknown tool');
      expect(result.output).toContain('nonexistent_tool');
    });

    test('should return error for invalid JSON arguments', async () => {
      const result = await executeToolCall({
        function: { name: 'web_search', arguments: 'not valid json' },
      });

      expect(result.output).toContain('Error: Invalid JSON');
    });

    test('should handle empty arguments', async () => {
      const result = await executeToolCall({
        function: { name: 'nonexistent_tool', arguments: '' },
      });

      // Should still parse as {} and return unknown tool error
      expect(result.output).toContain('Unknown tool');
    });

    test('should handle null call', async () => {
      const result = await executeToolCall(null);

      expect(result.name).toBeUndefined();
      expect(result.output).toContain('Unknown tool');
    });
  });

  describe('executeToolCallsParallel', () => {
    test('should return empty array for empty input', async () => {
      const result = await executeToolCallsParallel([]);

      expect(result).toEqual([]);
    });

    test('should return empty array for null input', async () => {
      const result = await executeToolCallsParallel(null);

      expect(result).toEqual([]);
    });

    test('should execute single call without overhead', async () => {
      const calls = [
        { id: 'call_1', function: { name: 'unknown_tool', arguments: '{}' } },
      ];

      const result = await executeToolCallsParallel(calls);

      expect(result).toHaveLength(1);
      expect(result[0].tool_call_id).toBe('call_1');
      expect(result[0].index).toBe(0);
      expect(result[0].status).toBe('success');
    });

    test('should execute multiple calls in parallel', async () => {
      const calls = [
        { id: 'call_1', function: { name: 'unknown_tool1', arguments: '{}' } },
        { id: 'call_2', function: { name: 'unknown_tool2', arguments: '{}' } },
      ];

      const result = await executeToolCallsParallel(calls);

      expect(result).toHaveLength(2);
      expect(result[0].tool_call_id).toBe('call_1');
      expect(result[1].tool_call_id).toBe('call_2');
    });

    test('should call onToolComplete callback for each tool', async () => {
      const calls = [
        { id: 'call_1', function: { name: 'unknown_tool', arguments: '{}' } },
        { id: 'call_2', function: { name: 'unknown_tool', arguments: '{}' } },
      ];

      const completedTools = [];
      const onToolComplete = (result) => {
        completedTools.push(result.tool_call_id);
      };

      await executeToolCallsParallel(calls, null, { onToolComplete });

      expect(completedTools).toContain('call_1');
      expect(completedTools).toContain('call_2');
    });

    test('should include duration_ms in results', async () => {
      const calls = [
        { id: 'call_1', function: { name: 'unknown_tool', arguments: '{}' } },
      ];

      const result = await executeToolCallsParallel(calls);

      expect(typeof result[0].duration_ms).toBe('number');
      expect(result[0].duration_ms).toBeGreaterThanOrEqual(0);
    });

    test('should respect concurrency limit', async () => {
      const calls = [
        { id: 'call_1', function: { name: 'unknown_tool1', arguments: '{}' } },
        { id: 'call_2', function: { name: 'unknown_tool2', arguments: '{}' } },
        { id: 'call_3', function: { name: 'unknown_tool3', arguments: '{}' } },
        { id: 'call_4', function: { name: 'unknown_tool4', arguments: '{}' } },
      ];

      const result = await executeToolCallsParallel(calls, null, { concurrency: 2 });

      expect(result).toHaveLength(4);
    });

    test('should preserve original order of results', async () => {
      const calls = [
        { id: 'call_a', function: { name: 'unknown_tool', arguments: '{}' } },
        { id: 'call_b', function: { name: 'unknown_tool', arguments: '{}' } },
        { id: 'call_c', function: { name: 'unknown_tool', arguments: '{}' } },
      ];

      const result = await executeToolCallsParallel(calls);

      expect(result[0].index).toBe(0);
      expect(result[1].index).toBe(1);
      expect(result[2].index).toBe(2);
    });

    test('should handle callback errors gracefully', async () => {
      const calls = [
        { id: 'call_1', function: { name: 'unknown_tool', arguments: '{}' } },
      ];

      const onToolComplete = () => {
        throw new Error('Callback error');
      };

      // Should not throw
      const result = await executeToolCallsParallel(calls, null, { onToolComplete });

      expect(result).toHaveLength(1);
    });
  });
});
