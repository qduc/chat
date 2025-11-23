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

type ConversationsApi = (typeof import('../lib/api'))['conversations'];
type ChatApi = (typeof import('../lib/api'))['chat'];
type ToolsApi = (typeof import('../lib/api'))['tools'];
type ProvidersApi = (typeof import('../lib/api'))['providers'];
type AuthApi = (typeof import('../lib/api'))['auth'];
type HttpClient = (typeof import('../lib/http'))['httpClient'];

jest.mock('../lib/api', () => {
  const actual = jest.requireActual('../lib/api');
  const mockConversations = {
    create: jest.fn(),
    list: jest.fn(),
    get: jest.fn(),
    delete: jest.fn(),
    clearListCache: jest.fn(),
    editMessage: jest.fn(),
    migrateFromSession: jest.fn(),
  } as unknown as jest.Mocked<ConversationsApi>;
  const mockChat = {
    sendMessage: jest.fn(),
  } as unknown as jest.Mocked<ChatApi>;
  const mockTools = {
    getToolSpecs: jest.fn(),
  } as unknown as jest.Mocked<ToolsApi>;
  const mockProviders = {
    getDefaultProviderId: jest.fn(),
    clearCache: jest.fn(),
  } as unknown as jest.Mocked<ProvidersApi>;
  const mockAuth = {
    register: jest.fn(),
    login: jest.fn(),
    logout: jest.fn(),
    getProfile: jest.fn(),
    verifySession: jest.fn(() => Promise.resolve({ valid: true, user: null, reason: null } as any)),
  } as unknown as jest.Mocked<AuthApi>;
  return {
    ...actual,
    conversations: mockConversations,
    chat: mockChat,
    tools: mockTools,
    providers: mockProviders,
    auth: mockAuth,
  };
});

jest.mock('../lib/http', () => {
  const actual = jest.requireActual('../lib/http');
  const httpClientMock = {
    request: jest.fn(),
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
    setRefreshTokenFn: jest.fn(),
  } as unknown as jest.Mocked<HttpClient>;
  return {
    ...actual,
    httpClient: httpClientMock,
  };
});

// Use the mocked objects from jest.mock
const mockConversations = jest.requireMock('../lib/api').conversations;
const mockChat = jest.requireMock('../lib/api').chat;
const mockTools = jest.requireMock('../lib/api').tools;
const mockAuth = jest.requireMock('../lib/api').auth;
const mockHttpClient = jest.requireMock('../lib/http').httpClient;

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

// Mock localStorage with key-aware behavior
const mockLocalStorage = {
  getItem: jest.fn(() => null),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
} as unknown as Storage & {
  getItem: jest.Mock;
  setItem: jest.Mock;
  removeItem: jest.Mock;
  clear: jest.Mock;
};
Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
});

function renderWithProviders(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

async function waitForLeftSidebar() {
  const conversationButton = await screen.findByRole('button', { name: 'Test Conversation' });
  const sidebar = conversationButton.closest('aside');
  if (!sidebar) {
    throw new Error('Unable to locate left sidebar element');
  }
  return sidebar as HTMLElement;
}

function setupHttpClient() {
  mockHttpClient.get.mockImplementation((url: string) => {
    if (url === '/v1/providers') {
      return Promise.resolve({
        data: {
          providers: [
            { id: 'openai', name: 'OpenAI', enabled: 1, updated_at: new Date().toISOString() },
            { id: 'disabled', name: 'Disabled', enabled: 0, updated_at: new Date().toISOString() },
          ],
        },
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
      });
    }

    if (url === '/v1/providers/openai/models') {
      return Promise.resolve({
        data: {
          provider: { id: 'openai' },
          models: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }],
        },
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
      });
    }

    return Promise.resolve({
      data: { provider: { id: 'unknown' }, models: [] },
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
    });
  });
}

beforeEach(() => {
  jest.clearAllMocks();

  mockConversations.list.mockResolvedValue({
    items: [
      { id: 'conv-1', title: 'Test Conversation', model: 'gpt-4o', created_at: '2023-01-01' },
    ],
    next_cursor: null,
  });
  mockChat.sendMessage.mockResolvedValue({
    content: 'Mock response',
    responseId: 'mock-response-id',
  });
  mockTools.getToolSpecs.mockResolvedValue({ tools: [], available_tools: [] } as any);
  mockConversations.get.mockResolvedValue({
    id: 'mock-conv-id',
    title: 'Mock Conversation',
    model: 'test-model',
    created_at: new Date().toISOString(),
    messages: [],
    next_after_seq: null,
  } as any);
  mockAuth.getProfile.mockResolvedValue({
    id: 'test-user',
    email: 'test@example.com',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as any);
  setupHttpClient();

  // Mock localStorage to return false (expanded by default)
  mockLocalStorage.getItem.mockImplementation(() => null);
});

describe('Sidebar Collapse Functionality', () => {
  // Provide a minimal matchMedia mock for JSDOM used in tests
  beforeAll(() => {
    if (typeof window.matchMedia !== 'function') {
      // @ts-expect-error: Mocking window.matchMedia for test environment where it may not be defined
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

    const leftSidebar = await waitForLeftSidebar();
    expect(
      within(leftSidebar).getByRole('button', { name: 'Test Conversation' })
    ).toBeInTheDocument();
    expect(within(leftSidebar).getByTitle('Collapse sidebar')).toBeInTheDocument();
  });

  test('sidebar can be collapsed and expanded', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Chat />);

    const leftSidebar = await waitForLeftSidebar();
    const collapseButton = within(leftSidebar).getByTitle('Collapse sidebar');
    await user.click(collapseButton);

    await waitFor(() => {
      expect(within(leftSidebar).queryByTitle('Collapse sidebar')).not.toBeInTheDocument();
      expect(within(leftSidebar).getByTitle('Expand sidebar')).toBeInTheDocument();
    });

    const expandButton = within(leftSidebar).getByTitle('Expand sidebar');
    await user.click(expandButton);

    await waitFor(() => {
      expect(within(leftSidebar).getByTitle('Collapse sidebar')).toBeInTheDocument();
    });
  });

  test('sidebar state is saved to localStorage', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Chat />);

    const leftSidebar = await waitForLeftSidebar();
    const collapseButton = within(leftSidebar).getByTitle('Collapse sidebar');
    await user.click(collapseButton);

    // Verify localStorage.setItem was called with 'true'
    expect(mockLocalStorage.setItem).toHaveBeenCalledWith('sidebarCollapsed', 'true');

    // Click expand button
    const expandButton = within(leftSidebar).getByTitle('Expand sidebar');
    await user.click(expandButton);

    // Verify localStorage.setItem was called with 'false'
    expect(mockLocalStorage.setItem).toHaveBeenCalledWith('sidebarCollapsed', 'false');
  });

  test('sidebar loads collapsed state from localStorage', async () => {
    // Mock localStorage to return 'true' (collapsed) only for the sidebar key
    mockLocalStorage.getItem.mockImplementation((key: string) =>
      key === 'sidebarCollapsed' ? 'true' : null
    );

    renderWithProviders(<Chat />);

    await waitFor(() => {
      expect(screen.getByLabelText('Start new chat')).toBeInTheDocument();
      expect(screen.getAllByTitle('Expand sidebar').length).toBeGreaterThanOrEqual(1);
    });
  });

  test('keyboard shortcut Ctrl+\\ toggles sidebar', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Chat />);

    const leftSidebar = await waitForLeftSidebar();

    // Press Ctrl+\ to collapse
    await user.keyboard('{Control>}\\{/Control}');

    await waitFor(() => {
      expect(within(leftSidebar).queryByTitle('Collapse sidebar')).not.toBeInTheDocument();
    });

    // Press Ctrl+\ again to expand
    await user.keyboard('{Control>}\\{/Control}');

    await waitFor(() => {
      expect(within(leftSidebar).getByTitle('Collapse sidebar')).toBeInTheDocument();
    });
  });

  test('collapsed sidebar shows minimal UI with new chat and refresh buttons', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Chat />);

    const leftSidebar = await waitForLeftSidebar();
    const collapseButton = within(leftSidebar).getByTitle('Collapse sidebar');
    await user.click(collapseButton);

    await waitFor(() => {
      // Should show minimal buttons specific to collapsed state
      expect(screen.getByLabelText('Start new chat')).toBeInTheDocument();
      expect(screen.getByLabelText('Refresh conversation list')).toBeInTheDocument();
    });
  });

  test('collapsed sidebar shows conversation count', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Chat />);

    const leftSidebar = await waitForLeftSidebar();
    const collapseButton = within(leftSidebar).getByTitle('Collapse sidebar');
    await user.click(collapseButton);

    await waitFor(() => {
      // Should show conversation count (1 conversation from our mock)
      expect(screen.getByTitle('1 conversation')).toBeInTheDocument();
    });
  });
});

export {};
