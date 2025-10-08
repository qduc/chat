import { renderHook, act, waitFor } from '@testing-library/react';
import type { ChatOptionsExtended } from '../lib/types';
import { useChat } from '../hooks/useChat';

jest.mock('../lib/api', () => ({
  conversations: {
    list: jest.fn(),
    get: jest.fn(),
    delete: jest.fn(),
    editMessage: jest.fn(),
    create: jest.fn(),
  },
  chat: {
    sendMessage: jest.fn(),
  },
  providers: {
    getToolSpecs: jest.fn(),
  },
  auth: {
    getProfile: jest.fn(),
  },
}));

jest.mock('../lib/http', () => ({
  httpClient: {
    get: jest.fn(),
  },
}));

import { conversations, chat, auth } from '../lib/api';
import { httpClient } from '../lib/http';

const mockConversations = conversations as jest.Mocked<typeof conversations>;
const mockChat = chat as jest.Mocked<typeof chat>;
const mockAuth = auth as jest.Mocked<typeof auth>;
const mockHttpClient = httpClient as jest.Mocked<typeof httpClient>;

function arrangeHttpMocks() {
  mockHttpClient.get.mockImplementation((url: string) => {
    if (url === '/v1/providers') {
      return Promise.resolve({
        data: {
          providers: [
            { id: 'openai', name: 'OpenAI', enabled: 1 },
            { id: 'disabled', name: 'Disabled', enabled: 0 },
          ],
        },
      });
    }
    if (url === '/v1/providers/openai/models') {
      return Promise.resolve({
        data: {
          provider: { id: 'openai' },
          models: [
            { id: 'gpt-4o' },
            { id: 'gpt-4o-mini' },
          ],
        },
      });
    }
    return Promise.resolve({
      data: {
        provider: { id: 'unknown' },
        models: [],
      },
    });
  });
}

function renderUseChat() {
  arrangeHttpMocks();
  mockAuth.getProfile.mockResolvedValue({ id: 'user-123' });
  return renderHook(() => useChat());
}

describe('useChat hook', () => {
  beforeAll(() => {
    if (typeof global.crypto === 'undefined') {
      Object.defineProperty(global, 'crypto', {
        value: {},
        configurable: true,
      });
    }
    if (typeof (global.crypto as any).randomUUID !== 'function') {
      (global.crypto as any).randomUUID = jest.fn(() => `uuid-${Math.random().toString(16).slice(2)}`);
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
  });

  test('loads saved model preference on mount when no active conversation', async () => {
    window.localStorage.setItem('selectedModel', 'gpt-4o-mini');

    const { result } = renderUseChat();

    await waitFor(() => expect(result.current.model).toBe('gpt-4o-mini'));
  });

  test('selectConversation merges tool outputs and applies conversation settings', async () => {
    const toolCallId = 'tool-call-1';
    mockConversations.get.mockResolvedValue({
      id: 'conv-1',
      title: 'Merged Conversation',
      model: 'gpt-4o',
      created_at: '2024-01-01T00:00:00Z',
      messages: [
        {
          id: '100',
          role: 'assistant',
          content: 'Looking up data...',
          created_at: '2024-01-01T00:01:00Z',
          tool_calls: [
            {
              id: toolCallId,
              index: 0,
              type: 'function',
              function: { name: 'lookup', arguments: '{}' },
            },
          ],
        },
        {
          id: '101',
          role: 'tool',
          content: null,
          created_at: '2024-01-01T00:01:05Z',
          tool_outputs: [
            {
              tool_call_id: toolCallId,
              output: { data: 'result' },
            },
          ],
        },
      ],
      next_after_seq: null,
      tools_enabled: true,
      streaming_enabled: true,
      active_tools: ['lookup'],
      system_prompt: 'Be helpful',
      active_system_prompt_id: 'prompt-123',
      quality_level: 'high',
    });

    const { result } = renderUseChat();

    await act(async () => {
      await result.current.selectConversation('conv-1');
    });

    expect(result.current.conversationId).toBe('conv-1');
    expect(result.current.currentConversationTitle).toBe('Merged Conversation');
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].tool_outputs).toEqual([
      { tool_call_id: toolCallId, output: { data: 'result' } },
    ]);
    expect(result.current.useTools).toBe(true);
    expect(result.current.enabledTools).toEqual(['lookup']);
    expect(result.current.systemPrompt).toBe('Be helpful');
    expect(result.current.activeSystemPromptId).toBe('prompt-123');
    expect(result.current.qualityLevel).toBe('high');
  });

  test('sendMessage streams tokens, tool events, and finalizes assistant message', async () => {
    mockChat.sendMessage.mockImplementation(async (options: ChatOptionsExtended) => {
      options.onToken?.('Hello');
      options.onEvent?.({
        type: 'tool_call',
        value: {
          index: 0,
          id: 'call-1',
          type: 'function',
          function: { name: 'clock', arguments: '{' },
        },
      });
      options.onEvent?.({
        type: 'tool_call',
        value: {
          index: 0,
          function: { arguments: '}' },
        },
      });
      options.onEvent?.({
        type: 'tool_output',
        value: {
          tool_call_id: 'call-1',
          name: 'clock',
          output: '12:00',
        },
      });
      options.onEvent?.({
        type: 'usage',
        value: { total_tokens: 42 },
      });
      return {
        content: 'Final answer',
        conversation: {
          id: 'conv-stream',
          title: 'Streaming Conversation',
        },
      };
    });

    const { result } = renderUseChat();

    await act(async () => {
      result.current.setInput('What time is it?');
    });

    await act(async () => {
      await result.current.sendMessage();
    });

    expect(mockChat.sendMessage).toHaveBeenCalledTimes(1);
    expect(result.current.messages).toHaveLength(2);
    const assistantMessage = result.current.messages[1];
    expect(assistantMessage.content).toBe('Final answer');
    expect(assistantMessage.tool_calls?.[0].function?.arguments).toBe('{}');
    expect(assistantMessage.tool_outputs?.[0]).toMatchObject({
      tool_call_id: 'call-1',
      name: 'clock',
      output: '12:00',
    });
    expect(assistantMessage.usage).toEqual({ total_tokens: 42 });
    expect(result.current.conversationId).toBe('conv-stream');
    expect(result.current.status).toBe('idle');
    expect(result.current.error).toBeNull();
  });

  test('stopStreaming aborts in-flight request and records cancellation error', async () => {
    let capturedSignal: AbortSignal | undefined;
    mockChat.sendMessage.mockImplementation(
      (options: ChatOptionsExtended) =>
        new Promise((_resolve, reject) => {
          capturedSignal = options.signal;
          options.signal?.addEventListener?.('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        })
    );

    const { result } = renderUseChat();

    let sendPromise: Promise<void> | undefined;
    act(() => {
      sendPromise = result.current.sendMessage('Please stream forever');
    });

    expect(capturedSignal?.aborted).toBe(false);

    await act(async () => {
      result.current.stopStreaming();
      await sendPromise!;
    });

    expect(capturedSignal?.aborted).toBe(true);
    expect(result.current.status).toBe('idle');
    await waitFor(() => expect(result.current.error).toBe('Message cancelled'));
  });

  test('loadProvidersAndModels builds groups and provider mapping', async () => {
    const { result } = renderUseChat();

    await waitFor(() => expect(mockHttpClient.get).toHaveBeenCalledWith('/v1/providers'));
    await waitFor(() => expect(result.current.modelGroups.length).toBeGreaterThan(0));

    expect(result.current.modelGroups[0]).toMatchObject({
      id: 'openai',
      label: 'OpenAI',
    });
    expect(result.current.modelOptions).toEqual(
      expect.arrayContaining([
        { label: 'gpt-4o', value: 'gpt-4o' },
        { label: 'gpt-4o-mini', value: 'gpt-4o-mini' },
      ])
    );
    expect(result.current.modelToProvider['gpt-4o']).toBe('openai');
    await waitFor(() => expect(result.current.providerId).toBe('openai'));
  });
});
