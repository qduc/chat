jest.mock('../contexts/AuthContext', () => {
  // Provide an authenticated user in tests so sidebar/history code paths run.
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

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatV2 as Chat } from '../components/ChatV2';
import { ThemeProvider } from '../contexts/ThemeContext';
import * as chatLib from '../lib';

// Mock the chat library functions
jest.mock('../lib/chat');
const mockedChatLib = chatLib as jest.Mocked<typeof chatLib>;

// The hook uses ConversationManager (class) internally. Ensure the mocked module
// returns a mocked ConversationManager whose `list` method resolves to the
// same conversations we expect in tests. This prevents the real ConversationManager
// from making HTTP calls and keeps the test deterministic.
mockedChatLib.ConversationManager = jest.fn().mockImplementation(() => ({
  list: jest.fn().mockResolvedValue({
    items: [
      { id: 'conv-1', title: 'Test Conversation', model: 'gpt-4o', created_at: '2023-01-01' },
    ],
    next_cursor: null,
  }),
  // include no-op placeholders for other instance methods used elsewhere
  create: jest.fn(),
  get: jest.fn(),
  delete: jest.fn(),
  editMessage: jest.fn(),
} as any)) as unknown as jest.MockedClass<typeof chatLib.ConversationManager>;

// Mock the Markdown component to avoid ES module issues
jest.mock('../components/Markdown', () => ({
  __esModule: true,
  default: ({ text }: { text: string }) => <div data-testid="markdown">{text}</div>,
}));

// Mock clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: jest.fn(),
  },
});

// Mock crypto.randomUUID
Object.defineProperty(global, 'crypto', {
  value: {
    randomUUID: jest.fn(() => 'mock-uuid-' + Math.random()),
  },
});

// Mock localStorage
const mockLocalStorage = {
  getItem: jest.fn(),
  setItem: jest.fn(),
};
Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
});

function renderWithProviders(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();

  // Setup chat functionality
  mockedChatLib.listConversationsApi.mockResolvedValue({
    items: [
      { id: 'conv-1', title: 'Test Conversation', model: 'gpt-4o', created_at: '2023-01-01' },
    ],
    next_cursor: null,
  });
  mockedChatLib.sendChat.mockResolvedValue({
    content: 'Mock response',
    responseId: 'mock-response-id'
  });
  mockedChatLib.getToolSpecs.mockResolvedValue({ tools: [], available_tools: [] });
  mockedChatLib.getConversationApi.mockResolvedValue({
    id: 'mock-conv-id',
    title: 'Mock Conversation',
    model: 'test-model',
    created_at: new Date().toISOString(),
    messages: [],
    next_after_seq: null,
  });

  // Mock localStorage to return false (expanded by default)
  mockLocalStorage.getItem.mockReturnValue(null);
});

describe('Sidebar Collapse Functionality', () => {
  // Provide a minimal matchMedia mock for JSDOM used in tests
  beforeAll(() => {
    if (typeof window.matchMedia !== 'function') {
      // @ts-ignore
      window.matchMedia = (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      });
    }
  });

  test('sidebar is expanded by default', async () => {
    renderWithProviders(<Chat />);

    await waitFor(() => {
      expect(screen.getByText('Chat History')).toBeInTheDocument();
      expect(screen.getByText('Test Conversation')).toBeInTheDocument();
    });
  });

  test('sidebar can be collapsed and expanded', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Chat />);

    await waitFor(() => {
      expect(screen.getByText('Chat History')).toBeInTheDocument();
    });

    // Find and click the collapse button
    const collapseButton = screen.getAllByTitle('Collapse sidebar')[0];
    expect(collapseButton).toBeInTheDocument();

    await user.click(collapseButton);

    // After collapsing, the "Chat History" text should not be visible
    await waitFor(() => {
      expect(screen.queryByText('Chat History')).not.toBeInTheDocument();
    });

    // Find and click the expand button
    const expandButton = screen.getByTitle('Expand sidebar');
    expect(expandButton).toBeInTheDocument();

    await user.click(expandButton);

    // After expanding, the "Chat History" text should be visible again
    await waitFor(() => {
      expect(screen.getByText('Chat History')).toBeInTheDocument();
    });
  });

  test('sidebar state is saved to localStorage', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Chat />);

    await waitFor(() => {
      expect(screen.getByText('Chat History')).toBeInTheDocument();
    });

    // Click collapse button
  const leftSidebar = screen.getByText('Chat History').closest('aside');
  expect(leftSidebar).not.toBeNull();
  const collapseButton = within(leftSidebar as HTMLElement).getByTitle('Collapse sidebar');
    await user.click(collapseButton);

    // Verify localStorage.setItem was called with 'true'
    expect(mockLocalStorage.setItem).toHaveBeenCalledWith('sidebarCollapsed', 'true');

    // Click expand button
    const expandButton = screen.getByTitle('Expand sidebar');
    await user.click(expandButton);

    // Verify localStorage.setItem was called with 'false'
    expect(mockLocalStorage.setItem).toHaveBeenCalledWith('sidebarCollapsed', 'false');
  });

  test('sidebar loads collapsed state from localStorage', async () => {
    // Mock localStorage to return 'true' (collapsed)
    mockLocalStorage.getItem.mockReturnValue('true');

    renderWithProviders(<Chat />);

    await waitFor(() => {
      // Should not show "Chat History" text when collapsed
      expect(screen.queryByText('Chat History')).not.toBeInTheDocument();
      // Should show expand button(s) - there may be left and right sidebars
      expect(screen.getAllByTitle('Expand sidebar').length).toBeGreaterThanOrEqual(1);
    });
  });

  test('keyboard shortcut Ctrl+\\ toggles sidebar', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Chat />);

    await waitFor(() => {
      expect(screen.getByText('Chat History')).toBeInTheDocument();
    });

    // Press Ctrl+\ to collapse
    await user.keyboard('{Control>}\\{/Control}');

    await waitFor(() => {
      expect(screen.queryByText('Chat History')).not.toBeInTheDocument();
    });

    // Press Ctrl+\ again to expand
    await user.keyboard('{Control>}\\{/Control}');

    await waitFor(() => {
      expect(screen.getByText('Chat History')).toBeInTheDocument();
    });
  });

  test('collapsed sidebar shows minimal UI with new chat and refresh buttons', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Chat />);

    await waitFor(() => {
      expect(screen.getByText('Chat History')).toBeInTheDocument();
    });

    // Collapse the sidebar
  const leftSidebar = screen.getByText('Chat History').closest('aside');
  expect(leftSidebar).not.toBeNull();
  const collapseButton = within(leftSidebar as HTMLElement).getByTitle('Collapse sidebar');
    await user.click(collapseButton);

    await waitFor(() => {
      // Should show minimal buttons
      expect(screen.getByTitle('New Chat')).toBeInTheDocument();
      expect(screen.getByTitle('Refresh conversations')).toBeInTheDocument();
      // Should not show full "Chat History" header
      expect(screen.queryByText('Chat History')).not.toBeInTheDocument();
    });
  });

  test('collapsed sidebar shows conversation count', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Chat />);

    await waitFor(() => {
      expect(screen.getByText('Chat History')).toBeInTheDocument();
    });

    // Collapse the sidebar
  const leftSidebar = screen.getByText('Chat History').closest('aside');
  expect(leftSidebar).not.toBeNull();
  const collapseButton = within(leftSidebar as HTMLElement).getByTitle('Collapse sidebar');
    await user.click(collapseButton);

    await waitFor(() => {
      // Should show conversation count (1 conversation from our mock)
      expect(screen.getByTitle('1 conversation')).toBeInTheDocument();
    });
  });
});

export {};
