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
  resumableResponseId,
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
    test('skips assistant error messages from client-provided fallback history', () => {
      const result = buildConversationMessages({
        body: { messages: [] },
        bodyIn: {
          messages: [
            { role: 'user', content: 'Original prompt' },
            { role: 'assistant', status: 'error', content: '[Error: provider failed]' },
            { role: 'user', content: 'Next prompt' },
          ],
        },
        persistence: {},
      });

      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ role: 'user', content: 'Original prompt' }),
          expect.objectContaining({ role: 'user', content: 'Next prompt' }),
        ])
      );
      expect(result).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ role: 'assistant', content: '[Error: provider failed]' }),
        ])
      );
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

  describe('resumableResponseId', () => {
    const userMsg = (content) => ({ role: 'user', content });
    const reply = (content, extra = {}) => ({ role: 'assistant', content, status: 'final', response_id: 'resp_1', ...extra });

    test('continues from the newest reply when only new user messages follow', () => {
      expect(resumableResponseId([userMsg('q1'), reply('a1'), userMsg('q2')])).toBe('resp_1');
    });

    test('several new user messages (after a failed turn) still continue from the last good reply', () => {
      const failed = { role: 'assistant', content: '[Error: boom]', status: 'error', response_id: 'resp_failed' };
      expect(resumableResponseId([userMsg('q1'), reply('a1'), userMsg('q2'), failed, userMsg('q3')])).toBe('resp_1');
    });

    test('never skips back past a newer reply that has no id', () => {
      // The legacy lookup returned resp_1 here and lost the second exchange.
      const noId = { role: 'assistant', content: 'a2', status: 'final' };
      expect(resumableResponseId([userMsg('q1'), reply('a1'), userMsg('q2'), noId, userMsg('q3')])).toBeNull();
    });

    test('tool rows after the reply must answer its own calls', () => {
      const withCalls = reply('a1', { tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'x', arguments: '{}' } }] });
      const ownRow = { role: 'tool', content: '', tool_outputs: [{ tool_call_id: 'call_1', output: 'ok' }] };
      const foreignRow = { role: 'tool', content: '', tool_outputs: [{ tool_call_id: 'call_9', output: 'ok' }] };
      expect(resumableResponseId([userMsg('q1'), withCalls, ownRow, userMsg('q2')])).toBe('resp_1');
      expect(resumableResponseId([userMsg('q1'), withCalls, foreignRow, userMsg('q2')])).toBeNull();
    });

    test('null without a new user message, a Responses id, or a final reply', () => {
      expect(resumableResponseId([userMsg('q1'), reply('a1')])).toBeNull();
      expect(resumableResponseId([userMsg('q1'), reply('a1', { response_id: 'chatcmpl-1' }), userMsg('q2')])).toBeNull();
      expect(resumableResponseId([userMsg('q1'), userMsg('q2')])).toBeNull();
      expect(resumableResponseId([])).toBeNull();
    });

    test('a reply that is not final (draft) is not continued from', () => {
      expect(resumableResponseId([userMsg('q1'), reply('a1', { status: 'draft' }), userMsg('q2')])).toBeNull();
    });

    test('ignores an in-progress draft after the new message', () => {
      const draft = { role: 'assistant', content: '', status: 'streaming' };
      expect(resumableResponseId([userMsg('q1'), reply('a1'), userMsg('q2'), draft])).toBe('resp_1');
    });
  });
});
