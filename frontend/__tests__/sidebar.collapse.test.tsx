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

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    stopMessage: jest.fn(),
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
  // Find the aside element which represents the sidebar using its aria-label
  const sidebar = await screen.findByRole('complementary', { name: 'Conversation history' });
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

    if (url.startsWith('/v1/models')) {
      return Promise.resolve({
        data: {
          providers: [
            {
              provider: { id: 'openai', name: 'OpenAI', provider_type: 'openai' },
              models: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }],
            },
          ],
          cached: false,
          cachedAt: new Date().toISOString(),
          errors: [],
        },
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
      });
    }

    if (url === '/v1/system-prompts') {
      return Promise.resolve({
        data: { system_prompts: [] },
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
      });
    }

    if (url === '/v1/user-settings') {
      return Promise.resolve({
        data: {},
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
      await within(leftSidebar).findByRole('button', { name: 'Test Conversation' })
    ).toBeInTheDocument();
    expect(
      within(leftSidebar).getByRole('button', { name: 'Collapse sidebar' })
    ).toBeInTheDocument();
  });

  test('sidebar can be collapsed and expanded', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Chat />);

    const leftSidebar = await waitForLeftSidebar();
    const collapseButton = within(leftSidebar).getByRole('button', { name: 'Collapse sidebar' });
    await user.click(collapseButton);

    await waitFor(() => {
      expect(
        within(leftSidebar).queryByRole('button', { name: 'Collapse sidebar' })
      ).not.toBeInTheDocument();
      expect(
        within(leftSidebar).getByRole('button', { name: 'Expand sidebar' })
      ).toBeInTheDocument();
    });

    const expandButton = within(leftSidebar).getByRole('button', { name: 'Expand sidebar' });
    await user.click(expandButton);

    await waitFor(() => {
      expect(
        within(leftSidebar).getByRole('button', { name: 'Collapse sidebar' })
      ).toBeInTheDocument();
    });
  });

  test('sidebar state is saved to localStorage', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Chat />);

    const leftSidebar = await waitForLeftSidebar();
    const collapseButton = within(leftSidebar).getByRole('button', { name: 'Collapse sidebar' });
    await user.click(collapseButton);

    // Verify localStorage.setItem was called with 'true'
    expect(mockLocalStorage.setItem).toHaveBeenCalledWith('sidebarCollapsed', 'true');

    // Click expand button
    const expandButton = within(leftSidebar).getByRole('button', { name: 'Expand sidebar' });
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

    const leftSidebar = await waitForLeftSidebar();
    await waitFor(() => {
      expect(within(leftSidebar).getByLabelText('Start new chat')).toBeInTheDocument();
      expect(
        within(leftSidebar).getByRole('button', { name: 'Expand sidebar' })
      ).toBeInTheDocument();
    });
  });

  test('keyboard shortcut Ctrl+\\ toggles sidebar', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Chat />);

    const leftSidebar = await waitForLeftSidebar();

    // Press Ctrl+\ to collapse
    await user.keyboard('{Control>}\\{/Control}');

    await waitFor(() => {
      expect(
        within(leftSidebar).queryByRole('button', { name: 'Collapse sidebar' })
      ).not.toBeInTheDocument();
    });

    // Press Ctrl+\ again to expand
    await user.keyboard('{Control>}\\{/Control}');

    await waitFor(() => {
      expect(
        within(leftSidebar).getByRole('button', { name: 'Collapse sidebar' })
      ).toBeInTheDocument();
    });
  });

  test('collapsed sidebar shows minimal UI with new chat and refresh buttons', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Chat />);

    const leftSidebar = await waitForLeftSidebar();
    const collapseButton = within(leftSidebar).getByRole('button', { name: 'Collapse sidebar' });
    await user.click(collapseButton);

    await waitFor(() => {
      // Should show minimal buttons specific to collapsed state
      expect(within(leftSidebar).getByLabelText('Start new chat')).toBeInTheDocument();
      expect(within(leftSidebar).getByLabelText('Refresh conversation list')).toBeInTheDocument();
    });
  });

  test('collapsed sidebar shows conversation count', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Chat />);

    const leftSidebar = await waitForLeftSidebar();
    const collapseButton = within(leftSidebar).getByRole('button', { name: 'Collapse sidebar' });
    await user.click(collapseButton);

    await waitFor(() => {
      // Should show conversation count (1 conversation from our mock)
      expect(within(leftSidebar).getByTitle('1 conversation')).toBeInTheDocument();
    });
  });

  test('clicking the sidebar edge collapses it, and the empty rail expands it', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Chat />);

    const leftSidebar = await waitForLeftSidebar();
    await user.click(within(leftSidebar).getByTestId('panel-edge'));
    await waitFor(() => {
      expect(
        within(leftSidebar).getByRole('button', { name: 'Expand sidebar' })
      ).toBeInTheDocument();
    });

    // Any empty part of the collapsed rail expands it again.
    await user.click(leftSidebar);
    await waitFor(() => {
      expect(
        within(leftSidebar).getByRole('button', { name: 'Collapse sidebar' })
      ).toBeInTheDocument();
    });

    // A click on a rail button does its own job, not the expand.
    await user.click(within(leftSidebar).getByRole('button', { name: 'Collapse sidebar' }));
    await user.click(await within(leftSidebar).findByLabelText('Refresh conversation list'));
    expect(within(leftSidebar).getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
  });

  test('chat details edge closes on click but not after a drag', async () => {
    // jsdom has no PointerEvent, so fireEvent.pointerDown would drop clientX.
    if (typeof window.PointerEvent === 'undefined') {
      // @ts-expect-error: minimal polyfill for jsdom
      window.PointerEvent = class extends MouseEvent {};
    }
    renderWithProviders(<Chat />);
    const leftSidebar = await waitForLeftSidebar();
    const toggle = screen.getByRole('button', { name: 'Chat details' });
    if (toggle.getAttribute('aria-pressed') !== 'true') fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-pressed', 'true'));

    const edge = screen.getAllByTestId('panel-edge').find((el) => !leftSidebar.contains(el))!;
    // A drag (resize) ends with a click event far from where it started: no toggle.
    fireEvent.pointerDown(edge, { button: 0, clientX: 900 });
    fireEvent.click(edge, { clientX: 820 });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');

    fireEvent.pointerDown(edge, { button: 0, clientX: 900 });
    fireEvent.click(edge, { clientX: 901 });
    await waitFor(() => expect(toggle).toHaveAttribute('aria-pressed', 'false'));
  });

  test('Ctrl+Shift+\\ toggles chat details even though Shift turns the key into |', async () => {
    renderWithProviders(<Chat />);
    await waitForLeftSidebar();
    const toggle = screen.getByRole('button', { name: 'Chat details' });
    const before = toggle.getAttribute('aria-pressed');

    fireEvent.keyDown(window, { key: '|', code: 'Backslash', ctrlKey: true, shiftKey: true });
    await waitFor(() =>
      expect(toggle).toHaveAttribute('aria-pressed', before === 'true' ? 'false' : 'true')
    );
  });
});

export {};
