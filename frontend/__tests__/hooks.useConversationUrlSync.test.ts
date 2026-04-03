/**
 * Unit tests for useConversationUrlSync.
 *
 * These verify URL sync, initial hydration, and back/forward navigation
 * behaviors extracted from ChatV2.
 */

import { renderHook, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// next/navigation mock
// ---------------------------------------------------------------------------
const mockPush = jest.fn();
let mockSearchParams = new URLSearchParams();
let mockPathname = '/';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => mockPathname,
  useSearchParams: () => mockSearchParams,
}));

import { useConversationUrlSync } from '../hooks/useConversationUrlSync';

beforeEach(() => {
  jest.clearAllMocks();
  mockSearchParams = new URLSearchParams();
  mockPathname = '/';
});

// ---------------------------------------------------------------------------
// Initial hydration
// ---------------------------------------------------------------------------

describe('initial hydration', () => {
  test('calls refreshConversations on first mount', () => {
    const refreshConversations = jest.fn();
    renderHook(() =>
      useConversationUrlSync({
        conversationId: null,
        selectConversation: jest.fn(),
        newChat: jest.fn(),
        refreshConversations,
      })
    );
    expect(refreshConversations).toHaveBeenCalledTimes(1);
  });

  test('selects conversation from URL query on mount', async () => {
    mockSearchParams = new URLSearchParams('c=conv-123');
    const selectConversation = jest.fn().mockResolvedValue(undefined);
    renderHook(() =>
      useConversationUrlSync({
        conversationId: null,
        selectConversation,
        newChat: jest.fn(),
        refreshConversations: jest.fn(),
      })
    );
    expect(selectConversation).toHaveBeenCalledWith('conv-123');
  });

  test('does not select conversation if conversationId already set', () => {
    mockSearchParams = new URLSearchParams('c=conv-123');
    const selectConversation = jest.fn();
    renderHook(() =>
      useConversationUrlSync({
        conversationId: 'conv-123',
        selectConversation,
        newChat: jest.fn(),
        refreshConversations: jest.fn(),
      })
    );
    // selectConversation should NOT have been called for initial load
    // (URL matches current conversation)
    expect(selectConversation).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// URL → state sync (back/forward)
// ---------------------------------------------------------------------------

describe('URL → state sync', () => {
  test('calls newChat when URL loses conversation param', () => {
    mockSearchParams = new URLSearchParams('c=conv-1');
    const newChat = jest.fn();
    const { rerender } = renderHook(
      ({ searchKey }) => {
        // Trick: we change searchKey to force the URL effect to re-fire
        return useConversationUrlSync({
          conversationId: 'conv-1',
          selectConversation: jest.fn(),
          newChat,
          refreshConversations: jest.fn(),
        });
      },
      { initialProps: { searchKey: 'c=conv-1' } }
    );

    // Simulate browser navigating to URL without c param
    mockSearchParams = new URLSearchParams();
    rerender({ searchKey: '' });

    expect(newChat).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// State → URL sync
// ---------------------------------------------------------------------------

describe('state → URL sync', () => {
  test('pushes conversation ID into URL when it changes', () => {
    const { rerender } = renderHook(
      ({ conversationId }) =>
        useConversationUrlSync({
          conversationId,
          selectConversation: jest.fn(),
          newChat: jest.fn(),
          refreshConversations: jest.fn(),
        }),
      { initialProps: { conversationId: null as string | null } }
    );

    // Change conversationId
    rerender({ conversationId: 'conv-new' });

    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('c=conv-new'));
  });

  test('removes c param from URL when conversation is cleared', () => {
    mockSearchParams = new URLSearchParams('c=conv-1');
    const { rerender } = renderHook(
      ({ conversationId }) =>
        useConversationUrlSync({
          conversationId,
          selectConversation: jest.fn(),
          newChat: jest.fn(),
          refreshConversations: jest.fn(),
        }),
      { initialProps: { conversationId: 'conv-1' as string | null } }
    );

    // Clear conversation
    rerender({ conversationId: null });

    expect(mockPush).toHaveBeenCalledWith('/');
  });
});

// ---------------------------------------------------------------------------
// Loading flag
// ---------------------------------------------------------------------------

describe('loading flag', () => {
  test('markLoadingConversation sets flag, clearLoadingConversation resets it', () => {
    const { result } = renderHook(() =>
      useConversationUrlSync({
        conversationId: null,
        selectConversation: jest.fn(),
        newChat: jest.fn(),
        refreshConversations: jest.fn(),
      })
    );

    expect(result.current.isLoadingConversation).toBe(false);

    act(() => {
      result.current.markLoadingConversation();
    });
    expect(result.current.isLoadingConversation).toBe(true);

    act(() => {
      result.current.clearLoadingConversation();
    });
    expect(result.current.isLoadingConversation).toBe(false);
  });
});
