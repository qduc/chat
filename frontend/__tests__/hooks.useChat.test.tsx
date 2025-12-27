import { renderHook, act, waitFor } from '@testing-library/react';
import type { ChatOptionsExtended } from '../lib/types';
import { useChat } from '../hooks/useChat';
import { APIError } from '../lib/streaming';

jest.mock('../lib/api', () => ({
  conversations: {
    list: jest.fn(),
    get: jest.fn(),
    delete: jest.fn(),
    editMessage: jest.fn(),
    create: jest.fn(),
    invalidate: jest.fn(),
    invalidateDetailCache: jest.fn(),
    clearListCache: jest.fn(),
  },
  chat: {
    sendMessage: jest.fn(),
    stopMessage: jest.fn(),
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
import type { HttpResponse } from '../lib/http';

const mockConversations = conversations as jest.Mocked<typeof conversations>;
const mockChat = chat as jest.Mocked<typeof chat>;
const mockAuth = auth as jest.Mocked<typeof auth>;
const mockHttpClient = httpClient as jest.Mocked<typeof httpClient>;

function createHttpResponse<T>(data: T): HttpResponse<T> {
  return {
    data,
    status: 200,
    statusText: 'OK',
    headers: new Headers(),
  };
}

function arrangeHttpMocks() {
  mockHttpClient.get.mockImplementation((url: string) => {
    if (url === '/v1/providers') {
      return Promise.resolve(
        createHttpResponse({
          providers: [
            { id: 'openai', name: 'OpenAI', enabled: 1 },
            { id: 'disabled', name: 'Disabled', enabled: 0 },
          ],
        })
      );
    }
    if (url === '/v1/providers/openai/models') {
      return Promise.resolve(
        createHttpResponse({
          provider: { id: 'openai' },
          models: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }],
        })
      );
    }
    return Promise.resolve(
      createHttpResponse({
        provider: { id: 'unknown' },
        models: [],
      })
    );
  });
}

function renderUseChat() {
  arrangeHttpMocks();
  mockAuth.getProfile.mockResolvedValue({
    id: 'user-123',
    email: 'user@example.com',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
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
      (global.crypto as any).randomUUID = jest.fn(
        () => `uuid-${Math.random().toString(16).slice(2)}`
      );
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
          id: 100,
          seq: 1,
          role: 'assistant',
          content: 'Looking up data...',
          created_at: '2024-01-01T00:01:00Z',
          status: 'completed',
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
          id: 101,
          seq: 2,
          role: 'tool',
          content: null,
          created_at: '2024-01-01T00:01:05Z',
          status: 'completed',
          tool_outputs: [
            {
              tool_call_id: toolCallId,
              output: { data: 'result' },
              status: 'success',
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
      { tool_call_id: toolCallId, output: { data: 'result' }, status: 'success' },
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
          created_at: new Date().toISOString(),
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

  test('sendMessage continues to use the updated provider after switching conversations', async () => {
    const now = new Date().toISOString();
    let conv2Calls = 0;
    mockConversations.get.mockImplementation(async (id: string) => {
      if (id === 'conv-1') {
        return {
          id: 'conv-1',
          title: 'Conversation A',
          model: 'model-a',
          provider_id: 'provider-a',
          created_at: now,
          messages: [],
          next_after_seq: null,
        };
      }
      if (id === 'conv-2') {
        conv2Calls += 1;
        return {
          id: 'conv-2',
          title: 'Conversation B',
          model: 'model-b',
          provider_id: conv2Calls >= 2 ? 'provider-b' : 'provider-a',
          created_at: now,
          messages: [],
          next_after_seq: null,
        };
      }
      throw new Error(`Unexpected conversation id: ${id}`);
    });

    mockChat.sendMessage.mockResolvedValue({
      content: 'ok',
      conversation: {
        id: 'conv-2',
        title: 'Conversation B',
        created_at: now,
      },
    });

    const { result } = renderUseChat();

    await act(async () => {
      await result.current.selectConversation('conv-2');
    });

    // User updates the provider manually (e.g., via model selector)
    await act(async () => {
      result.current.setProviderId('provider-b');
      result.current.setModel('provider-b::model-b');
    });

    await act(async () => {
      result.current.setInput('First message with provider B');
    });

    await act(async () => {
      await result.current.sendMessage();
    });

    expect(mockChat.sendMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        providerId: 'provider-b',
      })
    );

    await act(async () => {
      await result.current.selectConversation('conv-1');
    });

    await act(async () => {
      await result.current.selectConversation('conv-2');
    });

    await act(async () => {
      result.current.setInput('Second message with provider B');
    });

    await act(async () => {
      await result.current.sendMessage();
    });

    expect(mockChat.sendMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        providerId: 'provider-b',
      })
    );

    expect(conv2Calls).toBe(2);
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

  test('sendMessage surfaces upstream error details when proxy wraps errors', async () => {
    mockChat.sendMessage.mockRejectedValue(
      new APIError(502, 'HTTP 502: Upstream provider returned an error response.', {
        error: 'upstream_error',
        message: 'Upstream provider returned an error response.',
        upstream: {
          status: 401,
          message: 'Unauthorized',
        },
      })
    );

    const { result } = renderUseChat();

    await act(async () => {
      await result.current.sendMessage('Hello');
    });

    await waitFor(() => {
      expect(result.current.error).toBe('Upstream provider error (status 401): Unauthorized');
      expect(result.current.pending.error).toBe(
        'Upstream provider error (status 401): Unauthorized'
      );
    });
  });

  test('selectConversation derives provider when backend omits provider_id', async () => {
    const now = new Date().toISOString();
    mockConversations.get.mockImplementation(async (id: string) => {
      if (id === 'conv-1') {
        return {
          id: 'conv-1',
          title: 'With provider',
          model: 'gpt-4o',
          provider_id: 'openai',
          created_at: now,
          messages: [],
          next_after_seq: null,
        };
      }
      if (id === 'conv-2') {
        return {
          id: 'conv-2',
          title: 'Missing provider',
          model: 'gpt-4o',
          provider_id: undefined,
          created_at: now,
          messages: [],
          next_after_seq: null,
        };
      }
      throw new Error(`Unexpected conversation id: ${id}`);
    });

    const { result } = renderUseChat();

    await waitFor(() => expect(result.current.modelOptions.length).toBeGreaterThan(0));

    await act(async () => {
      await result.current.selectConversation('conv-1');
    });

    expect(result.current.providerId).toBe('openai');
    expect(result.current.model).toBe('openai::gpt-4o');

    await act(async () => {
      await result.current.selectConversation('conv-2');
    });

    expect(result.current.providerId).toBe('openai');
    expect(result.current.model).toBe('openai::gpt-4o');
  });

  test('selectConversation clears stale provider when mapping is unavailable', async () => {
    const now = new Date().toISOString();
    mockConversations.get.mockImplementation(async (id: string) => {
      if (id === 'conv-1') {
        return {
          id: 'conv-1',
          title: 'First',
          model: 'model-a',
          provider_id: 'provider-a',
          created_at: now,
          messages: [],
          next_after_seq: null,
        };
      }
      if (id === 'conv-2') {
        return {
          id: 'conv-2',
          title: 'Second missing provider',
          model: 'model-b',
          provider_id: undefined,
          created_at: now,
          messages: [],
          next_after_seq: null,
        };
      }
      throw new Error(`Unexpected conversation id: ${id}`);
    });

    mockHttpClient.get.mockImplementation((url: string) => {
      if (url === '/v1/providers') {
        return Promise.resolve(createHttpResponse({ providers: [] }));
      }
      return Promise.resolve(createHttpResponse({ provider: { id: 'none' }, models: [] }));
    });

    mockAuth.getProfile.mockResolvedValue({
      id: 'user-123',
      email: 'user@example.com',
      createdAt: now,
      updatedAt: now,
    });

    const { result } = renderHook(() => useChat());

    await act(async () => {
      await result.current.selectConversation('conv-1');
    });

    expect(result.current.providerId).toBe('provider-a');

    await act(async () => {
      await result.current.selectConversation('conv-2');
    });

    expect(result.current.providerId).toBeNull();
  });

  test('loadProvidersAndModels builds groups and provider mapping', async () => {
    const { result } = renderUseChat();

    await waitFor(() => expect(mockHttpClient.get).toHaveBeenCalledWith('/v1/providers'));
    await waitFor(() => expect(result.current.modelGroups.length).toBeGreaterThan(0));

    expect(result.current.modelGroups[0]).toMatchObject({
      id: 'openai',
      label: 'OpenAI',
    });
    // Model values should now be provider-qualified (provider::model)
    expect(result.current.modelOptions).toEqual(
      expect.arrayContaining([
        { label: 'gpt-4o', value: 'openai::gpt-4o' },
        { label: 'gpt-4o-mini', value: 'openai::gpt-4o-mini' },
      ])
    );
    expect(result.current.modelToProvider['openai::gpt-4o']).toBe('openai');
    await waitFor(() => expect(result.current.providerId).toBe('openai'));
  });

  test('handles duplicate model IDs across different providers', async () => {
    // Arrange: Mock two providers with the same model ID
    mockHttpClient.get.mockImplementation((url: string) => {
      if (url === '/v1/providers') {
        return Promise.resolve(
          createHttpResponse({
            providers: [
              { id: 'provider1', name: 'Provider 1', enabled: 1 },
              { id: 'provider2', name: 'Provider 2', enabled: 1 },
            ],
          })
        );
      }
      if (url === '/v1/providers/provider1/models') {
        return Promise.resolve(
          createHttpResponse({
            provider: { id: 'provider1' },
            models: [{ id: 'shared-model' }, { id: 'model-1' }],
          })
        );
      }
      if (url === '/v1/providers/provider2/models') {
        return Promise.resolve(
          createHttpResponse({
            provider: { id: 'provider2' },
            models: [{ id: 'shared-model' }, { id: 'model-2' }],
          })
        );
      }
      return Promise.resolve(createHttpResponse({ provider: { id: 'unknown' }, models: [] }));
    });

    mockAuth.getProfile.mockResolvedValue({
      id: 'user-123',
      email: 'user@example.com',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const { result } = renderHook(() => useChat());

    await waitFor(() => expect(result.current.modelGroups.length).toBe(2));

    // Both providers should have their own qualified versions of the shared model
    expect(result.current.modelOptions).toEqual(
      expect.arrayContaining([
        { label: 'shared-model', value: 'provider1::shared-model' },
        { label: 'shared-model', value: 'provider2::shared-model' },
        { label: 'model-1', value: 'provider1::model-1' },
        { label: 'model-2', value: 'provider2::model-2' },
      ])
    );

    // Verify each qualified model maps to its correct provider
    expect(result.current.modelToProvider['provider1::shared-model']).toBe('provider1');
    expect(result.current.modelToProvider['provider2::shared-model']).toBe('provider2');
    expect(result.current.modelToProvider['provider1::model-1']).toBe('provider1');
    expect(result.current.modelToProvider['provider2::model-2']).toBe('provider2');
  });
});
