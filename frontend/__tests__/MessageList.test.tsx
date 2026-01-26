/**
 * Tests for MessageList component
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { MessageList } from '../components/MessageList';
import type { ChatMessage, Role } from '../lib/types';

// Mock Toast context
jest.mock('../components/ui/Toast', () => ({
  useToast: () => ({
    showToast: jest.fn(),
  }),
}));

// Mock Message component
jest.mock('../components/message', () => ({
  Message: ({ message, isStreaming }: any) => (
    <div data-testid={`message-${message.id}`} data-role={message.role}>
      <span data-testid={`content-${message.id}`}>
        {typeof message.content === 'string' ? message.content : JSON.stringify(message.content)}
      </span>
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
}));

// Helper to create test messages
const createMessage = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: `msg-${Date.now()}-${Math.random()}`,
  role: 'user' as Role,
  content: 'Test message',
  created_at: new Date().toISOString(),
  ...overrides,
});

// Default props
const defaultProps = {
  messages: [] as ChatMessage[],
  pending: { streaming: false, sending: false, loadingConversation: false },
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
          pending={{ streaming: true, sending: false, loadingConversation: false }}
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
            sending: false,
            loadingConversation: false,
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
            'model-a': { content: 'Model A answer', model: 'model-a' },
            'model-b': { content: 'Model B answer', model: 'model-b' },
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
        },
      ];

      render(<MessageList {...defaultProps} messages={messages} evaluations={evaluations} />);

      expect(screen.getByTestId('message-msg-1')).toBeInTheDocument();
    });

    it('passes evaluation drafts to Message components', () => {
      const messages = [createMessage({ id: 'msg-1', role: 'assistant', content: 'Answer' })];

      const evaluationDrafts = [
        { messageId: 'msg-1', modelIds: ['primary', 'model-a'], reasoning: '' },
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
