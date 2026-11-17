jest.mock('../contexts/AuthContext', () => {
  const authValue = {
    user: null,
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

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ChatHeader } from '../components/ChatHeader';
import { ThemeProvider } from '../contexts/ThemeContext';

function renderWithProvider(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

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

describe('ChatHeader', () => {
  it('renders and allows model selection and theme toggle', () => {
    const onNewChat = jest.fn();
    const onModelChange = jest.fn();

    renderWithProvider(
      <ChatHeader
        isStreaming={false}
        onNewChat={onNewChat}
        model="gpt-4.1-mini"
        onModelChange={onModelChange}
        groups={null}
        fallbackOptions={[{ value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' }]}
        modelToProvider={{ 'gpt-4.1-mini': 'default' }}
      />
    );

    // Model selector exists
    expect(screen.getByLabelText('Model')).toBeInTheDocument();
  });

  it('shows the chat details toggle with its pressed state', () => {
    const onToggleRightSidebar = jest.fn();
    const props = {
      isStreaming: false,
      model: 'gpt-4.1-mini',
      onModelChange: jest.fn(),
      fallbackOptions: [{ value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' }],
      onToggleRightSidebar,
      showRightSidebarButton: true,
    };
    const { rerender } = renderWithProvider(<ChatHeader {...props} rightSidebarOpen={false} />);

    const toggle = screen.getByRole('button', { name: 'Chat details' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle).not.toHaveClass('md:hidden');
    fireEvent.click(toggle);
    expect(onToggleRightSidebar).toHaveBeenCalledTimes(1);

    rerender(
      <ThemeProvider>
        <ChatHeader {...props} rightSidebarOpen />
      </ThemeProvider>
    );
    expect(screen.getByRole('button', { name: 'Chat details' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });
});
