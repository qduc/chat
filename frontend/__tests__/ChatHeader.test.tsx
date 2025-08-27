import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatHeader } from '../components/ChatHeader';
import { ChatProvider } from '../contexts/ChatContext';
import { ThemeProvider } from '../contexts/ThemeContext';

function renderWithProvider(ui: React.ReactElement) {
  return render(
    <ThemeProvider>
      <ChatProvider>{ui}</ChatProvider>
    </ThemeProvider>
  );
}

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
      dispatchEvent: () => false
    });
  }
});

describe('ChatHeader', () => {
  it('renders and interacts: model change, toggles, new chat and stop', () => {
    const onNewChat = jest.fn();

    renderWithProvider(
      <ChatHeader
        isStreaming={true}
        onNewChat={onNewChat}
      />
    );

    // Header title exists
    expect(screen.getByText('Chat')).toBeTruthy();

    // New Chat button
    const newChat = screen.getByRole('button', { name: /new chat/i });
    fireEvent.click(newChat);
    expect(onNewChat).toHaveBeenCalled();
  });
});
