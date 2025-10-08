/**
 * Unit tests for message diff utility
 */

import {
  computeMessageDiff,
  messagesEqual,
  normalizeContent,
  toolCallsEqual,
  toolOutputsEqual,
  diffAssistantArtifacts
} from '../src/lib/utils/messageDiff.js';

describe('Message Diff Utility', () => {
  describe('normalizeContent', () => {
    it('should normalize string content', () => {
      expect(normalizeContent('  hello  ')).toBe('hello');
      expect(normalizeContent('test')).toBe('test');
    });

    it('should normalize array content', () => {
      const content = [
        { type: 'text', text: 'hello' },
        { type: 'image_url', image_url: { url: 'http://example.com/img.jpg' } }
      ];
      const normalized = normalizeContent(content);
      expect(normalized).toBe(JSON.stringify(content));
    });

    it('should handle JSON string content', () => {
      const content = JSON.stringify([{ type: 'text', text: 'hello' }]);
      const normalized = normalizeContent(content);
      expect(normalized).toBe(content);
    });

    it('should handle empty content', () => {
      expect(normalizeContent('')).toBe('');
      expect(normalizeContent(null)).toBe('');
      expect(normalizeContent(undefined)).toBe('');
    });
  });

  describe('toolCallsEqual', () => {
    it('should match identical tool calls', () => {
      const tc1 = {
        function: { name: 'get_weather', arguments: '{"city":"NYC"}' }
      };
      const tc2 = {
        function: { name: 'get_weather', arguments: '{"city":"NYC"}' }
      };
      expect(toolCallsEqual(tc1, tc2)).toBe(true);
    });

    it('should match tool calls with different argument formatting', () => {
      const tc1 = {
        function: { name: 'get_weather', arguments: '{"city": "NYC"}' }
      };
      const tc2 = {
        function: { name: 'get_weather', arguments: '{"city":"NYC"}' }
      };
      expect(toolCallsEqual(tc1, tc2)).toBe(true);
    });

    it('should not match tool calls with different names', () => {
      const tc1 = {
        function: { name: 'get_weather', arguments: '{}' }
      };
      const tc2 = {
        function: { name: 'get_time', arguments: '{}' }
      };
      expect(toolCallsEqual(tc1, tc2)).toBe(false);
    });

    it('should handle tool_name format', () => {
      const tc1 = {
        tool_name: 'get_weather',
        arguments: '{}'
      };
      const tc2 = {
        function: { name: 'get_weather', arguments: '{}' }
      };
      expect(toolCallsEqual(tc1, tc2)).toBe(true);
    });
  });

  describe('toolOutputsEqual', () => {
    it('should match identical tool outputs', () => {
      const to1 = {
        tool_call_id: 'call_123',
        output: 'result',
        status: 'success'
      };
      const to2 = {
        tool_call_id: 'call_123',
        output: 'result',
        status: 'success'
      };
      expect(toolOutputsEqual(to1, to2)).toBe(true);
    });

    it('should not match outputs with different tool_call_id', () => {
      const to1 = {
        tool_call_id: 'call_123',
        output: 'result',
        status: 'success'
      };
      const to2 = {
        tool_call_id: 'call_456',
        output: 'result',
        status: 'success'
      };
      expect(toolOutputsEqual(to1, to2)).toBe(false);
    });

    it('should not match outputs with different status', () => {
      const to1 = {
        tool_call_id: 'call_123',
        output: 'result',
        status: 'success'
      };
      const to2 = {
        tool_call_id: 'call_123',
        output: 'result',
        status: 'error'
      };
      expect(toolOutputsEqual(to1, to2)).toBe(false);
    });
  });

  describe('messagesEqual', () => {
    it('should match identical messages without tool calls', () => {
      const msg1 = { role: 'user', content: 'hello' };
      const msg2 = { role: 'user', content: 'hello' };
      expect(messagesEqual(msg1, msg2)).toBe(true);
    });

    it('should match messages with identical tool calls', () => {
      const msg1 = {
        role: 'assistant',
        content: 'calling tool',
        tool_calls: [
          { function: { name: 'get_weather', arguments: '{}' } }
        ]
      };
      const msg2 = {
        role: 'assistant',
        content: 'calling tool',
        tool_calls: [
          { function: { name: 'get_weather', arguments: '{}' } }
        ]
      };
      expect(messagesEqual(msg1, msg2)).toBe(true);
    });

    it('should treat missing tool metadata as unchanged', () => {
      const msgWithTools = {
        role: 'assistant',
        content: 'Tool run complete',
        tool_calls: [
          { function: { name: 'get_date', arguments: '{}' } }
        ],
        tool_outputs: [
          { tool_call_id: 'call_123', output: '2025-10-05', status: 'success' }
        ]
      };

      const incomingWithoutMetadata = {
        role: 'assistant',
        content: 'Tool run complete'
      };

      expect(messagesEqual(msgWithTools, incomingWithoutMetadata)).toBe(true);
    });

    it('should not match messages with different tool call counts', () => {
      const msg1 = {
        role: 'assistant',
        content: 'calling tool',
        tool_calls: [
          { function: { name: 'get_weather', arguments: '{}' } }
        ]
      };
      const msg2 = {
        role: 'assistant',
        content: 'calling tool',
        tool_calls: []
      };
      expect(messagesEqual(msg1, msg2)).toBe(false);
    });
  });

  describe('computeMessageDiff', () => {
    it('should handle empty existing and incoming', () => {
      const result = computeMessageDiff([], []);
      expect(result.fallback).toBe(false);
      expect(result.toInsert).toHaveLength(0);
      expect(result.toUpdate).toHaveLength(0);
      expect(result.toDelete).toHaveLength(0);
      expect(result.unchanged).toHaveLength(0);
    });

    it('should detect all new messages', () => {
      const existing = [];
      const incoming = [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' }
      ];

      const result = computeMessageDiff(existing, incoming);
      expect(result.fallback).toBe(false);
      expect(result.toInsert).toHaveLength(2);
      expect(result.toUpdate).toHaveLength(0);
      expect(result.toDelete).toHaveLength(0);
    });

    it('should detect all unchanged messages', () => {
      const existing = [
        { id: 1, seq: 1, role: 'user', content: 'a' },
        { id: 2, seq: 2, role: 'assistant', content: 'b' }
      ];
      const incoming = [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' }
      ];

      const result = computeMessageDiff(existing, incoming);
      expect(result.fallback).toBe(false);
      expect(result.toInsert).toHaveLength(0);
      expect(result.toUpdate).toHaveLength(0);
      expect(result.toDelete).toHaveLength(0);
      expect(result.unchanged).toHaveLength(2);
    });

    it('should detect inserted messages (append)', () => {
      const existing = [
        { id: 1, seq: 1, role: 'user', content: 'a' },
        { id: 2, seq: 2, role: 'assistant', content: 'b' }
      ];
      const incoming = [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
        { role: 'user', content: 'c' }
      ];

      const result = computeMessageDiff(existing, incoming);
      expect(result.fallback).toBe(false);
      expect(result.toInsert).toHaveLength(1);
      expect(result.toInsert[0].content).toBe('c');
      expect(result.toUpdate).toHaveLength(0);
      expect(result.toDelete).toHaveLength(0);
      expect(result.unchanged).toHaveLength(2);
    });

    it('should detect updated messages', () => {
      const existing = [
        { id: 1, seq: 1, role: 'user', content: 'a' },
        { id: 2, seq: 2, role: 'assistant', content: 'b' }
      ];
      const incoming = [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b-edited' }
      ];

      const result = computeMessageDiff(existing, incoming);
      expect(result.fallback).toBe(false);
      expect(result.toInsert).toHaveLength(0);
      expect(result.toUpdate).toHaveLength(1);
      expect(result.toUpdate[0].id).toBe(2);
      expect(result.toUpdate[0].content).toBe('b-edited');
      expect(result.toDelete).toHaveLength(0);
      expect(result.unchanged).toHaveLength(1);
    });

    it('should detect deleted messages (tail deletion)', () => {
      const existing = [
        { id: 1, seq: 1, role: 'user', content: 'a' },
        { id: 2, seq: 2, role: 'assistant', content: 'b' },
        { id: 3, seq: 3, role: 'user', content: 'c' }
      ];
      const incoming = [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' }
      ];

      const result = computeMessageDiff(existing, incoming);
      expect(result.fallback).toBe(false);
      expect(result.toInsert).toHaveLength(0);
      expect(result.toUpdate).toHaveLength(0);
      expect(result.toDelete).toHaveLength(1);
      expect(result.toDelete[0].id).toBe(3);
      expect(result.unchanged).toHaveLength(2);
    });

    it('should handle truncated history (suffix alignment)', () => {
      const existing = [
        { id: 1, seq: 1, role: 'user', content: 'a' },
        { id: 2, seq: 2, role: 'assistant', content: 'b' },
        { id: 3, seq: 3, role: 'user', content: 'c' }
      ];
      const incoming = [
        { role: 'assistant', content: 'b' },
        { role: 'user', content: 'c' }
      ];

      const result = computeMessageDiff(existing, incoming);
      expect(result.fallback).toBe(false);
      expect(result.toInsert).toHaveLength(2);
      expect(result.toDelete).toHaveLength(3);
      expect(result.unchanged).toHaveLength(0);
    });

    it('should handle mixed insert/update/delete', () => {
      const existing = [
        { id: 1, seq: 1, role: 'user', content: 'a' },
        { id: 2, seq: 2, role: 'assistant', content: 'b' },
        { id: 3, seq: 3, role: 'user', content: 'c' },
        { id: 4, seq: 4, role: 'assistant', content: 'd' }
      ];
      const incoming = [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b-edited' },
        { role: 'user', content: 'c' }
        // 'd' deleted, nothing new inserted
      ];

      const result = computeMessageDiff(existing, incoming);
      expect(result.fallback).toBe(false);
      expect(result.toUpdate).toHaveLength(1);
      expect(result.toUpdate[0].content).toBe('b-edited');
      expect(result.toDelete).toHaveLength(1);
      expect(result.toDelete[0].id).toBe(4);
      expect(result.unchanged).toHaveLength(2);
    });
  });

  describe('diffAssistantArtifacts', () => {
    it('should handle no changes', () => {
      const existing = [
        { id: 'call_1', call_index: 0, tool_name: 'get_weather', arguments: '{}' }
      ];
      const next = [
        { function: { name: 'get_weather', arguments: '{}' } }
      ];

      const result = diffAssistantArtifacts({
        existingToolCalls: existing,
        nextToolCalls: next
      });

      expect(result.fallback).toBe(false);
      expect(result.toolCallsToUpdate).toHaveLength(0);
      expect(result.toolCallsToInsert).toHaveLength(0);
    });

    it('should detect tool call updates', () => {
      const existing = [
        { id: 'call_1', call_index: 0, tool_name: 'get_weather', arguments: '{"city":"NYC"}' }
      ];
      const next = [
        { function: { name: 'get_weather', arguments: '{"city":"LA"}' } }
      ];

      const result = diffAssistantArtifacts({
        existingToolCalls: existing,
        nextToolCalls: next
      });

      expect(result.fallback).toBe(false);
      expect(result.toolCallsToUpdate).toHaveLength(1);
      expect(result.toolCallsToInsert).toHaveLength(0);
    });

    it('should trigger fallback on count change', () => {
      const existing = [
        { id: 'call_1', call_index: 0, tool_name: 'get_weather', arguments: '{}' }
      ];
      const next = [
        { function: { name: 'get_weather', arguments: '{}' } },
        { function: { name: 'get_time', arguments: '{}' } }
      ];

      const result = diffAssistantArtifacts({
        existingToolCalls: existing,
        nextToolCalls: next
      });

      expect(result.fallback).toBe(true);
      expect(result.reason).toBe('Tool call count changed');
    });

    it('should detect tool output updates', () => {
      const existingOutputs = [
        { id: 1, tool_call_id: 'call_1', output: 'old result', status: 'success' }
      ];
      const nextOutputs = [
        { tool_call_id: 'call_1', output: 'new result', status: 'success' }
      ];

      const result = diffAssistantArtifacts({
        existingToolOutputs: existingOutputs,
        nextToolOutputs: nextOutputs
      });

      expect(result.fallback).toBe(false);
      expect(result.toolOutputsToUpdate).toHaveLength(1);
      expect(result.toolOutputsToInsert).toHaveLength(0);
    });

    it('should detect new tool outputs', () => {
      const existingOutputs = [];
      const nextOutputs = [
        { tool_call_id: 'call_1', output: 'result', status: 'success' }
      ];

      const result = diffAssistantArtifacts({
        existingToolOutputs: existingOutputs,
        nextToolOutputs: nextOutputs
      });

      expect(result.fallback).toBe(false);
      expect(result.toolOutputsToUpdate).toHaveLength(0);
      expect(result.toolOutputsToInsert).toHaveLength(1);
    });
  });
});
