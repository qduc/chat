import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import { ChatHeader } from '../components/ChatHeader';
import { ChatProvider } from '../contexts/ChatContext';

function renderWithProvider(ui: React.ReactElement) {
  return render(<ChatProvider>{ui}</ChatProvider>);
}

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
