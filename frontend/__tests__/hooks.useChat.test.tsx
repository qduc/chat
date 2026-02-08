jest.mock('../contexts/AuthContext', () => {
  const authValue = {
    user: { id: 'user-123', email: 'user@example.com' },
    isLoading: false,
    isAuthenticated: true,
    login: jest.fn(),
    logout: jest.fn(),
    register: jest.fn(),
    refreshAuth: jest.fn(),
  };
  return {
    useAuth: () => authValue,
    AuthProvider: ({ children }: any) => children,
  };
});

import { renderHook, act, waitFor } from '@testing-library/react';
import type { ChatOptionsExtended } from '../lib/types';
import { useChat } from '../hooks/useChat';
import { APIError, StreamingNotSupportedError } from '../lib/streaming';

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
  judge: {
    evaluate: jest.fn(),
    deleteEvaluation: jest.fn(),
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

import { conversations, chat, auth, judge } from '../lib/api';
import { httpClient } from '../lib/http';
import type { HttpResponse } from '../lib/http';

const mockConversations = conversations as jest.Mocked<typeof conversations>;
const mockChat = chat as jest.Mocked<typeof chat>;
const mockJudge = judge as jest.Mocked<typeof judge>;
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
  mockConversations.list.mockResolvedValue({ items: [], next_cursor: null });
  mockHttpClient.get.mockImplementation((url: string) => {
    if (url.startsWith('/v1/models')) {
      return Promise.resolve(
        createHttpResponse({
          providers: [
            {
              provider: { id: 'openai', name: 'OpenAI', provider_type: 'openai' },
              models: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }],
            },
            {
              provider: { id: 'disabled', name: 'Disabled', provider_type: 'mock' },
              models: [],
            },
          ],
          cached: false,
          cachedAt: new Date().toISOString(),
          errors: [],
        })
      );
    }
    if (url === '/v1/system-prompts') {
      return Promise.resolve(createHttpResponse({ system_prompts: [] }));
    }
    if (url === '/v1/user-settings') {
      return Promise.resolve(createHttpResponse({}));
    }
    return Promise.resolve(createHttpResponse({ providers: [] }));
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
    // Use user-scoped storage key (user-123 from the mock)
    window.localStorage.setItem('selectedModel_user-123', 'gpt-4o-mini');

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
      reasoning_effort: 'high',
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
    expect(result.current.reasoningEffort).toBe('high');
  });

  test('selectConversation maps persisted usage into messages', async () => {
    mockConversations.get.mockResolvedValue({
      id: 'conv-usage',
      title: 'Usage Conversation',
      model: 'gpt-4o',
      created_at: '2024-01-01T00:00:00Z',
      messages: [
        {
          id: 200,
          seq: 1,
          role: 'assistant',
          content: 'Done.',
          created_at: '2024-01-01T00:01:00Z',
          status: 'completed',
          usage: {
            prompt_tokens: 10,
            completion_tokens: 15,
            total_tokens: 25,
          },
        },
      ],
      next_after_seq: null,
    });

    const { result } = renderUseChat();

    await act(async () => {
      await result.current.selectConversation('conv-usage');
    });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].usage).toEqual({
      prompt_tokens: 10,
      completion_tokens: 15,
      total_tokens: 25,
    });
  });

  test('sendMessage streams tokens, tool events, and finalizes assistant message', async () => {
    // chat.sendMessage receives unqualified model IDs (without provider prefix)
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
          provider: 'provider-a',
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
          provider: conv2Calls >= 2 ? 'provider-b' : 'provider-a',
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

    // Wait for the mock to be called and signal to be captured
    await waitFor(() => expect(capturedSignal).toBeDefined());
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
          provider: 'openai',
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
          provider: undefined,
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
          provider: 'provider-a',
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
          provider: undefined,
          created_at: now,
          messages: [],
          next_after_seq: null,
        };
      }
      throw new Error(`Unexpected conversation id: ${id}`);
    });

    mockHttpClient.get.mockImplementation((url: string) => {
      if (url.startsWith('/v1/models')) {
        return Promise.resolve(
          createHttpResponse({ providers: [], cached: false, cachedAt: new Date().toISOString() })
        );
      }
      return Promise.resolve(createHttpResponse({ providers: [] }));
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

    await waitFor(() => expect(mockHttpClient.get).toHaveBeenCalledWith('/v1/models'));
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
      if (url.startsWith('/v1/models')) {
        return Promise.resolve(
          createHttpResponse({
            providers: [
              {
                provider: { id: 'provider1', name: 'Provider 1', provider_type: 'custom' },
                models: [{ id: 'shared-model' }, { id: 'model-1' }],
              },
              {
                provider: { id: 'provider2', name: 'Provider 2', provider_type: 'custom' },
                models: [{ id: 'shared-model' }, { id: 'model-2' }],
              },
            ],
            cached: false,
            cachedAt: new Date().toISOString(),
            errors: [],
          })
        );
      }
      return Promise.resolve(createHttpResponse({ providers: [] }));
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

  test('normalizes comparison models using provider mapping', async () => {
    const { result } = renderUseChat();

    await waitFor(() => expect(result.current.modelOptions.length).toBeGreaterThan(0));

    act(() => {
      result.current.setCompareModels(['gpt-4o', 'openai::gpt-4o']);
    });

    await waitFor(() => {
      expect(result.current.compareModels).toEqual(['openai::gpt-4o']);
    });
  });

  test('sendMessage executes comparison models and stores their results', async () => {
    const now = new Date().toISOString();
    mockConversations.create.mockResolvedValue({
      id: 'conv-primary',
      title: 'Primary',
      created_at: now,
    });

    mockChat.sendMessage.mockImplementation(async (options: ChatOptionsExtended) => {
      options.onToken?.('X');
      const convId = options.conversationId || `conv-${options.model}`;
      return {
        content: `reply-${options.model}`,
        conversation: {
          id: convId,
          title: `title-${options.model}`,
          created_at: now,
        },
      };
    });

    const { result } = renderUseChat();

    await waitFor(() => expect(result.current.providerId).toBe('openai'));

    act(() => {
      result.current.setModel('openai::gpt-4o');
      result.current.setCompareModels(['openai::gpt-4o-mini']);
      result.current.setInput('Compare models');
    });

    await act(async () => {
      await result.current.sendMessage();
    });

    expect(mockConversations.create).toHaveBeenCalled();
    expect(mockChat.sendMessage).toHaveBeenCalledTimes(2);
    expect(mockChat.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-4o' }));
    expect(mockChat.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-4o-mini' })
    );

    const assistantMessage = result.current.messages[1];
    expect(assistantMessage.comparisonResults?.['openai::gpt-4o-mini']).toMatchObject({
      content: 'reply-gpt-4o-mini',
      status: 'complete',
    });
    expect(result.current.linkedConversations['openai::gpt-4o-mini']).toBe('conv-gpt-4o-mini');
  });

  test('restores saved draft on mount after user profile loads', async () => {
    jest.useFakeTimers();
    const draftKey = 'chatforge_draft_user-123_new';
    window.localStorage.setItem(draftKey, 'Saved draft text');

    const { result } = renderUseChat();

    await waitFor(() => expect(result.current.user?.id).toBe('user-123'));

    await act(async () => {
      jest.advanceTimersByTime(150);
    });

    expect(result.current.input).toBe('Saved draft text');
    jest.useRealTimers();
  });

  test('debounces draft saving while typing', async () => {
    jest.useFakeTimers();
    const draftKey = 'chatforge_draft_user-123_new';
    const { result } = renderUseChat();

    await waitFor(() => expect(result.current.user?.id).toBe('user-123'));

    act(() => {
      result.current.setInput('Draft to persist');
    });

    await act(async () => {
      jest.advanceTimersByTime(1000);
    });

    expect(window.localStorage.getItem(draftKey)).toBe('Draft to persist');
    jest.useRealTimers();
  });

  test('sendMessage retries without provider streaming when unsupported', async () => {
    jest.useFakeTimers();
    const now = new Date().toISOString();

    mockChat.sendMessage
      .mockRejectedValueOnce(new StreamingNotSupportedError('Streaming not supported'))
      .mockResolvedValueOnce({
        content: 'Retried response',
        conversation: { id: 'conv-retry', title: 'Retry', created_at: now },
      });

    const { result } = renderUseChat();

    await act(async () => {
      await result.current.sendMessage('Hello');
    });

    await act(async () => {
      jest.runOnlyPendingTimers();
    });

    await waitFor(() => expect(mockChat.sendMessage).toHaveBeenCalledTimes(2));
    expect((mockChat.sendMessage.mock.calls[1][0] as ChatOptionsExtended).providerStream).toBe(
      false
    );
    await waitFor(() => expect(result.current.status).toBe('idle'));
    expect(result.current.messages).toHaveLength(2);
    jest.useRealTimers();
  });

  test('sendMessage includes files and images in the outgoing payload', async () => {
    const now = new Date().toISOString();
    mockChat.sendMessage.mockResolvedValue({
      content: 'ok',
      conversation: { id: 'conv-files', title: 'Files', created_at: now },
    });

    const { result } = renderUseChat();

    act(() => {
      result.current.setInput('Please review the files');
      result.current.setFiles([{ name: 'example.ts', content: 'console.log(1);' }]);
      result.current.setImages([
        { url: 'http://example.com/image.png', downloadUrl: 'http://cdn/image.png' },
      ]);
    });

    await act(async () => {
      await result.current.sendMessage();
    });

    const payload = mockChat.sendMessage.mock.calls[0][0];
    const userMessage = payload.messages[0];
    expect(Array.isArray(userMessage.content)).toBe(true);
    const textContent = (userMessage.content as any[])[0];
    expect(textContent).toMatchObject({
      type: 'text',
    });
    expect(textContent.text).toContain('File: example.ts');
    expect(textContent.text).toContain('```typescript');
    expect(textContent.text).toContain('Please review the files');
    expect(userMessage.content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'http://cdn/image.png' },
    });
    expect(result.current.input).toBe('');
    expect(result.current.files).toEqual([]);
    expect(result.current.images).toEqual([]);
  });

  test('sendMessage allows file-only payloads', async () => {
    const now = new Date().toISOString();
    mockChat.sendMessage.mockResolvedValue({
      content: 'ok',
      conversation: { id: 'conv-file-only', title: 'Files', created_at: now },
    });

    const { result } = renderUseChat();

    act(() => {
      result.current.setInput('');
      result.current.setFiles([{ name: 'example.ts', content: 'console.log(1);' }]);
    });

    await act(async () => {
      await result.current.sendMessage();
    });

    expect(mockChat.sendMessage).toHaveBeenCalledTimes(1);
    const payload = mockChat.sendMessage.mock.calls[0][0];
    const userMessage = payload.messages[0];
    expect(typeof userMessage.content).toBe('string');
    expect(userMessage.content).toContain('File: example.ts');
    expect(result.current.files).toEqual([]);
  });

  test('regenerate reuses the original user message id without duplication', async () => {
    const now = new Date().toISOString();
    mockChat.sendMessage.mockResolvedValue({
      content: 'regenerated',
      conversation: { id: 'conv-regenerate', title: 'Regenerated', created_at: now },
    });

    const { result } = renderUseChat();

    act(() => {
      result.current.setModel('openai::gpt-4o');
    });

    const baseMessages = [
      { id: 'user-1', role: 'user', content: 'Original question' },
      { id: 'assistant-1', role: 'assistant', content: 'Old answer' },
    ];

    await act(async () => {
      await result.current.regenerate(baseMessages as any);
    });

    expect(result.current.messages).toHaveLength(3);
    const payload = mockChat.sendMessage.mock.calls[0][0];
    const userMessageIds = payload.messages.filter((msg: any) => msg.id === 'user-1');
    expect(userMessageIds).toHaveLength(1);
  });

  test('judgeComparison streams draft content, stores evaluation, and deleteJudgeResponse removes it', async () => {
    const now = new Date().toISOString();
    mockConversations.get.mockResolvedValue({
      id: 'conv-judge',
      title: 'Judge',
      model: 'gpt-4o',
      provider: 'openai',
      created_at: now,
      messages: [
        {
          id: 'user-1',
          seq: 1,
          role: 'user',
          content: 'Question',
          created_at: now,
          status: 'completed',
        },
        {
          id: 'assistant-1',
          seq: 2,
          role: 'assistant',
          content: 'Answer',
          created_at: now,
          status: 'completed',
        },
      ],
      linked_conversations: [
        {
          id: 'conv-mini',
          model: 'gpt-4o-mini',
          provider_id: 'openai',
          created_at: '2024-01-01T00:00:00Z',
          messages: [
            {
              id: 'assistant-2',
              seq: 2,
              role: 'assistant',
              content: 'Alt',
              created_at: '2024-01-01T00:02:00Z',
              status: 'completed',
            },
          ],
        },
      ],
      next_after_seq: null,
    });

    mockJudge.evaluate.mockImplementation(async (options: any) => {
      options.onToken?.('Draft');
      const evaluation = {
        id: 'eval-1',
        user_id: 'user-123',
        conversation_id: options.conversationId || 'conv-judge',
        model_a_conversation_id: options.model_a_conversation_id || 'conv-a',
        model_a_message_id: options.model_a_message_id || 'msg-a',
        model_b_conversation_id: options.model_b_conversation_id || 'conv-b',
        model_b_message_id: options.model_b_message_id || 'msg-b',
        judge_model_id: options.judgeModelId || 'gpt-4o',
        criteria: options.criteria || null,
        score_a: options.score_a || null,
        score_b: options.score_b || null,
        winner: options.winner || null,
        reasoning: options.reasoning || null,
        created_at: new Date().toISOString(),
      };
      options.onEvaluation?.(evaluation);
      return evaluation;
    });

    mockJudge.deleteEvaluation.mockResolvedValue(undefined);

    const { result } = renderUseChat();

    await act(async () => {
      await result.current.selectConversation('conv-judge');
    });

    await waitFor(() =>
      expect(result.current.messages[1].comparisonResults?.['openai::gpt-4o-mini']).toBeDefined()
    );

    await act(async () => {
      await result.current.judgeComparison({
        messageId: 'assistant-1',
        selectedModelIds: ['primary', 'openai::gpt-4o-mini'],
        judgeModelId: 'openai::gpt-4o',
      });
    });

    expect(mockJudge.evaluate).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-judge',
        messageId: 'assistant-1',
        judgeModelId: 'openai::gpt-4o',
        judgeProviderId: null,
      })
    );
    expect(result.current.evaluationDrafts).toHaveLength(0);
    expect(result.current.evaluations).toHaveLength(1);

    await act(async () => {
      await result.current.deleteJudgeResponse('eval-1');
    });

    expect(mockJudge.deleteEvaluation).toHaveBeenCalledWith('eval-1');
    expect(result.current.evaluations).toHaveLength(0);
  });

  test('saveEdit updates message content and clears comparison state on forked conversation', async () => {
    const now = new Date().toISOString();
    mockConversations.get.mockResolvedValue({
      id: 'conv-edit',
      title: 'Editable',
      model: 'gpt-4o',
      provider: 'openai',
      created_at: now,
      messages: [
        {
          id: 'msg-1',
          seq: 1,
          role: 'user',
          content: 'Original',
          created_at: now,
          status: 'completed',
        },
        {
          id: 'msg-2',
          seq: 2,
          role: 'assistant',
          content: 'Reply',
          created_at: now,
          status: 'completed',
        },
      ],
      linked_conversations: [
        {
          id: 'conv-mini',
          model: 'gpt-4o-mini',
          provider_id: 'openai',
          created_at: '2024-01-01T00:00:00Z',
          messages: [
            {
              id: 'msg-2-mini',
              seq: 2,
              role: 'assistant',
              content: 'Alt',
              created_at: '2024-01-01T00:02:00Z',
              status: 'completed',
            },
          ],
        },
      ],
      next_after_seq: null,
    });
    mockConversations.editMessage.mockResolvedValue({
      message: {
        id: 'msg-edit',
        seq: 3,
        content: 'Edited message',
      },
      new_conversation_id: 'conv-edit-forked',
    });

    const { result } = renderUseChat();

    await act(async () => {
      await result.current.selectConversation('conv-edit');
    });

    await waitFor(() => expect(result.current.compareModels).toEqual(['openai::gpt-4o-mini']));
    await waitFor(() =>
      expect(result.current.messages[1].comparisonResults?.['openai::gpt-4o-mini']).toBeDefined()
    );

    act(() => {
      result.current.startEdit('msg-1', 'Original');
      result.current.updateEditContent('Updated text');
    });

    expect(result.current.compareModels).toEqual(['openai::gpt-4o-mini']);

    await act(async () => {
      await result.current.saveEdit();
    });

    expect(mockConversations.editMessage).toHaveBeenCalledWith(
      'conv-edit',
      'msg-1',
      'Updated text'
    );
    expect(result.current.conversationId).toBe('conv-edit-forked');
    expect(result.current.compareModels).toEqual([]);
    expect(result.current.linkedConversations).toEqual({});
    expect(result.current.messages[0].content).toBe('Updated text');
    expect(result.current.messages[1].comparisonResults).toBeUndefined();
    expect(result.current.editingMessageId).toBeNull();
    expect(result.current.editingContent).toBe('');
  });

  test('newChat resets state and reloads saved model preference', async () => {
    const now = new Date().toISOString();
    // Use user-scoped storage key (user-123 from the mock)
    window.localStorage.setItem('selectedModel_user-123', 'openai::gpt-4o-mini');

    mockConversations.get.mockResolvedValue({
      id: 'conv-reset',
      title: 'Reset Me',
      model: 'gpt-4o',
      provider: 'openai',
      created_at: now,
      messages: [],
      next_after_seq: null,
    });

    const { result } = renderUseChat();

    await act(async () => {
      await result.current.selectConversation('conv-reset');
    });

    act(() => {
      result.current.setMessages([{ id: 'msg-1', role: 'user', content: 'Hello' }] as any);
      result.current.setInput('Draft');
    });

    act(() => {
      result.current.newChat();
    });

    expect(result.current.conversationId).toBeNull();
    expect(result.current.messages).toHaveLength(0);
    expect(result.current.input).toBe('');
    expect(result.current.currentConversationTitle).toBeNull();
    expect(result.current.model).toBe('openai::gpt-4o-mini');
  });

  test('toggleSidebar persists collapsed state to localStorage', async () => {
    window.localStorage.setItem('sidebarCollapsed', 'true');
    const { result } = renderUseChat();

    expect(result.current.sidebarCollapsed).toBe(true);

    act(() => {
      result.current.toggleSidebar();
    });

    expect(result.current.sidebarCollapsed).toBe(false);
    expect(window.localStorage.getItem('sidebarCollapsed')).toBe('false');
  });
});

/**
 * Phase 0 Characterization Tests
 *
 * These tests pin high-risk behaviors before refactoring:
 * 1. Send gating parity (text/image/file/audio)
 * 2. Send pipeline failure recovery
 * 3. Compare-mode send/retry behavior
 * 4. selectConversation hydration and linked conversation mapping
 */
describe('Phase 0 Characterization Tests', () => {
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

  describe('1. Send Gating Parity', () => {
    test('sendMessage does nothing when no text and no attachments', async () => {
      arrangeHttpMocks();
      mockAuth.getProfile.mockResolvedValue({
        id: 'user-123',
        email: 'user@example.com',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const { result } = renderHook(() => useChat());

      await act(async () => {
        result.current.setInput('');
      });

      await act(async () => {
        await result.current.sendMessage();
      });

      expect(mockChat.sendMessage).not.toHaveBeenCalled();
      expect(result.current.messages).toHaveLength(0);
      expect(result.current.status).toBe('idle');
    });

    test('sendMessage sends with text only (no attachments)', async () => {
      const now = new Date().toISOString();
      arrangeHttpMocks();
      mockAuth.getProfile.mockResolvedValue({
        id: 'user-123',
        email: 'user@example.com',
        createdAt: now,
        updatedAt: now,
      });
      mockChat.sendMessage.mockResolvedValue({
        content: 'Response',
        conversation: { id: 'conv-text', title: 'Text', created_at: now },
      });

      const { result } = renderHook(() => useChat());

      await act(async () => {
        result.current.setInput('Hello world');
      });

      await act(async () => {
        await result.current.sendMessage();
      });

      expect(mockChat.sendMessage).toHaveBeenCalledTimes(1);
      const payload = mockChat.sendMessage.mock.calls[0][0];
      expect(payload.messages[0].content).toBe('Hello world');
    });

    test('sendMessage sends with image only (empty text)', async () => {
      const now = new Date().toISOString();
      arrangeHttpMocks();
      mockAuth.getProfile.mockResolvedValue({
        id: 'user-123',
        email: 'user@example.com',
        createdAt: now,
        updatedAt: now,
      });
      mockChat.sendMessage.mockResolvedValue({
        content: 'Saw the image',
        conversation: { id: 'conv-img', title: 'Image', created_at: now },
      });

      const { result } = renderHook(() => useChat());

      await act(async () => {
        result.current.setInput('');
        result.current.setImages([
          { id: 'img-1', url: 'http://example.com/img.png', downloadUrl: 'http://cdn/img.png' },
        ]);
      });

      await act(async () => {
        await result.current.sendMessage();
      });

      expect(mockChat.sendMessage).toHaveBeenCalledTimes(1);
      const payload = mockChat.sendMessage.mock.calls[0][0];
      const userContent = payload.messages[0].content;
      expect(Array.isArray(userContent)).toBe(true);
      expect(userContent).toContainEqual({
        type: 'image_url',
        image_url: { url: 'http://cdn/img.png' },
      });
    });

    test('sendMessage sends with file only (empty text)', async () => {
      const now = new Date().toISOString();
      arrangeHttpMocks();
      mockAuth.getProfile.mockResolvedValue({
        id: 'user-123',
        email: 'user@example.com',
        createdAt: now,
        updatedAt: now,
      });
      mockChat.sendMessage.mockResolvedValue({
        content: 'Got the file',
        conversation: { id: 'conv-file', title: 'File', created_at: now },
      });

      const { result } = renderHook(() => useChat());

      await act(async () => {
        result.current.setInput('');
        result.current.setFiles([{ id: 'file-1', name: 'code.ts', content: 'const x = 1;' }]);
      });

      await act(async () => {
        await result.current.sendMessage();
      });

      expect(mockChat.sendMessage).toHaveBeenCalledTimes(1);
      const payload = mockChat.sendMessage.mock.calls[0][0];
      expect(payload.messages[0].content).toContain('File: code.ts');
      expect(payload.messages[0].content).toContain('const x = 1;');
    });

    test('sendMessage sends with audio only (empty text)', async () => {
      const now = new Date().toISOString();
      arrangeHttpMocks();
      mockAuth.getProfile.mockResolvedValue({
        id: 'user-123',
        email: 'user@example.com',
        createdAt: now,
        updatedAt: now,
      });
      mockChat.sendMessage.mockResolvedValue({
        content: 'Heard the audio',
        conversation: { id: 'conv-audio', title: 'Audio', created_at: now },
      });

      const { result } = renderHook(() => useChat());

      // Create a fake File object for the audio
      const audioFile = new File(['audio-data'], 'recording.mp3', { type: 'audio/mp3' });

      await act(async () => {
        result.current.setInput('');
        result.current.setAudios([
          {
            id: 'audio-1',
            url: 'blob:audio',
            name: 'recording.mp3',
            mimeType: 'audio/mp3',
            file: audioFile,
          },
        ]);
      });

      await act(async () => {
        await result.current.sendMessage();
      });

      expect(mockChat.sendMessage).toHaveBeenCalledTimes(1);
      const payload = mockChat.sendMessage.mock.calls[0][0];
      const userContent = payload.messages[0].content;
      expect(Array.isArray(userContent)).toBe(true);
      expect(userContent.some((c: any) => c.type === 'input_audio')).toBe(true);
    });

    test('sendMessage sends with text + image combined', async () => {
      const now = new Date().toISOString();
      arrangeHttpMocks();
      mockAuth.getProfile.mockResolvedValue({
        id: 'user-123',
        email: 'user@example.com',
        createdAt: now,
        updatedAt: now,
      });
      mockChat.sendMessage.mockResolvedValue({
        content: 'Multimodal response',
        conversation: { id: 'conv-multi', title: 'Multi', created_at: now },
      });

      const { result } = renderHook(() => useChat());

      await act(async () => {
        result.current.setInput('What is this?');
        result.current.setImages([
          { id: 'img-1', url: 'http://x.com/i.png', downloadUrl: 'http://cdn/i.png' },
        ]);
      });

      await act(async () => {
        await result.current.sendMessage();
      });

      const payload = mockChat.sendMessage.mock.calls[0][0];
      const userContent = payload.messages[0].content;
      expect(Array.isArray(userContent)).toBe(true);
      expect(userContent[0]).toMatchObject({ type: 'text', text: 'What is this?' });
      expect(userContent[1]).toMatchObject({
        type: 'image_url',
        image_url: { url: 'http://cdn/i.png' },
      });
    });

    test('sendMessage clears input and attachments after send', async () => {
      const now = new Date().toISOString();
      arrangeHttpMocks();
      mockAuth.getProfile.mockResolvedValue({
        id: 'user-123',
        email: 'user@example.com',
        createdAt: now,
        updatedAt: now,
      });
      mockChat.sendMessage.mockResolvedValue({
        content: 'Done',
        conversation: { id: 'conv-clear', title: 'Clear', created_at: now },
      });

      const { result } = renderHook(() => useChat());

      await act(async () => {
        result.current.setInput('Test');
        result.current.setImages([{ id: 'img-1', url: 'http://x.com/i.png' }]);
        result.current.setFiles([{ id: 'file-1', name: 'f.txt', content: 'x' }]);
      });

      expect(result.current.input).toBe('Test');
      expect(result.current.images).toHaveLength(1);
      expect(result.current.files).toHaveLength(1);

      await act(async () => {
        await result.current.sendMessage();
      });

      expect(result.current.input).toBe('');
      expect(result.current.images).toHaveLength(0);
      expect(result.current.files).toHaveLength(0);
    });
  });

  describe('2. Send Pipeline Failure Recovery', () => {
    test('sendMessage resets status to idle on API error', async () => {
      arrangeHttpMocks();
      mockAuth.getProfile.mockResolvedValue({
        id: 'user-123',
        email: 'user@example.com',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      // formatUpstreamError returns error.message when body has no upstream/message
      mockChat.sendMessage.mockRejectedValue(new APIError(500, 'Server error', null));

      const { result } = renderHook(() => useChat());

      await act(async () => {
        result.current.setInput('Hello');
      });

      await act(async () => {
        await result.current.sendMessage();
      });

      expect(result.current.status).toBe('idle');
      expect(result.current.pending.streaming).toBe(false);
      // APIError without body.upstream/body.message falls back to error.message
      expect(result.current.error).toBe('Server error');
    });

    test('sendMessage resets status when streaming error occurs', async () => {
      arrangeHttpMocks();
      mockAuth.getProfile.mockResolvedValue({
        id: 'user-123',
        email: 'user@example.com',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      mockChat.sendMessage.mockRejectedValue(new Error('Stream closed unexpectedly'));

      const { result } = renderHook(() => useChat());

      await act(async () => {
        await result.current.sendMessage('Test message');
      });

      expect(result.current.status).toBe('idle');
      expect(result.current.pending.streaming).toBe(false);
      expect(result.current.error).toBe('Stream closed unexpectedly');
    });

    test('sendMessage handles AbortError gracefully', async () => {
      arrangeHttpMocks();
      mockAuth.getProfile.mockResolvedValue({
        id: 'user-123',
        email: 'user@example.com',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const abortError = new Error('aborted');
      abortError.name = 'AbortError';
      mockChat.sendMessage.mockRejectedValue(abortError);

      const { result } = renderHook(() => useChat());

      await act(async () => {
        await result.current.sendMessage('Cancel me');
      });

      expect(result.current.status).toBe('idle');
      expect(result.current.pending.streaming).toBe(false);
      expect(result.current.error).toBe('Message cancelled');
    });

    test('sendMessage sets status to streaming during execution', async () => {
      arrangeHttpMocks();
      mockAuth.getProfile.mockResolvedValue({
        id: 'user-123',
        email: 'user@example.com',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      let resolvePromise: (value: any) => void;
      const pendingPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      mockChat.sendMessage.mockReturnValue(pendingPromise);

      const { result } = renderHook(() => useChat());

      let sendPromise: Promise<void>;
      act(() => {
        sendPromise = result.current.sendMessage('Streaming message');
      });

      await waitFor(() => {
        expect(result.current.status).toBe('streaming');
        expect(result.current.pending.streaming).toBe(true);
      });

      await act(async () => {
        resolvePromise!({
          content: 'Done',
          conversation: { id: 'conv-1', title: 'Test', created_at: new Date().toISOString() },
        });
        await sendPromise!;
      });

      expect(result.current.status).toBe('idle');
      expect(result.current.pending.streaming).toBe(false);
    });

    test('pending.abort controller is set during streaming and cleared after', async () => {
      arrangeHttpMocks();
      mockAuth.getProfile.mockResolvedValue({
        id: 'user-123',
        email: 'user@example.com',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      let resolvePromise: (value: any) => void;
      const pendingPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      mockChat.sendMessage.mockReturnValue(pendingPromise);

      const { result } = renderHook(() => useChat());

      let sendPromise: Promise<void>;
      act(() => {
        sendPromise = result.current.sendMessage('Test');
      });

      await waitFor(() => {
        expect(result.current.pending.abort).not.toBeNull();
        expect(result.current.pending.abort).toBeInstanceOf(AbortController);
      });

      await act(async () => {
        resolvePromise!({
          content: 'Done',
          conversation: { id: 'conv-1', title: 'Test', created_at: new Date().toISOString() },
        });
        await sendPromise!;
      });

      expect(result.current.pending.abort).toBeNull();
    });

    test('stopStreaming aborts and resets state without stuck streaming', async () => {
      arrangeHttpMocks();
      mockAuth.getProfile.mockResolvedValue({
        id: 'user-123',
        email: 'user@example.com',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

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

      const { result } = renderHook(() => useChat());

      let sendPromise: Promise<void>;
      act(() => {
        sendPromise = result.current.sendMessage('Long running');
      });

      await waitFor(() => expect(capturedSignal).toBeDefined());
      expect(result.current.status).toBe('streaming');

      await act(async () => {
        result.current.stopStreaming();
        await sendPromise!;
      });

      expect(capturedSignal?.aborted).toBe(true);
      expect(result.current.status).toBe('idle');
      expect(result.current.pending.streaming).toBe(false);
    });
  });

  describe('3. Compare-Mode Send/Retry Behavior', () => {
    test('sendMessage executes primary and comparison models in parallel when conversationId exists', async () => {
      const now = new Date().toISOString();
      arrangeHttpMocks();
      mockAuth.getProfile.mockResolvedValue({
        id: 'user-123',
        email: 'user@example.com',
        createdAt: now,
        updatedAt: now,
      });

      mockConversations.create.mockResolvedValue({
        id: 'conv-primary',
        title: 'Primary',
        created_at: now,
      });

      const callOrder: string[] = [];
      mockChat.sendMessage.mockImplementation(async (options: ChatOptionsExtended) => {
        callOrder.push(options.model);
        return {
          content: `reply-${options.model}`,
          conversation: {
            id: `conv-${options.model}`,
            title: `Title ${options.model}`,
            created_at: now,
          },
        };
      });

      const { result } = renderHook(() => useChat());

      await waitFor(() => expect(result.current.providerId).toBe('openai'));

      act(() => {
        result.current.setModel('openai::gpt-4o');
        result.current.setCompareModels(['openai::gpt-4o-mini']);
        result.current.setInput('Compare');
      });

      await act(async () => {
        await result.current.sendMessage();
      });

      expect(mockChat.sendMessage).toHaveBeenCalledTimes(2);
      expect(callOrder).toContain('gpt-4o');
      expect(callOrder).toContain('gpt-4o-mini');
    });

    test('sendMessage stores comparison results in comparisonResults', async () => {
      const now = new Date().toISOString();
      arrangeHttpMocks();
      mockAuth.getProfile.mockResolvedValue({
        id: 'user-123',
        email: 'user@example.com',
        createdAt: now,
        updatedAt: now,
      });

      mockConversations.create.mockResolvedValue({
        id: 'conv-primary',
        title: 'Primary',
        created_at: now,
      });

      mockChat.sendMessage.mockImplementation(async (options: ChatOptionsExtended) => {
        return {
          content: `reply-${options.model}`,
          conversation: {
            id: `conv-${options.model}`,
            title: `Title ${options.model}`,
            created_at: now,
            assistant_message_id: `msg-${options.model}`,
          },
        };
      });

      const { result } = renderHook(() => useChat());

      await waitFor(() => expect(result.current.providerId).toBe('openai'));

      act(() => {
        result.current.setModel('openai::gpt-4o');
        result.current.setCompareModels(['openai::gpt-4o-mini']);
        result.current.setInput('Compare');
      });

      await act(async () => {
        await result.current.sendMessage();
      });

      const assistantMsg = result.current.messages.find((m) => m.role === 'assistant');
      expect(assistantMsg?.comparisonResults?.['openai::gpt-4o-mini']).toMatchObject({
        content: 'reply-gpt-4o-mini',
        status: 'complete',
      });
    });

    test('comparison model error does not break primary model response', async () => {
      const now = new Date().toISOString();
      arrangeHttpMocks();
      mockAuth.getProfile.mockResolvedValue({
        id: 'user-123',
        email: 'user@example.com',
        createdAt: now,
        updatedAt: now,
      });

      mockConversations.create.mockResolvedValue({
        id: 'conv-primary',
        title: 'Primary',
        created_at: now,
      });

      mockChat.sendMessage.mockImplementation(async (options: ChatOptionsExtended) => {
        if (options.model === 'gpt-4o-mini') {
          throw new Error('Comparison model failed');
        }
        return {
          content: 'Primary response',
          conversation: { id: 'conv-primary', title: 'Primary', created_at: now },
        };
      });

      const { result } = renderHook(() => useChat());

      await waitFor(() => expect(result.current.providerId).toBe('openai'));

      act(() => {
        result.current.setModel('openai::gpt-4o');
        result.current.setCompareModels(['openai::gpt-4o-mini']);
        result.current.setInput('Compare');
      });

      await act(async () => {
        await result.current.sendMessage();
      });

      const assistantMsg = result.current.messages.find((m) => m.role === 'assistant');
      expect(assistantMsg?.content).toBe('Primary response');
      expect(assistantMsg?.comparisonResults?.['openai::gpt-4o-mini']?.status).toBe('error');
      expect(assistantMsg?.comparisonResults?.['openai::gpt-4o-mini']?.error).toBe(
        'Comparison model failed'
      );
    });

    test('retryComparisonModel retries single comparison model', async () => {
      const now = new Date().toISOString();
      arrangeHttpMocks();
      mockAuth.getProfile.mockResolvedValue({
        id: 'user-123',
        email: 'user@example.com',
        createdAt: now,
        updatedAt: now,
      });

      mockConversations.get.mockResolvedValue({
        id: 'conv-retry',
        title: 'Retry',
        model: 'gpt-4o',
        provider: 'openai',
        created_at: now,
        messages: [
          {
            id: 'user-1',
            seq: 1,
            role: 'user',
            content: 'Question',
            created_at: now,
            status: 'completed',
          },
          {
            id: 'assistant-1',
            seq: 2,
            role: 'assistant',
            content: 'Answer',
            created_at: now,
            status: 'completed',
          },
        ],
        linked_conversations: [
          {
            id: 'conv-mini',
            model: 'gpt-4o-mini',
            provider_id: 'openai',
            created_at: now,
            messages: [
              {
                id: 'assistant-mini',
                seq: 2,
                role: 'assistant',
                content: 'Mini answer',
                created_at: now,
                status: 'completed',
              },
            ],
          },
        ],
        next_after_seq: null,
      });

      const { result } = renderHook(() => useChat());

      await act(async () => {
        await result.current.selectConversation('conv-retry');
      });

      mockChat.sendMessage.mockResolvedValue({
        content: 'Retried mini answer',
        conversation: { id: 'conv-mini', title: 'Mini', created_at: now },
      });

      await act(async () => {
        await result.current.retryComparisonModel('assistant-1', 'openai::gpt-4o-mini');
      });

      expect(mockChat.sendMessage).toHaveBeenCalledTimes(1);
      expect(mockChat.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-4o-mini',
          conversationId: 'conv-mini',
        })
      );
    });

    test('retryComparisonModel can retry primary model', async () => {
      const now = new Date().toISOString();
      arrangeHttpMocks();
      mockAuth.getProfile.mockResolvedValue({
        id: 'user-123',
        email: 'user@example.com',
        createdAt: now,
        updatedAt: now,
      });

      mockConversations.get.mockResolvedValue({
        id: 'conv-retry-primary',
        title: 'Retry Primary',
        model: 'gpt-4o',
        provider: 'openai',
        created_at: now,
        messages: [
          {
            id: 'user-1',
            seq: 1,
            role: 'user',
            content: 'Question',
            created_at: now,
            status: 'completed',
          },
          {
            id: 'assistant-1',
            seq: 2,
            role: 'assistant',
            content: 'Old answer',
            created_at: now,
            status: 'completed',
          },
        ],
        next_after_seq: null,
      });

      const { result } = renderHook(() => useChat());

      await act(async () => {
        await result.current.selectConversation('conv-retry-primary');
      });

      mockChat.sendMessage.mockResolvedValue({
        content: 'New primary answer',
        conversation: { id: 'conv-retry-primary', title: 'Primary', created_at: now },
      });

      await act(async () => {
        await result.current.retryComparisonModel('assistant-1', 'primary');
      });

      expect(mockChat.sendMessage).toHaveBeenCalledTimes(1);
      expect(mockChat.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-4o',
          conversationId: 'conv-retry-primary',
        })
      );
    });
  });

  describe('4. selectConversation Hydration and Linked Conversation Mapping', () => {
    test('selectConversation loads and maps linked conversations', async () => {
      const now = new Date().toISOString();
      arrangeHttpMocks();
      mockAuth.getProfile.mockResolvedValue({
        id: 'user-123',
        email: 'user@example.com',
        createdAt: now,
        updatedAt: now,
      });

      mockConversations.get.mockResolvedValue({
        id: 'conv-linked',
        title: 'Linked',
        model: 'gpt-4o',
        provider: 'openai',
        created_at: now,
        messages: [
          {
            id: 'user-1',
            seq: 1,
            role: 'user',
            content: 'Question',
            created_at: now,
            status: 'completed',
          },
          {
            id: 'assistant-1',
            seq: 2,
            role: 'assistant',
            content: 'Primary',
            created_at: now,
            status: 'completed',
          },
        ],
        linked_conversations: [
          {
            id: 'conv-mini',
            model: 'gpt-4o-mini',
            provider_id: 'openai',
            created_at: now,
            messages: [
              {
                id: 'assistant-mini',
                seq: 2,
                role: 'assistant',
                content: 'Mini response',
                created_at: now,
                status: 'completed',
              },
            ],
          },
          {
            id: 'conv-claude',
            model: 'claude-3-opus',
            provider_id: 'anthropic',
            created_at: now,
            messages: [
              {
                id: 'assistant-claude',
                seq: 2,
                role: 'assistant',
                content: 'Claude response',
                created_at: now,
                status: 'completed',
              },
            ],
          },
        ],
        next_after_seq: null,
      });

      const { result } = renderHook(() => useChat());

      await act(async () => {
        await result.current.selectConversation('conv-linked');
      });

      expect(result.current.linkedConversations).toEqual({
        'openai::gpt-4o-mini': 'conv-mini',
        'anthropic::claude-3-opus': 'conv-claude',
      });

      expect(result.current.compareModels).toEqual(
        expect.arrayContaining(['openai::gpt-4o-mini', 'anthropic::claude-3-opus'])
      );
    });

    test('selectConversation populates comparisonResults from linked messages', async () => {
      const now = new Date().toISOString();
      arrangeHttpMocks();
      mockAuth.getProfile.mockResolvedValue({
        id: 'user-123',
        email: 'user@example.com',
        createdAt: now,
        updatedAt: now,
      });

      mockConversations.get.mockResolvedValue({
        id: 'conv-results',
        title: 'Results',
        model: 'gpt-4o',
        provider: 'openai',
        created_at: now,
        messages: [
          {
            id: 'user-1',
            seq: 1,
            role: 'user',
            content: 'Q',
            created_at: now,
            status: 'completed',
          },
          {
            id: 'assistant-1',
            seq: 2,
            role: 'assistant',
            content: 'Primary answer',
            created_at: now,
            status: 'completed',
            usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
            tool_calls: [
              { id: 'tc-1', type: 'function', function: { name: 'search', arguments: '{}' } },
            ],
          },
        ],
        linked_conversations: [
          {
            id: 'conv-mini',
            model: 'gpt-4o-mini',
            provider_id: 'openai',
            created_at: now,
            messages: [
              {
                id: 'assistant-mini',
                seq: 2,
                role: 'assistant',
                content: 'Mini answer',
                created_at: now,
                status: 'completed',
                usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
              },
            ],
          },
        ],
        next_after_seq: null,
      });

      const { result } = renderHook(() => useChat());

      await act(async () => {
        await result.current.selectConversation('conv-results');
      });

      const assistantMsg = result.current.messages.find((m) => m.role === 'assistant');
      expect(assistantMsg?.comparisonResults?.['openai::gpt-4o-mini']).toMatchObject({
        messageId: 'assistant-mini',
        content: 'Mini answer',
        status: 'complete',
        usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
      });
    });

    test('selectConversation hydrates all conversation settings', async () => {
      const now = new Date().toISOString();
      arrangeHttpMocks();
      mockAuth.getProfile.mockResolvedValue({
        id: 'user-123',
        email: 'user@example.com',
        createdAt: now,
        updatedAt: now,
      });

      mockConversations.get.mockResolvedValue({
        id: 'conv-settings',
        title: 'Settings Test',
        model: 'gpt-4o',
        provider: 'openai',
        created_at: now,
        messages: [],
        tools_enabled: true,
        streaming_enabled: false,
        active_tools: ['search', 'calculate'],
        system_prompt: 'You are a helpful assistant',
        active_system_prompt_id: 'prompt-abc',
        reasoning_effort: 'high',
        custom_request_params_id: ['param-1', 'param-2'],
        next_after_seq: null,
      });

      const { result } = renderHook(() => useChat());

      await act(async () => {
        await result.current.selectConversation('conv-settings');
      });

      expect(result.current.useTools).toBe(true);
      expect(result.current.shouldStream).toBe(false);
      expect(result.current.enabledTools).toEqual(['search', 'calculate']);
      expect(result.current.systemPrompt).toBe('You are a helpful assistant');
      expect(result.current.activeSystemPromptId).toBe('prompt-abc');
      expect(result.current.reasoningEffort).toBe('high');
      expect(result.current.customRequestParamsId).toEqual(['param-1', 'param-2']);
    });

    test('selectConversation clears linked conversations when none exist', async () => {
      const now = new Date().toISOString();
      arrangeHttpMocks();
      mockAuth.getProfile.mockResolvedValue({
        id: 'user-123',
        email: 'user@example.com',
        createdAt: now,
        updatedAt: now,
      });

      // First load a conversation with linked conversations
      mockConversations.get.mockResolvedValueOnce({
        id: 'conv-with-linked',
        title: 'With Linked',
        model: 'gpt-4o',
        provider: 'openai',
        created_at: now,
        messages: [
          {
            id: 'a-1',
            seq: 1,
            role: 'assistant',
            content: 'X',
            created_at: now,
            status: 'completed',
          },
        ],
        linked_conversations: [
          {
            id: 'conv-mini',
            model: 'gpt-4o-mini',
            provider_id: 'openai',
            created_at: now,
            messages: [],
          },
        ],
        next_after_seq: null,
      });

      // Then load a conversation without linked conversations
      mockConversations.get.mockResolvedValueOnce({
        id: 'conv-no-linked',
        title: 'No Linked',
        model: 'gpt-4o',
        provider: 'openai',
        created_at: now,
        messages: [],
        linked_conversations: [],
        next_after_seq: null,
      });

      const { result } = renderHook(() => useChat());

      await act(async () => {
        await result.current.selectConversation('conv-with-linked');
      });

      expect(Object.keys(result.current.linkedConversations).length).toBeGreaterThan(0);

      await act(async () => {
        await result.current.selectConversation('conv-no-linked');
      });

      expect(result.current.linkedConversations).toEqual({});
      expect(result.current.compareModels).toEqual([]);
    });

    test('selectConversation normalizes model names with provider prefix', async () => {
      const now = new Date().toISOString();
      arrangeHttpMocks();
      mockAuth.getProfile.mockResolvedValue({
        id: 'user-123',
        email: 'user@example.com',
        createdAt: now,
        updatedAt: now,
      });

      mockConversations.get.mockResolvedValue({
        id: 'conv-normalize',
        title: 'Normalize',
        model: 'gpt-4o', // No provider prefix
        provider: 'openai',
        created_at: now,
        messages: [],
        next_after_seq: null,
      });

      const { result } = renderHook(() => useChat());

      await waitFor(() => expect(result.current.modelOptions.length).toBeGreaterThan(0));

      await act(async () => {
        await result.current.selectConversation('conv-normalize');
      });

      expect(result.current.model).toBe('openai::gpt-4o');
      expect(result.current.providerId).toBe('openai');
    });

    test('selectConversation sets error on fetch failure', async () => {
      arrangeHttpMocks();
      mockAuth.getProfile.mockResolvedValue({
        id: 'user-123',
        email: 'user@example.com',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      mockConversations.get.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useChat());

      await act(async () => {
        await result.current.selectConversation('conv-fail');
      });

      expect(result.current.error).toBe('Network error');
    });

    test('selectConversation loads evaluations from conversation data', async () => {
      const now = new Date().toISOString();
      arrangeHttpMocks();
      mockAuth.getProfile.mockResolvedValue({
        id: 'user-123',
        email: 'user@example.com',
        createdAt: now,
        updatedAt: now,
      });

      mockConversations.get.mockResolvedValue({
        id: 'conv-eval',
        title: 'Evaluations',
        model: 'gpt-4o',
        provider: 'openai',
        created_at: now,
        messages: [],
        evaluations: [
          {
            id: 'eval-1',
            judge_model_id: 'gpt-4o',
            score_a: 8,
            score_b: 6,
            winner: 'model_a',
            reasoning: 'Model A was better',
          },
        ],
        next_after_seq: null,
      });

      const { result } = renderHook(() => useChat());

      await act(async () => {
        await result.current.selectConversation('conv-eval');
      });

      expect(result.current.evaluations).toHaveLength(1);
      expect(result.current.evaluations[0]).toMatchObject({
        id: 'eval-1',
        judge_model_id: 'gpt-4o',
        score_a: 8,
        score_b: 6,
      });
    });
  });
});
