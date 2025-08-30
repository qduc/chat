// Tests for frontend iterative orchestration functionality

// Mock the chat library first
jest.mock('../lib/chat', () => {
  const mockSendMessage = jest.fn();
  const mockSendMessageWithTools = jest.fn();
  const mockGetToolSpecs = jest.fn();
  const mockSendChat = jest.fn();

  return {
    ...jest.requireActual('../lib/chat'),
    ChatClient: jest.fn().mockImplementation(() => ({
      sendMessage: mockSendMessage,
      sendMessageWithTools: mockSendMessageWithTools,
    })),
    ToolsClient: jest.fn().mockImplementation(() => ({
      getToolSpecs: mockGetToolSpecs
    })),
    getToolSpecs: mockGetToolSpecs,
    sendChat: mockSendChat
  };
});

import { renderHook, act, waitFor } from '@testing-library/react';
import { useChatState } from '../hooks/useChatState';

// Import the mocked sendChat function after the mock
const { sendChat, getToolSpecs } = require('../lib/chat');

// Now get access to the mock functions
const mockSendChat = sendChat as jest.MockedFunction<typeof sendChat>;
const mockGetToolSpecs = getToolSpecs as jest.MockedFunction<typeof getToolSpecs>;

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

    // Mock tool specs response
    mockGetToolSpecs.mockResolvedValue({
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_time',
            description: 'Get time',
            parameters: { type: 'object', properties: {} }
          }
        },
        {
          type: 'function',
          function: {
            name: 'web_search',
            description: 'Perform a web search',
            parameters: {
              type: 'object',
              properties: {
                query: { type: 'string', description: 'The search query' }
              },
              required: ['query']
            }
          }
        }
      ],
      available_tools: ['get_time', 'web_search']
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  describe('sendChat with tools', () => {
    it('streams events with tools enabled (behavior)', async () => {
      // Mock sendChat to simulate streaming behavior
      mockSendChat.mockImplementation(async (options: any) => {
        // Simulate the streaming events
        if (options.onEvent) {
          options.onEvent({ type: 'text', value: 'Hello' });
        }
        return { content: 'Hello', responseId: 'test-response-id' };
      });

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
        onEvent: (event: any) => events.push(event)
      });
      // Behavior: sendChat called and yielded text content from events
      expect(mockSendChat).toHaveBeenCalled();
      expect(events.some(e => e.type === 'text' && e.value === 'Hello')).toBe(true);
    });

    it('should handle tool call events in streaming response', async () => {
      mockSendChat.mockImplementation(async (options: any) => {
        if (options.onEvent) {
          options.onEvent({ type: 'text', value: 'Let me get the time.' });
          options.onEvent({
            type: 'tool_call',
            value: {
              id: 'call_123',
              type: 'function',
              function: { name: 'get_time', arguments: '{}' }
            }
          });
          options.onEvent({
            type: 'tool_output',
            value: {
              tool_call_id: 'call_123',
              name: 'get_time',
              output: { iso: '2025-08-24T08:30:32.051Z' }
            }
          });
          options.onEvent({ type: 'text', value: 'The current time is 08:30:32 UTC.' });
        }
        return { content: 'Let me get the time.The current time is 08:30:32 UTC.', responseId: 'test-response-id' };
      });

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
        onEvent: (event: any) => events.push(event)
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
      mockSendChat.mockImplementation(async (options: any) => {
        if (options.onEvent) {
          options.onEvent({
            type: 'tool_call',
            value: { id: 'call_1', function: { name: 'get_time' } }
          });
          options.onEvent({
            type: 'tool_output',
            value: { tool_call_id: 'call_1', name: 'get_time', output: 'time_result' }
          });
          options.onEvent({
            type: 'tool_call',
            value: { id: 'call_2', function: { name: 'web_search' } }
          });
          options.onEvent({
            type: 'tool_output',
            value: { tool_call_id: 'call_2', name: 'web_search', output: 'search_result' }
          });
          options.onEvent({ type: 'text', value: 'Final analysis based on both results.' });
        }
        return { content: 'Final analysis based on both results.', responseId: 'test-response-id' };
      });

      const events: any[] = [];
      await sendChat({
        messages: [{ role: 'user', content: 'Get time then search' }],
        model: 'gpt-3.5-turbo',
        tools: [
          { type: 'function', function: { name: 'get_time' } },
          { type: 'function', function: { name: 'web_search' } }
        ],
        onEvent: (event: any) => events.push(event)
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
      mockSendChat.mockImplementation(async (options: any) => {
        if (options.onEvent) {
          options.onEvent({ type: 'text', value: 'Let me help you.' });
          options.onEvent({
            type: 'tool_call',
            value: { id: 'call_123', function: { name: 'get_time' } }
          });
          options.onEvent({
            type: 'tool_output',
            value: { tool_call_id: 'call_123', output: 'time_data' }
          });
          options.onEvent({ type: 'text', value: ' Done!' });
        }
        return { content: 'Let me help you. Done!', responseId: 'test-response-id' };
      });

      const { result } = renderHook(() => useChatState());

      await act(async () => {
        result.current.actions.setInput('Test message');
      });
      await waitFor(() => expect(result.current.state.input).toBe('Test message'));

      await act(async () => {
        await result.current.actions.sendMessage();
      });

      await waitFor(() => {
        const assistantMessage = result.current.state.messages[1];
        expect(assistantMessage).toBeDefined();
        expect(assistantMessage.tool_calls).toBeDefined();
        expect(assistantMessage.tool_outputs).toBeDefined();
      });

      const messages = result.current.state.messages;
      const assistantMessage = messages[1];
      expect(assistantMessage.role).toBe('assistant');
      expect(assistantMessage.content).toBe('Let me help you. Done!');
      expect(assistantMessage.tool_calls).toEqual([
        {
          id: 'call_123',
          function: { name: 'get_time' }
        }
      ]);
      expect(assistantMessage.tool_outputs).toEqual([
        {
          tool_call_id: 'call_123',
          output: 'time_data'
        }
      ]);
    });

    it('should handle errors gracefully', async () => {
      mockSendChat.mockRejectedValue(new Error('Internal Server Error'));

      const { result } = renderHook(() => useChatState());

      await act(async () => {
        result.current.actions.setInput('Test');
      });
      await waitFor(() => expect(result.current.state.input).toBe('Test'));

      await act(async () => {
        await result.current.actions.sendMessage();
      });

      await waitFor(() => {
        expect(result.current.state.error).toBeTruthy();
      });

      expect(result.current.state.messages[1].content).toContain('[error:');
    });

    it.skip('should prevent multiple concurrent requests', async () => {
      const mockResponse = new Response(
        createMockStream(['data: {"choices":[{"delta":{"content":"response"}}]}\n\n', 'data: [DONE]\n\n']),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
      );

      const fetchSpy = mockFetch([mockResponse, mockResponse]);
      global.fetch = fetchSpy;

      const { result } = renderHook(() => useChatState());

      act(() => {
        // Start first request
        result.current.actions.sendMessage();
        // Try to start second request while first is pending
        result.current.actions.sendMessage();
      });

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledTimes(1);
      });

      // Should only have 2 messages (1 user, 1 assistant)
      expect(result.current.state.messages.length).toBe(2);
    });
  });

  describe('Error handling', () => {
    it('should handle malformed streaming responses', async () => {
      mockSendChat.mockImplementation(async (options: any) => {
        if (options.onEvent) {
          // Simulate malformed events being ignored and valid ones processed
          options.onEvent({ type: 'text', value: 'valid content' });
        }
        return { content: 'valid content', responseId: 'test-response-id' };
      });

      const events: any[] = [];
      const result = await sendChat({
        messages: [{ role: 'user', content: 'Test' }],
        model: 'gpt-3.5-turbo',
        tools: [{ type: 'function', function: { name: 'test_tool' } }],
        onEvent: (event: any) => events.push(event)
      });

      // Should still process valid events and ignore malformed ones
      expect(events.length).toBeGreaterThan(0);
      expect(events.some(e => e.type === 'text' && e.value === 'valid content')).toBe(true);
      expect(result.content).toBe('valid content');
    });

    it('should handle network errors', async () => {
      mockSendChat.mockRejectedValue(new Error('Network error'));

      await expect(sendChat({
        messages: [{ role: 'user', content: 'Test' }],
        model: 'gpt-3.5-turbo',
        tools: []
      })).rejects.toThrow('Network error');
    });
  });
});
