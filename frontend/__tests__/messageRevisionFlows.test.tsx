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

import { act, renderHook, waitFor } from '@testing-library/react';
import { useChat } from '../hooks/useChat';
import { processNonStreamingData, processStreamChunk } from '../lib/api/streaming-handler';

jest.mock('../lib/api', () => ({
  conversations: {
    list: jest.fn(),
    get: jest.fn(),
    getBranches: jest.fn(),
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

import { auth, chat, conversations } from '../lib/api';
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

function renderUseChat() {
  mockConversations.list.mockResolvedValue({ items: [], next_cursor: null });
  mockConversations.getBranches.mockResolvedValue({ active_branch_id: null, branches: [] } as any);
  mockHttpClient.get.mockImplementation((url: string) => {
    if (url.startsWith('/v1/models')) {
      return Promise.resolve(
        createHttpResponse({
          providers: [
            {
              provider: { id: 'openai', name: 'OpenAI', provider_type: 'openai' },
              models: [{ id: 'gpt-4o' }],
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

  mockAuth.getProfile.mockResolvedValue({
    id: 'user-123',
    email: 'user@example.com',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  return renderHook(() => useChat());
}

describe('message revision flows', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
  });

  test('regenerate applies server revision metadata to the new assistant message', async () => {
    const now = new Date().toISOString();
    mockChat.sendMessage.mockResolvedValue({
      content: 'regenerated',
      conversation: {
        id: 'conv-regenerate',
        title: 'Regenerated',
        created_at: now,
        user_message_id: 1,
        assistant_message_id: 'assistant-2',
        regenerate_anchor_message_id: 'user-1',
        regenerate_revision_count: 3,
      },
    });
    const { result } = renderUseChat();

    mockConversations.getBranches.mockResolvedValue({
      active_branch_id: 'regen-branch-1',
      branches: [
        {
          id: 'root',
          conversation_id: 'conv-regenerate',
          parent_branch_id: null,
          branch_point_message_id: null,
          source_message_id: null,
          operation_type: 'root',
          label: 'Main',
          head_message_id: 1,
          created_at: now,
          updated_at: now,
          archived_at: null,
          is_active: false,
        },
        {
          id: 'regen-branch-1',
          conversation_id: 'conv-regenerate',
          parent_branch_id: 'root',
          branch_point_message_id: 1,
          source_message_id: 1,
          operation_type: 'regenerate',
          label: null,
          head_message_id: 2,
          created_at: now,
          updated_at: now,
          archived_at: null,
          is_active: true,
        },
      ],
    } as any);

    await waitFor(() => expect(result.current.modelOptions.length).toBeGreaterThan(0));

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
    expect(result.current.messages[0]).toMatchObject({
      id: 'user-1',
      _dbId: 1,
    });
    expect(result.current.messages[2]).toMatchObject({
      id: 'assistant-2',
      _parentMessageId: 1,
      branch_id: 'regen-branch-1',
      regenerate_revision_count: 3,
      anchor_user_message_id: 'user-1',
    });
    await waitFor(() => {
      expect(result.current.activeBranchId).toBe('regen-branch-1');
      expect(result.current.branches).toHaveLength(2);
    });
  });

  test('saveEdit uses the server edit revision count instead of local increments', async () => {
    const now = new Date().toISOString();
    mockConversations.get.mockResolvedValue({
      id: 'conv-edit',
      title: 'Editable',
      model: 'gpt-4o',
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
      ],
      next_after_seq: null,
    } as any);
    mockConversations.editMessage.mockResolvedValue({
      message: { id: 'msg-1', seq: 1, content: 'Updated' },
      new_conversation_id: 'conv-edit',
      edit_revision_count: 4,
    });

    const { result } = renderUseChat();

    await act(async () => {
      await result.current.selectConversation('conv-edit');
    });

    act(() => {
      result.current.startEdit('msg-1', 'Original');
      result.current.updateEditContent('Updated');
    });

    await act(async () => {
      await result.current.saveEdit();
    });

    expect(result.current.conversationId).toBe('conv-edit');
    expect(result.current.messages[0]).toMatchObject({
      id: 'msg-1',
      content: 'Updated',
      edit_revision_count: 4,
    });
  });

  test('streaming handler preserves regenerate metadata in conversation payloads', () => {
    const nonStreaming = processNonStreamingData({
      _conversation: {
        id: 'conv-1',
        title: 'Conversation',
        model: 'gpt-4o',
        created_at: '2024-01-01T00:00:00Z',
        assistant_message_id: 'assistant-2',
        regenerate_anchor_message_id: 'user-1',
        regenerate_revision_count: 2,
      },
    });

    expect(nonStreaming.conversation).toMatchObject({
      assistant_message_id: 'assistant-2',
      regenerate_anchor_message_id: 'user-1',
      regenerate_revision_count: 2,
    });

    const streamChunk = processStreamChunk({
      _conversation: {
        id: 'conv-1',
        title: 'Conversation',
        model: 'gpt-4o',
        created_at: '2024-01-01T00:00:00Z',
        assistant_message_id: 'assistant-2',
        regenerate_anchor_message_id: 'user-1',
        regenerate_revision_count: 2,
      },
    });

    expect(streamChunk.conversation).toMatchObject({
      assistant_message_id: 'assistant-2',
      regenerate_anchor_message_id: 'user-1',
      regenerate_revision_count: 2,
    });
  });

  test('non-streaming normalization emits singular message_event callbacks and returns message_events', () => {
    const events: any[] = [];

    const nonStreaming = processNonStreamingData(
      {
        choices: [
          {
            message: {
              content: 'Final answer',
              reasoning: 'Need to reason first',
            },
          },
        ],
      },
      undefined,
      (event) => events.push(event)
    );

    expect(nonStreaming.content).toBe('Final answer');
    expect(nonStreaming.message_events).toEqual([
      { seq: 1, type: 'reasoning', payload: { text: 'Need to reason first' } },
      { seq: 2, type: 'content', payload: { text: 'Final answer' } },
    ]);
    expect(events.filter((event) => event.type === 'message_event')).toEqual([
      {
        type: 'message_event',
        value: { seq: 1, type: 'reasoning', payload: { text: 'Need to reason first' } },
      },
      {
        type: 'message_event',
        value: { seq: 2, type: 'content', payload: { text: 'Final answer' } },
      },
    ]);
  });
});
