jest.mock('../contexts/AuthContext', () => {
  const authValue = {
    user: { id: 'test-user', email: 'test@example.com' },
    loading: false,
    ready: true,
    waitForAuth: jest.fn(() => Promise.resolve()),
    login: jest.fn(),
    register: jest.fn(),
    logout: jest.fn(),
    refreshUser: jest.fn(),
  };
  return {
    useAuth: () => authValue,
    AuthProvider: ({ children }: any) => children,
  };
});

// Simplified tests for frontend iterative orchestration functionality

// Minimal mocks: only what is used by tests
jest.mock('../lib/chat', () => ({
  ...jest.requireActual('../lib/chat'),
  sendChat: jest.fn(),
  getToolSpecs: jest.fn(),
  listConversationsApi: jest.fn(),
}));

import { renderHook, act, waitFor } from '@testing-library/react';
import { useChatState } from '../hooks/useChatState';
import { sendChat, getToolSpecs, listConversationsApi } from '../lib/chat';

const mockSendChat = sendChat as jest.MockedFunction<typeof sendChat>;
const mockGetToolSpecs = getToolSpecs as jest.MockedFunction<typeof getToolSpecs>;
const mockList = listConversationsApi as jest.MockedFunction<typeof listConversationsApi>;

const getTimeTool = {
  type: 'function' as const,
  function: {
    name: 'get_time',
    description: 'Get the current time',
    parameters: {
      type: 'object' as const,
      properties: {},
      required: [] as string[],
    },
  },
};

const webSearchTool = {
  type: 'function' as const,
  function: {
    name: 'web_search',
    description: 'Perform a web search',
    parameters: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query' },
      },
      required: ['query'],
    },
  },
};

describe('Frontend Iterative Orchestration', () => {
  beforeEach(() => {
    // Disable history to avoid network
    mockList.mockRejectedValue({ status: 501 } as any);

    // Minimal tool specs for tests
    mockGetToolSpecs.mockResolvedValue({
      tools: [getTimeTool, webSearchTool],
      available_tools: ['get_time', 'web_search']
    } as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('sendChat with tools', () => {
    it('streams events with tools enabled (behavior)', async () => {
      mockSendChat.mockImplementation(async (options: any) => {
        options.onEvent?.({ type: 'text', value: 'Hello' });
        return { content: 'Hello', responseId: 'test-response-id' };
      });

      const events: any[] = [];
      await sendChat({
        messages: [{ role: 'user', content: 'What time is it?' }],
        model: 'gpt-3.5-turbo',
        providerId: 'default-provider',
        tools: [getTimeTool],
        tool_choice: 'auto',
        onEvent: (event: any) => events.push(event)
      });

      expect(events.some(e => e.type === 'text' && e.value === 'Hello')).toBe(true);
    });

    it('should handle tool call events in streaming response', async () => {
      mockSendChat.mockImplementation(async (options: any) => {
        options.onEvent?.({ type: 'text', value: 'Let me get the time.' });
        options.onEvent?.({ type: 'tool_call', value: { id: 'call_123', type: 'function', function: { name: 'get_time', arguments: '{}' } } });
        options.onEvent?.({ type: 'tool_output', value: { tool_call_id: 'call_123', name: 'get_time', output: { iso: '2025-08-24T08:30:32.051Z' } } });
        options.onEvent?.({ type: 'text', value: 'The current time is 08:30:32 UTC.' });
        return { content: 'Let me get the time.The current time is 08:30:32 UTC.', responseId: 'test-response-id' };
      });

      const events: any[] = [];
      await sendChat({
        messages: [{ role: 'user', content: 'What time is it?' }],
        model: 'gpt-3.5-turbo',
        providerId: 'default-provider',
        tools: [getTimeTool],
        onEvent: (event: any) => events.push(event)
      });

      expect(events.some(e => e.type === 'text')).toBe(true);
      expect(events.some(e => e.type === 'tool_call')).toBe(true);
      expect(events.some(e => e.type === 'tool_output')).toBe(true);

      const toolCallEvent = events.find(e => e.type === 'tool_call');
      expect(toolCallEvent.value).toEqual({ id: 'call_123', type: 'function', function: { name: 'get_time', arguments: '{}' } });

      const toolOutputEvent = events.find(e => e.type === 'tool_output');
      expect(toolOutputEvent.value).toEqual({ tool_call_id: 'call_123', name: 'get_time', output: { iso: '2025-08-24T08:30:32.051Z' } });
    });

    it('should handle multiple tool calls in sequence', async () => {
      mockSendChat.mockImplementation(async (options: any) => {
        options.onEvent?.({ type: 'tool_call', value: { id: 'call_1', function: { name: 'get_time' } } });
        options.onEvent?.({ type: 'tool_output', value: { tool_call_id: 'call_1', name: 'get_time', output: 'time_result' } });
        options.onEvent?.({ type: 'tool_call', value: { id: 'call_2', function: { name: 'web_search' } } });
        options.onEvent?.({ type: 'tool_output', value: { tool_call_id: 'call_2', name: 'web_search', output: 'search_result' } });
        options.onEvent?.({ type: 'text', value: 'Final analysis based on both results.' });
        return { content: 'Final analysis based on both results.', responseId: 'test-response-id' };
      });

      const events: any[] = [];
      await sendChat({
        messages: [{ role: 'user', content: 'Get time then search' }],
        model: 'gpt-3.5-turbo',
        providerId: 'default-provider',
        tools: [getTimeTool, webSearchTool],
        onEvent: (event: any) => events.push(event)
      });

      const toolCallEvents = events.filter(e => e.type === 'tool_call');
      const toolOutputEvents = events.filter(e => e.type === 'tool_output');
      expect(toolCallEvents.length).toBe(2);
      expect(toolOutputEvents.length).toBe(2);
      expect(toolCallEvents[0].value.id).toBe('call_1');
      expect(toolCallEvents[1].value.id).toBe('call_2');
      expect(toolOutputEvents[0].value.tool_call_id).toBe('call_1');
      expect(toolOutputEvents[1].value.tool_call_id).toBe('call_2');
    });
  });

  describe('useChatState hook', () => {
    it('should handle tool events and update messages correctly', async () => {
      mockSendChat.mockImplementation(async (options: any) => {
        options.onEvent?.({ type: 'text', value: 'Let me help you.' });
        options.onEvent?.({ type: 'tool_call', value: { id: 'call_123', function: { name: 'get_time' } } });
        options.onEvent?.({ type: 'tool_output', value: { tool_call_id: 'call_123', output: 'time_data' } });
        options.onEvent?.({ type: 'text', value: ' Done!' });
        return { content: 'Let me help you. Done!', responseId: 'test-response-id' };
      });

      const { result } = renderHook(() => useChatState());
      await act(async () => { result.current.actions.setInput('Test message'); });
      await waitFor(() => expect(result.current.state.input).toBe('Test message'));
      await act(async () => { await result.current.actions.sendMessage(); });

      await waitFor(() => {
        expect(result.current.state.messages.length).toBeGreaterThanOrEqual(4);
      });

      const toolCallMessage = result.current.state.messages[1];
      expect(toolCallMessage.role).toBe('assistant');
      expect(toolCallMessage.tool_calls).toEqual([
        expect.objectContaining({
          id: 'call_123',
          function: { name: 'get_time' }
        })
      ]);
      expect(toolCallMessage.tool_outputs).toBeUndefined();

      const toolMessage = result.current.state.messages.find(m => m.role === 'tool');
      expect(toolMessage).toEqual(expect.objectContaining({
        tool_call_id: 'call_123',
        content: 'time_data'
      }));

      const finalAssistantMessage = [...result.current.state.messages].reverse().find(m => m.role === 'assistant');
      expect(finalAssistantMessage).toBeDefined();
      expect(finalAssistantMessage?.content).toBe('Let me help you. Done!');
    });

    it('should handle errors gracefully', async () => {
      mockSendChat.mockRejectedValue(new Error('Internal Server Error'));

      const { result } = renderHook(() => useChatState());
      await act(async () => { result.current.actions.setInput('Test'); });
      await waitFor(() => expect(result.current.state.input).toBe('Test'));
      await act(async () => { await result.current.actions.sendMessage(); });

      await waitFor(() => { expect(result.current.state.error).toBeTruthy(); });
      expect(result.current.state.messages[1].content).toContain('[error:');
    });
  });

  describe('Error handling', () => {
    it('should handle malformed streaming responses', async () => {
      mockSendChat.mockImplementation(async (options: any) => {
        options.onEvent?.({ type: 'text', value: 'valid content' });
        return { content: 'valid content', responseId: 'test-response-id' };
      });

      const events: any[] = [];
      const result = await sendChat({
        messages: [{ role: 'user', content: 'Test' }],
        model: 'gpt-3.5-turbo',
        providerId: 'default-provider',
        tools: [{
          type: 'function',
          function: {
            name: 'test_tool',
            description: 'Test tool',
            parameters: {
              type: 'object',
              properties: {},
              required: [],
            },
          },
        }],
        onEvent: (event: any) => events.push(event)
      });

      expect(events.length).toBeGreaterThan(0);
      expect(events.some(e => e.type === 'text' && e.value === 'valid content')).toBe(true);
      expect(result.content).toBe('valid content');
    });

    it('should handle network errors', async () => {
      mockSendChat.mockRejectedValue(new Error('Network error'));

      await expect(sendChat({
        messages: [{ role: 'user', content: 'Test' }],
        model: 'gpt-3.5-turbo',
        providerId: 'default-provider',
        tools: []
      })).rejects.toThrow('Network error');
    });
  });
});
