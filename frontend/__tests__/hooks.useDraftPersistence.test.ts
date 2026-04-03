/**
 * Unit tests for useDraftPersistence.
 *
 * These verify the restore-on-conversation-change and debounced-save
 * behaviors extracted from useChat.
 */

import { renderHook, act } from '@testing-library/react';
import { useDraftPersistence } from '../hooks/useDraftPersistence';
import { getDraft, setDraft } from '../lib';

jest.mock('../lib', () => ({
  getDraft: jest.fn(),
  setDraft: jest.fn(),
}));

const mockedGetDraft = getDraft as jest.MockedFunction<typeof getDraft>;
const mockedSetDraft = setDraft as jest.MockedFunction<typeof setDraft>;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

// ---------------------------------------------------------------------------
// Restore behaviour
// ---------------------------------------------------------------------------

describe('restore on conversation change', () => {
  test('restores saved draft when switching to a conversation with a draft', () => {
    mockedGetDraft.mockReturnValue('saved text');
    const setInput = jest.fn();

    renderHook(
      ({ userId, convId, input }) => useDraftPersistence(userId, convId, input, setInput),
      { initialProps: { userId: 'u1', convId: 'c1', input: '' } }
    );

    // First restoration with empty input → should restore
    expect(setInput).toHaveBeenCalledWith('saved text');
  });

  test('does NOT overwrite existing input on first restoration (app boot)', () => {
    mockedGetDraft.mockReturnValue('saved text');
    const setInput = jest.fn();

    renderHook(
      ({ userId, convId, input }) => useDraftPersistence(userId, convId, input, setInput),
      { initialProps: { userId: 'u1', convId: 'c1', input: 'already typed' } }
    );

    // First restoration with non-empty input → do NOT overwrite
    expect(setInput).not.toHaveBeenCalled();
  });

  test('clears input when switching to a conversation without a draft (non-first switch)', () => {
    const setInput = jest.fn();

    // First render: conversation c1 with a saved draft
    mockedGetDraft.mockReturnValue('draft c1');
    const { rerender } = renderHook(
      ({ userId, convId, input }) => useDraftPersistence(userId, convId, input, setInput),
      { initialProps: { userId: 'u1', convId: 'c1', input: '' } }
    );

    setInput.mockClear();

    // Switch to c2 which has no draft
    mockedGetDraft.mockReturnValue(null);
    rerender({ userId: 'u1', convId: 'c2', input: 'stale text' });

    expect(setInput).toHaveBeenCalledWith('');
  });

  test('restores draft when switching conversations (non-first switch)', () => {
    const setInput = jest.fn();

    // First render: no draft
    mockedGetDraft.mockReturnValue(null);
    const { rerender } = renderHook(
      ({ userId, convId, input }) => useDraftPersistence(userId, convId, input, setInput),
      { initialProps: { userId: 'u1', convId: 'c1', input: '' } }
    );

    setInput.mockClear();

    // Switch to c2 which has a draft
    mockedGetDraft.mockReturnValue('hello from c2');
    rerender({ userId: 'u1', convId: 'c2', input: '' });

    expect(setInput).toHaveBeenCalledWith('hello from c2');
  });

  test('does NOT restore when conversationId has not changed', () => {
    mockedGetDraft.mockReturnValue('saved');
    const setInput = jest.fn();

    const { rerender } = renderHook(
      ({ userId, convId, input }) => useDraftPersistence(userId, convId, input, setInput),
      { initialProps: { userId: 'u1', convId: 'c1', input: '' } }
    );

    setInput.mockClear();

    // Re-render with same conversationId, different input
    rerender({ userId: 'u1', convId: 'c1', input: 'typing…' });

    expect(setInput).not.toHaveBeenCalled();
  });

  test('does nothing when userId is undefined', () => {
    mockedGetDraft.mockReturnValue('saved');
    const setInput = jest.fn();

    renderHook(
      ({ userId, convId, input }) => useDraftPersistence(userId, convId, input, setInput),
      { initialProps: { userId: undefined as string | undefined, convId: 'c1', input: '' } }
    );

    expect(setInput).not.toHaveBeenCalled();
    expect(mockedGetDraft).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Save behaviour (debounced)
// ---------------------------------------------------------------------------

describe('debounced save', () => {
  test('saves draft after 1s debounce', () => {
    mockedGetDraft.mockReturnValue(null);
    const setInput = jest.fn();

    renderHook(
      ({ userId, convId, input }) => useDraftPersistence(userId, convId, input, setInput),
      { initialProps: { userId: 'u1', convId: 'c1', input: 'hello' } }
    );

    // Not yet saved
    expect(mockedSetDraft).not.toHaveBeenCalledWith('u1', 'c1', 'hello');

    // Advance timer
    act(() => jest.advanceTimersByTime(1000));

    expect(mockedSetDraft).toHaveBeenCalledWith('u1', 'c1', 'hello');
  });

  test('clears draft immediately when input becomes empty', () => {
    mockedGetDraft.mockReturnValue(null);
    const setInput = jest.fn();

    renderHook(
      ({ userId, convId, input }) => useDraftPersistence(userId, convId, input, setInput),
      { initialProps: { userId: 'u1', convId: 'c1', input: '' } }
    );

    // Empty input writes empty draft right away (clears stored value)
    expect(mockedSetDraft).toHaveBeenCalledWith('u1', 'c1', '');
  });

  test('does not save when userId is undefined', () => {
    mockedGetDraft.mockReturnValue(null);
    const setInput = jest.fn();

    renderHook(
      ({ userId, convId, input }) => useDraftPersistence(userId, convId, input, setInput),
      { initialProps: { userId: undefined as string | undefined, convId: 'c1', input: 'hello' } }
    );

    act(() => jest.advanceTimersByTime(2000));

    expect(mockedSetDraft).not.toHaveBeenCalled();
  });

  test('debounce is reset when input changes quickly', () => {
    mockedGetDraft.mockReturnValue(null);
    const setInput = jest.fn();

    const { rerender } = renderHook(
      ({ userId, convId, input }) => useDraftPersistence(userId, convId, input, setInput),
      { initialProps: { userId: 'u1', convId: 'c1', input: 'h' } }
    );

    act(() => jest.advanceTimersByTime(500));

    // Input changes before debounce fires
    rerender({ userId: 'u1', convId: 'c1', input: 'he' });
    act(() => jest.advanceTimersByTime(500));

    // The first debounce should have been cancelled — 'h' never saved
    expect(mockedSetDraft).not.toHaveBeenCalledWith('u1', 'c1', 'h');

    // Let the second debounce fire
    act(() => jest.advanceTimersByTime(500));
    expect(mockedSetDraft).toHaveBeenCalledWith('u1', 'c1', 'he');
  });
});

// ---------------------------------------------------------------------------
// Null conversationId (new chat)
// ---------------------------------------------------------------------------

describe('null conversationId (new chat)', () => {
  test('uses empty-string conversationId for getDraft/setDraft', () => {
    mockedGetDraft.mockReturnValue('new chat draft');
    const setInput = jest.fn();

    renderHook(
      ({ userId, convId, input }) => useDraftPersistence(userId, convId, input, setInput),
      { initialProps: { userId: 'u1', convId: null as string | null, input: '' } }
    );

    expect(mockedGetDraft).toHaveBeenCalledWith('u1', '');
    expect(setInput).toHaveBeenCalledWith('new chat draft');
  });
});
