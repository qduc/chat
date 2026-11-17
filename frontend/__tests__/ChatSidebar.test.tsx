import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ChatSidebar } from '../components/ChatSidebar';

test('deletes a conversation only after confirmation', () => {
  const onDeleteConversation = jest.fn();
  const confirm = jest
    .spyOn(window, 'confirm')
    .mockReturnValueOnce(false)
    .mockReturnValueOnce(true);
  render(
    <ChatSidebar
      conversations={[{ id: 'one', title: 'Disposable', created_at: '2026-01-01' } as any]}
      nextCursor={null}
      loadingConversations={false}
      conversationId={null}
      collapsed={false}
      onSelectConversation={jest.fn()}
      onDeleteConversation={onDeleteConversation}
      onLoadMore={jest.fn()}
      onRefresh={jest.fn()}
      onNewChat={jest.fn()}
      onToggleCollapse={jest.fn()}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Delete conversation' }));
  expect(confirm).toHaveBeenCalledWith('Delete "Disposable"?');
  expect(onDeleteConversation).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Delete conversation' }));
  expect(onDeleteConversation).toHaveBeenCalledWith('one');
  confirm.mockRestore();
});
