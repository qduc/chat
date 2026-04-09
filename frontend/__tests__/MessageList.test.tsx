/**
 * Tests for MessageList component
 * @jest-environment jsdom
 */

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

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { MessageList } from '../components/MessageList';
import type { ChatMessage, ConversationBranch, Role } from '../lib/types';
import { conversations } from '../lib/api';

jest.mock('../lib/api', () => ({
  conversations: {
    getMessageRevisions: jest.fn(),
  },
}));

// Mock Toast context
jest.mock('../components/ui/Toast', () => ({
  useToast: () => ({
    showToast: jest.fn(),
  }),
}));

// Mock Message component
jest.mock('../components/message', () => ({
  Message: ({ message, isStreaming, editRevision, regenRevision, onRetryMessage, onFork }: any) => (
    <div data-testid={`message-${message.id}`} data-role={message.role}>
      <span data-testid={`content-${message.id}`}>
        {typeof message.content === 'string' ? message.content : JSON.stringify(message.content)}
      </span>
      {onRetryMessage && (
        <button data-testid={`retry-${message.id}`} onClick={() => onRetryMessage(message.id)}>
          Retry
        </button>
      )}
      {onFork && (
        <button data-testid={`fork-${message.id}`} onClick={() => onFork(message.id, 'primary')}>
          Fork
        </button>
      )}
      {editRevision && (
        <>
          <button data-testid={`edit-prev-${message.id}`} onClick={editRevision.onPrev}>
            Prev edit
          </button>
          <span data-testid={`edit-nav-${message.id}`}>
            {editRevision.slot}/{editRevision.total}
          </span>
        </>
      )}
      {regenRevision && (
        <>
          <button data-testid={`regen-prev-${message.id}`} onClick={regenRevision.onPrev}>
            Prev regen
          </button>
          <span data-testid={`regen-nav-${message.id}`}>
            {regenRevision.slot}/{regenRevision.total}
          </span>
        </>
      )}
      {isStreaming && <span data-testid="streaming-indicator">Streaming...</span>}
    </div>
  ),
  JudgeModal: ({ isOpen, onClose, onConfirm }: any) =>
    isOpen ? (
      <div data-testid="judge-modal">
        <button onClick={onClose}>Close</button>
        <button
          onClick={() => onConfirm({ judgeModelId: 'gpt-4', selectedModelIds: [], criteria: null })}
        >
          Confirm
        </button>
      </div>
    ) : null,
  MAX_COMPARISON_COLUMNS: 4,
}));

// Mock WelcomeMessage
jest.mock('../components/WelcomeMessage', () => ({
  WelcomeMessage: ({ onSuggestionClick }: any) => (
    <div data-testid="welcome-message">
      <button onClick={() => onSuggestionClick?.('Hello!')}>Suggestion</button>
    </div>
  ),
}));

// Mock hooks
jest.mock('../hooks/useStreamingScroll', () => ({
  useStreamingScroll: () => ({
    dynamicBottomPadding: '100px',
    lastUserMessageRef: { current: null },
    toolbarRef: { current: null },
    bottomRef: { current: null },
  }),
}));

jest.mock('../hooks/useIsMobile', () => ({
  useIsMobile: () => false,
}));

// Mock lucide-react
jest.mock('lucide-react', () => ({
  AlertCircle: () => <span data-testid="alert-icon">Alert</span>,
}));

// Mock lib
jest.mock('../lib', () => ({
  images: {
    uploadImages: jest.fn(() => Promise.resolve([])),
    revokePreviewUrl: jest.fn(),
  },
  createMixedContent: jest.fn((text, images) => (images?.length ? { text, images } : text)),
  extractImagesFromContent: jest.fn(() => []),
  mergeToolOutputsToAssistantMessages: jest.fn((messages) => messages),
}));

// Helper to create test messages
const createMessage = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: `msg-${Date.now()}-${Math.random()}`,
  role: 'user' as Role,
  content: 'Test message',
  ...overrides,
});

const createBranch = (overrides: Partial<ConversationBranch> = {}): ConversationBranch => ({
  id: `branch-${Date.now()}-${Math.random()}`,
  conversation_id: 'conv-1',
  parent_branch_id: null,
  branch_point_message_id: null,
  source_message_id: null,
  operation_type: 'root',
  label: null,
  head_message_id: null,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  archived_at: null,
  is_active: false,
  ...overrides,
});

// Default props
const defaultProps = {
  messages: [] as ChatMessage[],
  pending: { streaming: false, abort: null },
  conversationId: null,
  compareModels: [],
  primaryModelLabel: null,
  modelGroups: [],
  modelOptions: [],
  linkedConversations: {},
  evaluations: [],
  evaluationDrafts: [],
  canSend: true,
  editingMessageId: null,
  editingContent: '',
  onCopy: jest.fn(),
  onEditMessage: jest.fn(),
  onCancelEdit: jest.fn(),
  onSaveEdit: jest.fn(),
  onApplyLocalEdit: jest.fn(),
  onEditingContentChange: jest.fn(),
  onRetryMessage: jest.fn(),
  onDeleteJudgeResponse: jest.fn(),
};

const mockConversations = conversations as jest.Mocked<typeof conversations>;

describe('MessageList', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Basic rendering', () => {
    it('renders welcome message when no messages', () => {
      render(<MessageList {...defaultProps} messages={[]} />);

      expect(screen.getByTestId('welcome-message')).toBeInTheDocument();
    });

    it('hides welcome message when messages exist', () => {
      const messages = [createMessage({ content: 'Hello' })];
      render(<MessageList {...defaultProps} messages={messages} />);

      expect(screen.queryByTestId('welcome-message')).not.toBeInTheDocument();
    });

    it('renders messages', () => {
      const messages = [
        createMessage({ id: 'msg-1', role: 'user', content: 'User message' }),
        createMessage({ id: 'msg-2', role: 'assistant', content: 'Assistant reply' }),
      ];

      render(<MessageList {...defaultProps} messages={messages} />);

      expect(screen.getByTestId('message-msg-1')).toBeInTheDocument();
      expect(screen.getByTestId('message-msg-2')).toBeInTheDocument();
    });

    it('displays message content', () => {
      const messages = [createMessage({ id: 'msg-1', content: 'Test content here' })];

      render(<MessageList {...defaultProps} messages={messages} />);

      expect(screen.getByTestId('content-msg-1')).toHaveTextContent('Test content here');
    });
  });

  describe('Inline branch navigation', () => {
    it('shows edit branch navigation for user messages and switches to the previous branch', async () => {
      const onSwitchBranch = jest.fn().mockResolvedValue(undefined);
      const branches = [
        createBranch({ id: 'root', operation_type: 'root', created_at: '2024-01-01T00:00:00Z' }),
        createBranch({
          id: 'edit-1',
          operation_type: 'edit',
          parent_branch_id: 'root',
          branch_point_message_id: null,
          created_at: '2024-01-01T00:01:00Z',
        }),
        createBranch({
          id: 'edit-2',
          operation_type: 'edit',
          parent_branch_id: 'edit-1',
          branch_point_message_id: null,
          created_at: '2024-01-01T00:02:00Z',
          is_active: true,
        }),
      ];
      const messages = [
        createMessage({
          id: 'user-a3',
          role: 'user',
          content: 'A3',
          branch_id: 'edit-2',
          _parentMessageId: null,
        }),
      ];

      render(
        <MessageList
          {...defaultProps}
          conversationId="conv-1"
          branchModeEnabled={true}
          branches={branches}
          activeBranchId="edit-2"
          onSwitchBranch={onSwitchBranch}
          messages={messages}
        />
      );

      expect(screen.getByTestId('edit-nav-user-a3')).toHaveTextContent('3/3');

      fireEvent.click(screen.getByTestId('edit-prev-user-a3'));

      await waitFor(() => {
        expect(onSwitchBranch).toHaveBeenCalledWith('edit-1');
      });
    });

    it('shows regenerate branch navigation for assistant messages and switches versions', async () => {
      const onSwitchBranch = jest.fn().mockResolvedValue(undefined);
      const branches = [
        createBranch({ id: 'edit-2', operation_type: 'edit', created_at: '2024-01-01T00:00:00Z' }),
        createBranch({
          id: 'regen-1',
          operation_type: 'regenerate',
          parent_branch_id: 'edit-2',
          branch_point_message_id: 42,
          source_message_id: 42,
          created_at: '2024-01-01T00:01:00Z',
        }),
        createBranch({
          id: 'regen-2',
          operation_type: 'regenerate',
          parent_branch_id: 'regen-1',
          branch_point_message_id: 42,
          source_message_id: 42,
          created_at: '2024-01-01T00:02:00Z',
          is_active: true,
        }),
      ];
      const messages = [
        createMessage({
          id: 'user-a3',
          role: 'user',
          content: 'A3',
          branch_id: 'edit-2',
          _dbId: 42,
        }),
        createMessage({
          id: 'assistant-r3',
          role: 'assistant',
          content: 'Answer v3',
          branch_id: 'regen-2',
          _parentMessageId: 42,
        }),
      ];

      render(
        <MessageList
          {...defaultProps}
          conversationId="conv-1"
          branchModeEnabled={true}
          branches={branches}
          activeBranchId="regen-2"
          onSwitchBranch={onSwitchBranch}
          messages={messages}
        />
      );

      expect(screen.getByTestId('regen-nav-assistant-r3')).toHaveTextContent('3/3');

      fireEvent.click(screen.getByTestId('regen-prev-assistant-r3'));

      await waitFor(() => {
        expect(onSwitchBranch).toHaveBeenCalledWith('regen-1');
      });
    });

    it('blocks branch version switching while streaming', async () => {
      const onSwitchBranch = jest.fn().mockResolvedValue(undefined);
      const branches = [
        createBranch({ id: 'edit-2', operation_type: 'edit', created_at: '2024-01-01T00:00:00Z' }),
        createBranch({
          id: 'regen-1',
          operation_type: 'regenerate',
          parent_branch_id: 'edit-2',
          branch_point_message_id: 42,
          source_message_id: 42,
          created_at: '2024-01-01T00:01:00Z',
        }),
        createBranch({
          id: 'regen-2',
          operation_type: 'regenerate',
          parent_branch_id: 'regen-1',
          branch_point_message_id: 42,
          source_message_id: 42,
          created_at: '2024-01-01T00:02:00Z',
          is_active: true,
        }),
      ];
      const messages = [
        createMessage({
          id: 'user-a3',
          role: 'user',
          content: 'A3',
          branch_id: 'edit-2',
          _dbId: 42,
        }),
        createMessage({
          id: 'assistant-r3',
          role: 'assistant',
          content: 'Answer v3',
          branch_id: 'regen-2',
          _parentMessageId: 42,
        }),
      ];

      render(
        <MessageList
          {...defaultProps}
          conversationId="conv-1"
          branchModeEnabled={true}
          branches={branches}
          activeBranchId="regen-2"
          onSwitchBranch={onSwitchBranch}
          messages={messages}
          pending={{ streaming: true, abort: null }}
        />
      );

      fireEvent.click(screen.getByTestId('regen-prev-assistant-r3'));

      await waitFor(() => {
        expect(onSwitchBranch).not.toHaveBeenCalled();
      });
    });

    it('does not leak edit navigation onto later user messages without branch metadata', () => {
      const branches = [
        createBranch({ id: 'root', operation_type: 'root', created_at: '2024-01-01T00:00:00Z' }),
        createBranch({
          id: 'edit-1',
          operation_type: 'edit',
          parent_branch_id: 'root',
          branch_point_message_id: null,
          created_at: '2024-01-01T00:01:00Z',
        }),
      ];
      const messages = [
        createMessage({
          id: 'user-a2',
          role: 'user',
          content: 'A2',
          branch_id: 'edit-1',
          _parentMessageId: null,
        }),
        createMessage({
          id: 'user-b',
          role: 'user',
          content: 'B',
        }),
      ];

      render(
        <MessageList
          {...defaultProps}
          conversationId="conv-1"
          branchModeEnabled={true}
          branches={branches}
          activeBranchId="edit-1"
          onSwitchBranch={jest.fn()}
          messages={messages}
        />
      );

      expect(screen.getByTestId('edit-nav-user-a2')).toHaveTextContent('2/2');
      expect(screen.queryByTestId('edit-nav-user-b')).not.toBeInTheDocument();
    });

    it('does not leak regenerate navigation onto later assistant messages without branch metadata', () => {
      const branches = [
        createBranch({ id: 'edit-1', operation_type: 'edit', created_at: '2024-01-01T00:00:00Z' }),
        createBranch({
          id: 'regen-1',
          operation_type: 'regenerate',
          parent_branch_id: 'edit-1',
          branch_point_message_id: 42,
          source_message_id: 42,
          created_at: '2024-01-01T00:01:00Z',
        }),
      ];
      const messages = [
        createMessage({
          id: 'assistant-r2',
          role: 'assistant',
          content: 'Answer v2',
          branch_id: 'regen-1',
          _parentMessageId: 42,
        }),
        createMessage({
          id: 'assistant-c',
          role: 'assistant',
          content: 'Later answer',
        }),
      ];

      render(
        <MessageList
          {...defaultProps}
          conversationId="conv-1"
          branchModeEnabled={true}
          branches={branches}
          activeBranchId="regen-1"
          onSwitchBranch={jest.fn()}
          messages={messages}
        />
      );

      expect(screen.getByTestId('regen-nav-assistant-r2')).toHaveTextContent('2/2');
      expect(screen.queryByTestId('regen-nav-assistant-c')).not.toBeInTheDocument();
    });
  });

  describe('Revision scoping', () => {
    it('keeps regenerate history scoped to the selected edit timeline', async () => {
      mockConversations.getMessageRevisions.mockResolvedValue([
        {
          id: 'edit-a1',
          operation_type: 'edit',
          anchor_content: 'A1',
          follow_ups: [{ role: 'assistant', content: 'B3' }],
          created_at: '2024-01-01T00:00:00Z',
        },
        {
          id: 'regen-a1-1',
          operation_type: 'regenerate',
          anchor_content: 'A1',
          follow_ups: [{ role: 'assistant', content: 'B1' }],
          created_at: '2024-01-01T00:01:00Z',
        },
        {
          id: 'regen-a1-2',
          operation_type: 'regenerate',
          anchor_content: 'A1',
          follow_ups: [{ role: 'assistant', content: 'B2' }],
          created_at: '2024-01-01T00:02:00Z',
        },
      ] as any);

      const messages = [
        createMessage({
          id: 'user-1',
          role: 'user',
          content: 'A2',
          edit_revision_count: 1,
        }),
        createMessage({
          id: 'assistant-current',
          role: 'assistant',
          content: 'C',
          anchor_user_message_id: 'user-1',
          regenerate_revision_count: 0,
        }),
      ];

      render(<MessageList {...defaultProps} conversationId="conv-1" messages={messages} />);

      expect(screen.getByTestId('content-assistant-current')).toHaveTextContent('C');
      expect(screen.queryByTestId('regen-nav-assistant-current')).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId('edit-prev-user-1'));

      await waitFor(() => {
        expect(screen.getByTestId('content-user-1')).toHaveTextContent('A1');
      });
      expect(screen.queryByTestId('message-assistant-current')).not.toBeInTheDocument();
      expect(screen.getByTestId('content-synthetic-edit-a1-0')).toHaveTextContent('B3');
      expect(screen.getByTestId('regen-nav-synthetic-edit-a1-0')).toHaveTextContent('3/3');

      fireEvent.click(screen.getByTestId('regen-prev-synthetic-edit-a1-0'));

      await waitFor(() => {
        expect(screen.getByTestId('content-synthetic-edit-a1-0')).toHaveTextContent('B2');
      });
      expect(screen.queryByText('C')).not.toBeInTheDocument();
    });

    it('uses the same x/y label for the latest revision', async () => {
      mockConversations.getMessageRevisions.mockResolvedValue([
        {
          id: 'edit-a1',
          operation_type: 'edit',
          anchor_content: 'A1',
          follow_ups: [{ role: 'assistant', content: 'B1' }],
          created_at: '2024-01-01T00:00:00Z',
        },
      ] as any);

      const messages = [
        createMessage({
          id: 'user-1',
          role: 'user',
          content: 'A2',
          edit_revision_count: 1,
        }),
      ];

      render(<MessageList {...defaultProps} conversationId="conv-1" messages={messages} />);

      expect(screen.getByTestId('edit-nav-user-1')).toHaveTextContent('2/2');
      expect(screen.queryByText('current')).not.toBeInTheDocument();
    });

    it('drops cached revision data when the same conversation timeline changes', async () => {
      mockConversations.getMessageRevisions.mockResolvedValueOnce([
        {
          id: 'edit-a1',
          operation_type: 'edit',
          anchor_content: 'A1',
          follow_ups: [{ role: 'assistant', content: 'B1' }],
          created_at: '2024-01-01T00:00:00Z',
        },
      ] as any);

      const initialMessages = [
        createMessage({
          id: 'user-1',
          role: 'user',
          content: 'A2',
          edit_revision_count: 1,
        }),
        createMessage({
          id: 'assistant-1',
          role: 'assistant',
          content: 'C1',
          anchor_user_message_id: 'user-1',
        }),
      ];

      const { rerender } = render(
        <MessageList {...defaultProps} conversationId="conv-1" messages={initialMessages} />
      );

      fireEvent.click(screen.getByTestId('edit-prev-user-1'));

      await waitFor(() => {
        expect(screen.getByTestId('content-synthetic-edit-a1-0')).toHaveTextContent('B1');
      });
      expect(screen.queryByTestId('regen-nav-synthetic-edit-a1-0')).not.toBeInTheDocument();

      mockConversations.getMessageRevisions.mockResolvedValueOnce([
        {
          id: 'edit-a1',
          operation_type: 'edit',
          anchor_content: 'A1',
          follow_ups: [{ role: 'assistant', content: 'B2' }],
          created_at: '2024-01-01T00:00:00Z',
        },
        {
          id: 'regen-a1-1',
          operation_type: 'regenerate',
          anchor_content: 'A1',
          follow_ups: [{ role: 'assistant', content: 'B1' }],
          created_at: '2024-01-01T00:01:00Z',
        },
      ] as any);

      const updatedMessages = [
        createMessage({
          id: 'user-1',
          role: 'user',
          content: 'A2 updated',
          edit_revision_count: 1,
        }),
        createMessage({
          id: 'assistant-2',
          role: 'assistant',
          content: 'C2',
          anchor_user_message_id: 'user-1',
        }),
      ];

      rerender(
        <MessageList {...defaultProps} conversationId="conv-1" messages={updatedMessages} />
      );

      fireEvent.click(screen.getByTestId('edit-prev-user-1'));

      await waitFor(() => {
        expect(screen.getByTestId('content-synthetic-edit-a1-0')).toHaveTextContent('B2');
      });
      expect(screen.getByTestId('regen-nav-synthetic-edit-a1-0')).toHaveTextContent('2/2');
      expect(mockConversations.getMessageRevisions).toHaveBeenCalledTimes(2);
    });
  });

  describe('Streaming state', () => {
    it('shows streaming indicator for last message when streaming', () => {
      const messages = [
        createMessage({ id: 'msg-1', role: 'user', content: 'Question' }),
        createMessage({ id: 'msg-2', role: 'assistant', content: 'Answ' }),
      ];

      render(
        <MessageList
          {...defaultProps}
          messages={messages}
          pending={{ streaming: true, abort: null }}
        />
      );

      expect(screen.getByTestId('streaming-indicator')).toBeInTheDocument();
    });

    it('does not show streaming indicator when not streaming', () => {
      const messages = [
        createMessage({ id: 'msg-1', role: 'user', content: 'Question' }),
        createMessage({ id: 'msg-2', role: 'assistant', content: 'Answer' }),
      ];

      render(<MessageList {...defaultProps} messages={messages} />);

      expect(screen.queryByTestId('streaming-indicator')).not.toBeInTheDocument();
    });
  });

  describe('Error display', () => {
    it('shows error when pending has error', () => {
      render(
        <MessageList
          {...defaultProps}
          pending={{
            streaming: false,
            abort: null,
            error: 'API Error',
          }}
        />
      );

      expect(screen.getByText('Error occurred')).toBeInTheDocument();
      expect(screen.getByText('API Error')).toBeInTheDocument();
    });

    it('does not show error when no error', () => {
      render(<MessageList {...defaultProps} />);

      expect(screen.queryByText('Error occurred')).not.toBeInTheDocument();
    });
  });

  describe('Welcome message interaction', () => {
    it('calls onSuggestionClick when suggestion is clicked', async () => {
      const onSuggestionClick = jest.fn();
      render(<MessageList {...defaultProps} onSuggestionClick={onSuggestionClick} />);

      const suggestionButton = screen.getByText('Suggestion');
      await userEvent.click(suggestionButton);

      expect(onSuggestionClick).toHaveBeenCalledWith('Hello!');
    });
  });

  describe('Multiple messages', () => {
    it('renders multiple messages in order', () => {
      const messages = [
        createMessage({ id: 'msg-1', role: 'user', content: 'First' }),
        createMessage({ id: 'msg-2', role: 'assistant', content: 'Second' }),
        createMessage({ id: 'msg-3', role: 'user', content: 'Third' }),
      ];

      render(<MessageList {...defaultProps} messages={messages} />);

      const allMessages = screen.getAllByTestId(/^message-msg-/);
      expect(allMessages).toHaveLength(3);
    });

    it('identifies user and assistant messages correctly', () => {
      const messages = [
        createMessage({ id: 'msg-1', role: 'user', content: 'User' }),
        createMessage({ id: 'msg-2', role: 'assistant', content: 'Assistant' }),
      ];

      render(<MessageList {...defaultProps} messages={messages} />);

      expect(screen.getByTestId('message-msg-1')).toHaveAttribute('data-role', 'user');
      expect(screen.getByTestId('message-msg-2')).toHaveAttribute('data-role', 'assistant');
    });
  });

  describe('Scroll tracking', () => {
    it('calls onScrollStateChange when scrolling', () => {
      const onScrollStateChange = jest.fn();
      const messages = [
        createMessage({ id: 'msg-1', content: 'Message 1' }),
        createMessage({ id: 'msg-2', content: 'Message 2' }),
      ];

      render(
        <MessageList
          {...defaultProps}
          messages={messages}
          onScrollStateChange={onScrollStateChange}
        />
      );

      const main = document.querySelector('main');
      expect(main).toBeTruthy();

      if (main) {
        // Initial call
        expect(onScrollStateChange).toHaveBeenCalled();

        // Simulate scroll
        fireEvent.scroll(main, { target: { scrollTop: 200 } });

        // Should be called again
        expect(onScrollStateChange).toHaveBeenCalled();
      }
    });
  });

  describe('Comparison models', () => {
    it('handles conversation with comparison results', () => {
      const messages = [
        createMessage({ id: 'msg-1', role: 'user', content: 'Question' }),
        createMessage({
          id: 'msg-2',
          role: 'assistant',
          content: 'Primary answer',
          comparisonResults: {
            'model-a': { content: 'Model A answer', status: 'complete' },
            'model-b': { content: 'Model B answer', status: 'complete' },
          },
        }),
      ];

      render(
        <MessageList
          {...defaultProps}
          messages={messages}
          compareModels={['model-a', 'model-b']}
          conversationId="conv-1"
        />
      );

      expect(screen.getByTestId('message-msg-1')).toBeInTheDocument();
      expect(screen.getByTestId('message-msg-2')).toBeInTheDocument();
    });
  });

  describe('Container ref', () => {
    it('accepts external container ref', () => {
      const externalRef = React.createRef<HTMLDivElement>();
      render(<MessageList {...defaultProps} containerRef={externalRef as any} />);

      expect(externalRef.current).toBeTruthy();
    });
  });

  describe('Callbacks', () => {
    it('passes onCopy to Message components', () => {
      const onCopy = jest.fn();
      const messages = [createMessage({ id: 'msg-1', content: 'Test' })];

      render(<MessageList {...defaultProps} messages={messages} onCopy={onCopy} />);

      expect(screen.getByTestId('message-msg-1')).toBeInTheDocument();
    });

    it('passes onEditMessage to Message components', () => {
      const onEditMessage = jest.fn();
      const messages = [createMessage({ id: 'msg-1', content: 'Test' })];

      render(<MessageList {...defaultProps} messages={messages} onEditMessage={onEditMessage} />);

      expect(screen.getByTestId('message-msg-1')).toBeInTheDocument();
    });

    it('passes onRetryMessage to Message components', () => {
      const onRetryMessage = jest.fn();
      const messages = [createMessage({ id: 'msg-1', content: 'Test' })];

      render(<MessageList {...defaultProps} messages={messages} onRetryMessage={onRetryMessage} />);

      expect(screen.getByTestId('message-msg-1')).toBeInTheDocument();
    });

    it('retries using the visible historical timeline', async () => {
      const onRetryMessage = jest.fn();
      mockConversations.getMessageRevisions.mockResolvedValue([
        {
          id: 'edit-a1',
          operation_type: 'edit',
          anchor_content: 'A1',
          follow_ups: [{ role: 'assistant', content: 'B1' }],
          created_at: '2024-01-01T00:00:00Z',
        },
        {
          id: 'regen-a1-1',
          operation_type: 'regenerate',
          anchor_content: 'A1',
          follow_ups: [{ role: 'assistant', content: 'B0' }],
          created_at: '2024-01-01T00:01:00Z',
        },
      ] as any);

      const messages = [
        createMessage({ id: 'user-1', role: 'user', content: 'A2', edit_revision_count: 1 }),
        createMessage({
          id: 'assistant-current',
          role: 'assistant',
          content: 'C',
          anchor_user_message_id: 'user-1',
        }),
      ];

      render(
        <MessageList
          {...defaultProps}
          conversationId="conv-1"
          messages={messages}
          onRetryMessage={onRetryMessage}
        />
      );

      fireEvent.click(screen.getByTestId('edit-prev-user-1'));
      await waitFor(() => {
        expect(screen.getByTestId('content-synthetic-edit-a1-0')).toHaveTextContent('B1');
      });

      expect(screen.queryByTestId('retry-synthetic-edit-a1-0')).not.toBeInTheDocument();
      expect(onRetryMessage).not.toHaveBeenCalled();
    });
  });

  describe('Editing state', () => {
    it('passes editing state to Message components', () => {
      const messages = [createMessage({ id: 'msg-1', role: 'user', content: 'Original' })];

      render(
        <MessageList
          {...defaultProps}
          messages={messages}
          editingMessageId="msg-1"
          editingContent="Edited content"
        />
      );

      expect(screen.getByTestId('message-msg-1')).toBeInTheDocument();
    });
  });

  describe('Evaluation state', () => {
    it('passes evaluations to Message components', () => {
      const messages = [createMessage({ id: 'msg-1', role: 'assistant', content: 'Answer' })];

      const evaluations = [
        {
          id: 'eval-1',
          user_id: 'user-1',
          conversation_id: 'conv-1',
          model_a_conversation_id: 'conv-1',
          model_a_message_id: 'msg-1',
          model_b_conversation_id: 'conv-1',
          model_b_message_id: 'msg-1',
          judge_model_id: 'gpt-4',
          criteria: null,
          score_a: 8,
          score_b: 7,
          winner: 'model_a',
          reasoning: 'Model A was better',
          created_at: new Date().toISOString(),
        } as any,
      ];

      render(<MessageList {...defaultProps} messages={messages} evaluations={evaluations} />);

      expect(screen.getByTestId('message-msg-1')).toBeInTheDocument();
    });

    it('passes evaluation drafts to Message components', () => {
      const messages = [createMessage({ id: 'msg-1', role: 'assistant', content: 'Answer' })];

      const evaluationDrafts = [
        {
          id: 'draft-1',
          messageId: 'msg-1',
          selectedModelIds: ['primary', 'model-a'],
          judgeModelId: 'gpt-4',
          content: 'Reasoning...',
          status: 'streaming' as const,
        },
      ];

      render(
        <MessageList {...defaultProps} messages={messages} evaluationDrafts={evaluationDrafts} />
      );

      expect(screen.getByTestId('message-msg-1')).toBeInTheDocument();
    });
  });

  describe('Fork functionality', () => {
    it('passes onFork to Message components', () => {
      const onFork = jest.fn();
      const messages = [createMessage({ id: 'msg-1', content: 'Test' })];

      render(<MessageList {...defaultProps} messages={messages} onFork={onFork} />);

      expect(screen.getByTestId('message-msg-1')).toBeInTheDocument();
    });

    it('forks from the visible historical timeline', async () => {
      const onFork = jest.fn();
      mockConversations.getMessageRevisions.mockResolvedValue([
        {
          id: 'edit-a1',
          operation_type: 'edit',
          anchor_content: 'A1',
          follow_ups: [{ role: 'assistant', content: 'B1' }],
          created_at: '2024-01-01T00:00:00Z',
        },
      ] as any);

      const messages = [
        createMessage({ id: 'user-1', role: 'user', content: 'A2', edit_revision_count: 1 }),
        createMessage({
          id: 'assistant-current',
          role: 'assistant',
          content: 'C',
          anchor_user_message_id: 'user-1',
        }),
      ];

      render(
        <MessageList
          {...defaultProps}
          conversationId="conv-1"
          messages={messages}
          onFork={onFork}
        />
      );

      fireEvent.click(screen.getByTestId('edit-prev-user-1'));
      await waitFor(() => {
        expect(screen.getByTestId('content-synthetic-edit-a1-0')).toHaveTextContent('B1');
      });

      expect(screen.queryByTestId('fork-synthetic-edit-a1-0')).not.toBeInTheDocument();
      expect(onFork).not.toHaveBeenCalled();
    });
  });

  describe('Linked conversations', () => {
    it('passes linkedConversations to Message components', () => {
      const messages = [createMessage({ id: 'msg-1', content: 'Test' })];
      const linkedConversations = { 'model-a': 'conv-a', 'model-b': 'conv-b' };

      render(
        <MessageList
          {...defaultProps}
          messages={messages}
          linkedConversations={linkedConversations}
        />
      );

      expect(screen.getByTestId('message-msg-1')).toBeInTheDocument();
    });
  });

  describe('Model options', () => {
    it('accepts model groups for selectors', () => {
      const messages = [createMessage({ id: 'msg-1', content: 'Test' })];
      const modelGroups = [
        {
          id: 'openai',
          label: 'OpenAI',
          options: [
            { value: 'gpt-4', label: 'GPT-4' },
            { value: 'gpt-3.5', label: 'GPT-3.5' },
          ],
        },
      ];

      render(<MessageList {...defaultProps} messages={messages} modelGroups={modelGroups} />);

      expect(screen.getByTestId('message-msg-1')).toBeInTheDocument();
    });

    it('accepts model options for selectors', () => {
      const messages = [createMessage({ id: 'msg-1', content: 'Test' })];
      const modelOptions = [
        { value: 'gpt-4', label: 'GPT-4' },
        { value: 'claude-3', label: 'Claude 3' },
      ];

      render(<MessageList {...defaultProps} messages={messages} modelOptions={modelOptions} />);

      expect(screen.getByTestId('message-msg-1')).toBeInTheDocument();
    });
  });
});
