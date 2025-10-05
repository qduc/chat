// Mock the auth context
jest.mock('../contexts/AuthContext', () => {
  const authValue = {
    user: { id: 'test-user', email: 'test@example.com', name: 'Test User' },
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

import { describe, test, expect, beforeEach } from '@jest/globals';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useChatState } from '../hooks/useChatState';
import * as chatLib from '../lib/chat';

// Mock the chat library
jest.mock('../lib/chat');

const mockedChatLib = chatLib as jest.Mocked<typeof chatLib>;

describe('Tool Calls in Conversations', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Mock getToolSpecs
    mockedChatLib.getToolSpecs = jest.fn().mockResolvedValue({
      tools: [],
      available_tools: ['get_time', 'web_search']
    });

    // Mock listConversationsApi
    mockedChatLib.listConversationsApi = jest.fn().mockResolvedValue({
      items: [],
      next_cursor: null
    });

    // Mock ConversationManager to use the above mocked APIs
    mockedChatLib.ConversationManager = jest.fn().mockImplementation(() => ({
      list: (opts?: any) => (mockedChatLib.listConversationsApi ? mockedChatLib.listConversationsApi(undefined, opts) : Promise.resolve({ items: [], next_cursor: null })),
      get: (id: any, opts?: any) => (mockedChatLib.getConversationApi ? mockedChatLib.getConversationApi(undefined, id, opts) : Promise.resolve(null)),
      delete: (id: any) => (mockedChatLib.deleteConversationApi ? mockedChatLib.deleteConversationApi(undefined, id) : Promise.resolve(undefined)),
    } as any));
  });

  test('loads conversation with tool calls and outputs', async () => {
    // Mock a conversation with tool calls
    mockedChatLib.getConversationApi = jest.fn().mockResolvedValue({
      id: 'conv-with-tools',
      title: 'Conversation with Tools',
      model: 'gpt-4o',
      created_at: '2023-01-01',
      messages: [
        {
          id: 1,
          seq: 1,
          role: 'user',
          status: 'final',
          content: 'What time is it?',
          created_at: '2023-01-01T00:00:00Z'
        },
        {
          id: 2,
          seq: 2,
          role: 'assistant',
          status: 'final',
          content: 'Let me check the time for you.',
          created_at: '2023-01-01T00:01:00Z',
          tool_calls: [
            {
              id: 'call_123',
              type: 'function',
              index: 0,
              function: {
                name: 'get_time',
                arguments: '{}'
              }
            }
          ]
        },
        {
          id: 3,
          seq: 3,
          role: 'tool',
          status: 'success',
          content: '14:30:00 UTC',
          created_at: '2023-01-01T00:01:30Z',
          tool_call_id: 'call_123'
        },
        {
          id: 4,
          seq: 4,
          role: 'assistant',
          status: 'final',
          content: 'The current time is 14:30:00 UTC.',
          created_at: '2023-01-01T00:02:00Z'
        }
      ],
      next_after_seq: null
    });

    const { result } = renderHook(() => useChatState());

    // Select the conversation
    await act(async () => {
      await result.current.actions.selectConversation('conv-with-tools');
    });

    // Wait for messages to be loaded
    await waitFor(() => {
      expect(result.current.state.messages.length).toBe(4);
    });

    // Verify the messages include tool calls and outputs
    const assistantMessage = result.current.state.messages[1];

    expect(assistantMessage.role).toBe('assistant');
    expect(assistantMessage.content).toBe('Let me check the time for you.');

    // Check tool_calls are preserved
    expect(assistantMessage.tool_calls).toBeDefined();
    expect(assistantMessage.tool_calls).toHaveLength(1);
    expect(assistantMessage.tool_calls![0].id).toBe('call_123');
    expect(assistantMessage.tool_calls![0].function.name).toBe('get_time');

    // Tool outputs should be represented as separate tool messages
    expect(assistantMessage.tool_outputs).toBeUndefined();
    const toolMsg = result.current.state.messages.find(m => (m as any).role === 'tool' && (m as any).tool_call_id === 'call_123');
    expect(toolMsg).toBeDefined();
    expect((toolMsg as any).content).toBe('14:30:00 UTC');
  });

  test('loads conversation with multiple tool calls', async () => {
    mockedChatLib.getConversationApi = jest.fn().mockResolvedValue({
      id: 'conv-multi-tools',
      title: 'Conversation with Multiple Tools',
      model: 'gpt-4o',
      created_at: '2023-01-01',
      messages: [
        {
          id: 1,
          seq: 1,
          role: 'user',
          status: 'final',
          content: 'What time is it and search for AI news?',
          created_at: '2023-01-01T00:00:00Z'
        },
        {
          id: 2,
          seq: 2,
          role: 'assistant',
          status: 'final',
          content: 'Let me check both for you.',
          created_at: '2023-01-01T00:01:00Z',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              index: 0,
              function: {
                name: 'get_time',
                arguments: '{}'
              }
            },
            {
              id: 'call_2',
              type: 'function',
              index: 1,
              function: {
                name: 'web_search',
                arguments: '{"query":"AI news"}'
              }
            }
          ]
        },
        {
          id: 3,
          seq: 3,
          role: 'tool',
          status: 'success',
          content: '14:30:00 UTC',
          created_at: '2023-01-01T00:01:30Z',
          tool_call_id: 'call_1'
        },
        {
          id: 4,
          seq: 4,
          role: 'tool',
          status: 'success',
          content: 'Latest AI news results...',
          created_at: '2023-01-01T00:01:45Z',
          tool_call_id: 'call_2'
        },
        {
          id: 5,
          seq: 5,
          role: 'assistant',
          status: 'final',
          content: 'The current time is 14:30:00 UTC and here are the AI news headlines.',
          created_at: '2023-01-01T00:02:00Z'
        }
      ],
      next_after_seq: null
    });

    const { result } = renderHook(() => useChatState());

    await act(async () => {
      await result.current.actions.selectConversation('conv-multi-tools');
    });

    await waitFor(() => {
      expect(result.current.state.messages.length).toBe(5);
    });

    const assistantMessage = result.current.state.messages[1];

    // Check multiple tool calls
    expect(assistantMessage.tool_calls).toHaveLength(2);
    expect(assistantMessage.tool_calls![0].function.name).toBe('get_time');
    expect(assistantMessage.tool_calls![1].function.name).toBe('web_search');

    expect(assistantMessage.tool_outputs).toBeUndefined();
    const tool1 = result.current.state.messages.find(m => (m as any).role === 'tool' && (m as any).tool_call_id === 'call_1');
    const tool2 = result.current.state.messages.find(m => (m as any).role === 'tool' && (m as any).tool_call_id === 'call_2');
    expect(tool1).toBeDefined();
    expect(tool2).toBeDefined();
    expect((tool1 as any).content).toBe('14:30:00 UTC');
    expect((tool2 as any).content).toBe('Latest AI news results...');
  });

  test('loads conversation without tool calls correctly', async () => {
    mockedChatLib.getConversationApi = jest.fn().mockResolvedValue({
      id: 'conv-no-tools',
      title: 'Regular Conversation',
      model: 'gpt-4o',
      created_at: '2023-01-01',
      messages: [
        {
          id: 1,
          seq: 1,
          role: 'user',
          status: 'final',
          content: 'Hello',
          created_at: '2023-01-01T00:00:00Z'
        },
        {
          id: 2,
          seq: 2,
          role: 'assistant',
          status: 'final',
          content: 'Hi there!',
          created_at: '2023-01-01T00:01:00Z'
        }
      ],
      next_after_seq: null
    });

    const { result } = renderHook(() => useChatState());

    await act(async () => {
      await result.current.actions.selectConversation('conv-no-tools');
    });

    await waitFor(() => {
      expect(result.current.state.messages.length).toBe(2);
    });

  // Messages without tool calls should not have assistant-attached tool fields
  // and there should be no standalone `role:'tool'` messages either.
  const assistantMessage = result.current.state.messages[1];
  expect(assistantMessage.tool_calls).toBeUndefined();
  expect(assistantMessage.tool_outputs).toBeUndefined();
  const anyToolMsgs = result.current.state.messages.some(m => (m as any).role === 'tool');
  expect(anyToolMsgs).toBe(false);
  });

  test('loads conversation with tool call errors', async () => {
    mockedChatLib.getConversationApi = jest.fn().mockResolvedValue({
      id: 'conv-tool-error',
      title: 'Conversation with Tool Error',
      model: 'gpt-4o',
      created_at: '2023-01-01',
      messages: [
        {
          id: 1,
          seq: 1,
          role: 'user',
          status: 'final',
          content: 'Search for something',
          created_at: '2023-01-01T00:00:00Z'
        },
        {
          id: 2,
          seq: 2,
          role: 'assistant',
          status: 'final',
          content: 'Let me search for that.',
          created_at: '2023-01-01T00:01:00Z',
          tool_calls: [
            {
              id: 'call_error',
              type: 'function',
              index: 0,
              function: {
                name: 'web_search',
                arguments: '{\"query\":\"test\"}'
              }
            }
          ]
        },
        {
          id: 3,
          seq: 3,
          role: 'tool',
          status: 'error',
          content: 'Tool execution failed: timeout',
          created_at: '2023-01-01T00:01:15Z',
          tool_call_id: 'call_error'
        }
      ],
      next_after_seq: null
    });

    const { result } = renderHook(() => useChatState());

    await act(async () => {
      await result.current.actions.selectConversation('conv-tool-error');
    });

    await waitFor(() => {
      expect(result.current.state.messages.length).toBe(3);
    });

    const assistantMessage = result.current.state.messages[1];
    expect(assistantMessage.tool_outputs).toBeUndefined();

    const toolMsg = result.current.state.messages.find(m => (m as any).role === 'tool' && (m as any).tool_call_id === 'call_error');
    expect(toolMsg).toBeDefined();
    expect((toolMsg as any).content).toContain('timeout');
    expect((toolMsg as any).status).toBe('error');
  });
});
