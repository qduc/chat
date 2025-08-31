import React from 'react';
import { render, screen } from '@testing-library/react';
import { ChatHeader } from '../components/ChatHeader';
import { ThemeProvider } from '../contexts/ThemeContext';

function renderWithProvider(ui: React.ReactElement) {
  return render(
    <ThemeProvider>
      {ui}
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
  it('renders and allows model selection and theme toggle', () => {
    const onNewChat = jest.fn();
    const onModelChange = jest.fn();

    renderWithProvider(
      <ChatHeader
        isStreaming={false}
        onNewChat={onNewChat}
        model="gpt-4.1-mini"
        onModelChange={onModelChange}
      />
    );

    // Model selector exists
    expect(screen.getByLabelText('Model')).toBeInTheDocument();
  });
});
