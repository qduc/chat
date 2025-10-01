/**
 * @jest-environment jsdom
 */

import { renderHook } from '@testing-library/react';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

describe('useDocumentTitle', () => {
  const originalTitle = document.title;

  beforeEach(() => {
    document.title = originalTitle;
  });

  afterEach(() => {
    document.title = originalTitle;
  });

  it('should set default title when no active conversation', () => {
    renderHook(() =>
      useDocumentTitle({
        conversationId: null,
        currentConversationTitle: null,
        conversations: [],
        fallbackTitle: 'ChatForge'
      })
    );

    expect(document.title).toBe('ChatForge');
  });

  it('should set conversation title when active conversation exists', () => {
    const conversations = [
      { id: 'conv-1', title: 'My Test Conversation' },
      { id: 'conv-2', title: 'Another Chat' }
    ];

    renderHook(() =>
      useDocumentTitle({
        conversationId: 'conv-1',
        currentConversationTitle: 'My Test Conversation',
        conversations,
        fallbackTitle: 'ChatForge'
      })
    );

    expect(document.title).toBe('My Test Conversation - ChatForge');
  });

  it('should fallback to default title when conversation has no title', () => {
    const conversations = [
      { id: 'conv-1', title: null },
      { id: 'conv-2', title: 'Another Chat' }
    ];

    renderHook(() =>
      useDocumentTitle({
        conversationId: 'conv-1',
        currentConversationTitle: null,
        conversations,
        fallbackTitle: 'ChatForge'
      })
    );

    expect(document.title).toBe('ChatForge');
  });

  it('should update title when conversation changes', () => {
    const conversations = [
      { id: 'conv-1', title: 'First Conversation' },
      { id: 'conv-2', title: 'Second Conversation' }
    ];

    const { rerender } = renderHook(
      (props) => useDocumentTitle(props),
      {
        initialProps: {
          conversationId: 'conv-1',
          currentConversationTitle: 'First Conversation',
          conversations,
          fallbackTitle: 'ChatForge'
        }
      }
    );

    expect(document.title).toBe('First Conversation - ChatForge');

    // Switch to second conversation
    rerender({
      conversationId: 'conv-2',
      currentConversationTitle: 'Second Conversation',
      conversations,
      fallbackTitle: 'ChatForge'
    });

    expect(document.title).toBe('Second Conversation - ChatForge');

    // Switch to no conversation
    rerender({
      conversationId: null,
      currentConversationTitle: null,
      conversations,
      fallbackTitle: 'ChatForge'
    });

    expect(document.title).toBe('ChatForge');
  });

  it('should handle empty conversations array', () => {
    renderHook(() =>
      useDocumentTitle({
        conversationId: 'non-existent',
        currentConversationTitle: null,
        conversations: [],
        fallbackTitle: 'ChatForge'
      })
    );

    expect(document.title).toBe('ChatForge');
  });

  it('should handle conversation not found in list', () => {
    const conversations = [
      { id: 'conv-1', title: 'First Conversation' }
    ];

    renderHook(() =>
      useDocumentTitle({
        conversationId: 'non-existent',
        currentConversationTitle: null,
        conversations,
        fallbackTitle: 'ChatForge'
      })
    );

    expect(document.title).toBe('ChatForge');
  });

  it('should prioritize currentConversationTitle over conversations array', () => {
    const conversations = [
      { id: 'conv-1', title: 'Old Title from Array' }
    ];

    renderHook(() =>
      useDocumentTitle({
        conversationId: 'conv-1',
        currentConversationTitle: 'New Title from State',
        conversations,
        fallbackTitle: 'ChatForge'
      })
    );

    expect(document.title).toBe('New Title from State - ChatForge');
  });

  it('should fallback to conversations array when currentConversationTitle is null', () => {
    const conversations = [
      { id: 'conv-1', title: 'Title from Array' }
    ];

    renderHook(() =>
      useDocumentTitle({
        conversationId: 'conv-1',
        currentConversationTitle: null,
        conversations,
        fallbackTitle: 'ChatForge'
      })
    );

    expect(document.title).toBe('Title from Array - ChatForge');
  });
});
