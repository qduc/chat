// Tests for frontend iterative orchestration functionality

import { sendChat } from '../lib/chat';
import { renderHook, act } from '@testing-library/react';
import { useChatStream } from '../hooks/useChatStream';

// Mock fetch for testing
const mockFetch = (responses: Response[]) => {
  let callCount = 0;
  return jest.fn().mockImplementation(() => {
    const response = responses[callCount++] || responses[responses.length - 1];
    return Promise.resolve(response);
  });
};

// Mock ReadableStream for testing SSE
const createMockStream = (chunks: string[]) => {
  let index = 0;
  return new ReadableStream({
    start(controller) {
      const pump = () => {
        if (index < chunks.length) {
          controller.enqueue(new TextEncoder().encode(chunks[index++]));
          setTimeout(pump, 10); // Simulate async streaming
        } else {
          controller.close();
        }
      };
      pump();
    }
  });
};

describe('Frontend Iterative Orchestration', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  describe('sendChat with tools', () => {
    it('should send correct request body for tool-enabled chat', async () => {
      const mockResponse = new Response(
        createMockStream([
          'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
          'data: [DONE]\n\n'
        ]),
        {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' }
        }
      );

      const fetchSpy = mockFetch([mockResponse]);
      global.fetch = fetchSpy;

      const events: any[] = [];
      await sendChat({
        messages: [{ role: 'user', content: 'What time is it?' }],
        model: 'gpt-3.5-turbo',
        tools: [{
          type: 'function',
          function: {
            name: 'get_time',
            description: 'Get time',
            parameters: { type: 'object', properties: {} }
          }
        }],
        tool_choice: 'auto',
        onEvent: (event) => events.push(event)
      });

      expect(fetchSpy).toHaveBeenCalledWith('/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream'
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: 'What time is it?' }],
          stream: true,
          conversation_id: undefined,
          tools: [{
            type: 'function',
            function: {
              name: 'get_time',
              description: 'Get time',
              parameters: { type: 'object', properties: {} }
            }
          }],
          tool_choice: 'auto'
        })
      });
    });

    it('should handle tool call events in streaming response', async () => {
      const streamChunks = [
        'data: {"choices":[{"delta":{"content":"Let me get the time."}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"id":"call_123","type":"function","function":{"name":"get_time","arguments":"{}"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_output":{"tool_call_id":"call_123","name":"get_time","output":{"iso":"2025-08-24T08:30:32.051Z"}}}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"The current time is 08:30:32 UTC."}}]}\n\n',
        'data: [DONE]\n\n'
      ];

      const mockResponse = new Response(
        createMockStream(streamChunks),
        {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' }
        }
      );

      global.fetch = mockFetch([mockResponse]);

      const events: any[] = [];
      await sendChat({
        messages: [{ role: 'user', content: 'What time is it?' }],
        model: 'gpt-3.5-turbo',
        tools: [{
          type: 'function',
          function: {
            name: 'get_time',
            description: 'Get time',
            parameters: { type: 'object', properties: {} }
          }
        }],
        onEvent: (event) => events.push(event)
      });

      // Should have received text, tool_call, and tool_output events
      expect(events.some(e => e.type === 'text')).toBe(true);
      expect(events.some(e => e.type === 'tool_call')).toBe(true);
      expect(events.some(e => e.type === 'tool_output')).toBe(true);

      // Check tool call event structure
      const toolCallEvent = events.find(e => e.type === 'tool_call');
      expect(toolCallEvent.value).toEqual({
        id: 'call_123',
        type: 'function',
        function: {
          name: 'get_time',
          arguments: '{}'
        }
      });

      // Check tool output event structure
      const toolOutputEvent = events.find(e => e.type === 'tool_output');
      expect(toolOutputEvent.value).toEqual({
        tool_call_id: 'call_123',
        name: 'get_time',
        output: { iso: '2025-08-24T08:30:32.051Z' }
      });
    });

    it('should handle multiple tool calls in sequence', async () => {
      const streamChunks = [
        'data: {"choices":[{"delta":{"tool_calls":[{"id":"call_1","function":{"name":"get_time"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_output":{"tool_call_id":"call_1","name":"get_time","output":"time_result"}}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"id":"call_2","function":{"name":"web_search"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_output":{"tool_call_id":"call_2","name":"web_search","output":"search_result"}}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"Final analysis based on both results."}}]}\n\n',
        'data: [DONE]\n\n'
      ];

      const mockResponse = new Response(
        createMockStream(streamChunks),
        {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' }
        }
      );

      global.fetch = mockFetch([mockResponse]);

      const events: any[] = [];
      await sendChat({
        messages: [{ role: 'user', content: 'Get time then search' }],
        model: 'gpt-3.5-turbo',
        tools: [
          { type: 'function', function: { name: 'get_time' } },
          { type: 'function', function: { name: 'web_search' } }
        ],
        onEvent: (event) => events.push(event)
      });

      // Should have multiple tool calls and outputs
      const toolCallEvents = events.filter(e => e.type === 'tool_call');
      const toolOutputEvents = events.filter(e => e.type === 'tool_output');

      expect(toolCallEvents.length).toBe(2);
      expect(toolOutputEvents.length).toBe(2);

      // Verify sequence
      expect(toolCallEvents[0].value.id).toBe('call_1');
      expect(toolCallEvents[1].value.id).toBe('call_2');
      expect(toolOutputEvents[0].value.tool_call_id).toBe('call_1');
      expect(toolOutputEvents[1].value.tool_call_id).toBe('call_2');
    });
  });

  describe('useChatStream hook', () => {
    it('should handle tool events and update messages correctly', async () => {
      const streamChunks = [
        'data: {"choices":[{"delta":{"content":"Let me help you."}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"id":"call_123","function":{"name":"get_time"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_output":{"tool_call_id":"call_123","output":"time_data"}}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" Done!"}}]}\n\n',
        'data: [DONE]\n\n'
      ];

      const mockResponse = new Response(
        createMockStream(streamChunks),
        {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' }
        }
      );

      global.fetch = mockFetch([mockResponse]);

      const { result } = renderHook(() => useChatStream());

      await act(async () => {
        await result.current.sendMessage('Test message', null, 'gpt-3.5-turbo', true);
      });

      const messages = result.current.messages;
      expect(messages.length).toBe(2); // User message + Assistant message

      const assistantMessage = messages[1];
      expect(assistantMessage.role).toBe('assistant');
      expect(assistantMessage.content).toBe('Let me help you. Done!');
      expect(assistantMessage.tool_calls).toEqual([{
        id: 'call_123',
        function: { name: 'get_time' }
      }]);
      expect(assistantMessage.tool_outputs).toEqual([{
        tool_call_id: 'call_123',
        output: 'time_data'
      }]);
    });

    it('should handle errors gracefully', async () => {
      const mockResponse = new Response('', {
        status: 500,
        statusText: 'Internal Server Error'
      });

      global.fetch = mockFetch([mockResponse]);

      const { result } = renderHook(() => useChatStream());

      await act(async () => {
        await result.current.sendMessage('Test', null, 'gpt-3.5-turbo', true);
      });

      expect(result.current.pending.error).toBeTruthy();
      expect(result.current.messages[1].content).toContain('[error:');
    });

    it('should prevent multiple concurrent requests', async () => {
      const mockResponse = new Response(
        createMockStream(['data: {"choices":[{"delta":{"content":"response"}}]}\n\n', 'data: [DONE]\n\n']),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
      );

      const fetchSpy = mockFetch([mockResponse, mockResponse]);
      global.fetch = fetchSpy;

      const { result } = renderHook(() => useChatStream());

      await act(async () => {
        // Start first request
        const promise1 = result.current.sendMessage('Test 1', null, 'gpt-3.5-turbo', true);
        // Try to start second request while first is pending
        const promise2 = result.current.sendMessage('Test 2', null, 'gpt-3.5-turbo', true);
        
        await promise1;
        await promise2;
      });

      // Should only have made one request
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      // Should only have 2 messages (1 user, 1 assistant)
      expect(result.current.messages.length).toBe(2);
    });
  });

  describe('Error handling', () => {
    it('should handle malformed streaming responses', async () => {
      const streamChunks = [
        'data: {"invalid json}\n\n',
        'data: {"choices":[{"delta":{"content":"valid content"}}]}\n\n',
        'data: [DONE]\n\n'
      ];

      const mockResponse = new Response(
        createMockStream(streamChunks),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
      );

      global.fetch = mockFetch([mockResponse]);

      const events: any[] = [];
      const result = await sendChat({
        messages: [{ role: 'user', content: 'Test' }],
        model: 'gpt-3.5-turbo',
        tools: [{ type: 'function', function: { name: 'test_tool' } }],
        onEvent: (event) => events.push(event)
      });

      // Should still process valid events and ignore malformed ones
      expect(events.length).toBeGreaterThan(0);
      expect(events.some(e => e.type === 'text' && e.value === 'valid content')).toBe(true);
      expect(result.content).toBe('valid content');
    });

    it('should handle network errors', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

      await expect(sendChat({
        messages: [{ role: 'user', content: 'Test' }],
        model: 'gpt-3.5-turbo',
        tools: []
      })).rejects.toThrow('Network error');
    });
  });
});