import { renderHook, act, waitFor } from '@testing-library/react';
import { useSystemPrompts } from '../hooks/useSystemPrompts';

const mockFetchResponse = (data: any = { built_ins: [], custom: [] }) =>
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => data,
  } as unknown as Response);

describe('useSystemPrompts localStorage behaviour', () => {
  const USER_ID = 'user-inline-tests';
  const PROMPT_ID = 'custom:123';
  const STORAGE_KEY = `prompt-inline-${USER_ID}-${PROMPT_ID}`;

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('hydrates inline edits from localStorage on mount', async () => {
    localStorage.setItem(STORAGE_KEY, 'Draft content');
    const fetchMock = mockFetchResponse();

    const { result } = renderHook(() => useSystemPrompts(USER_ID));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.inlineEdits[PROMPT_ID]).toBe('Draft content');
    expect(result.current.hasUnsavedChanges(PROMPT_ID)).toBe(true);
  });

  test('setInlineEdit persists to localStorage and state', async () => {
    const fetchMock = mockFetchResponse();
    const { result } = renderHook(() => useSystemPrompts(USER_ID));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    act(() => {
      result.current.setInlineEdit(PROMPT_ID, 'Inline body');
    });

    expect(localStorage.getItem(STORAGE_KEY)).toBe('Inline body');
    expect(result.current.inlineEdits[PROMPT_ID]).toBe('Inline body');
    expect(result.current.hasUnsavedChanges(PROMPT_ID)).toBe(true);
  });

  test('clearInlineEdit removes persisted drafts', async () => {
    localStorage.setItem(STORAGE_KEY, 'Existing draft');
    const fetchMock = mockFetchResponse();
    const { result } = renderHook(() => useSystemPrompts(USER_ID));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    act(() => {
      result.current.clearInlineEdit(PROMPT_ID);
    });

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(result.current.inlineEdits[PROMPT_ID]).toBeUndefined();
    expect(result.current.hasUnsavedChanges(PROMPT_ID)).toBe(false);
  });

  test('setInlineEdit is a no-op when userId is undefined', () => {
    const fetchMock = mockFetchResponse();
    const { result } = renderHook(() => useSystemPrompts(undefined));

    // Clear any calls triggered during render (should be none, but ensures isolation)
    fetchMock.mockClear();

    act(() => {
      result.current.setInlineEdit(PROMPT_ID, 'Should not persist');
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(result.current.inlineEdits[PROMPT_ID]).toBeUndefined();
  });

  test('fetchPrompts gracefully handles missing system prompts (404)', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({ message: 'No prompts found' })
    } as unknown as Response);

    const { result } = renderHook(() => useSystemPrompts(USER_ID));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.prompts).toEqual({
      built_ins: [],
      custom: [],
      error: 'No prompts found'
    });
    expect(result.current.error).toBeNull();
  });
});
