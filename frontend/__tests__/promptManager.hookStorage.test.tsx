import { renderHook, act, waitFor } from '@testing-library/react';
import { useSystemPrompts } from '../hooks/useSystemPrompts';
import { httpClient, mockHttpResponse } from '../lib/http';

// Get access to the mocked httpClient
const mockHttpClient = httpClient as jest.Mocked<typeof httpClient>;

const mockHttpClientResponse = (data: any = { built_ins: [], custom: [] }) => {
  mockHttpClient.get.mockResolvedValue(mockHttpResponse(data));
  return mockHttpClient;
};

describe('useSystemPrompts localStorage behaviour', () => {
  const USER_ID = 'user-inline-tests';
  const PROMPT_ID = 'custom:123';
  const STORAGE_KEY = `prompt-inline-${USER_ID}-${PROMPT_ID}`;

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    jest.clearAllMocks();
    // Reset httpClient mocks to default behavior
    mockHttpClient.get.mockResolvedValue(mockHttpResponse({ built_ins: [], custom: [] }));
  });

  test('hydrates inline edits from localStorage on mount', async () => {
    localStorage.setItem(STORAGE_KEY, 'Draft content');
    const httpMock = mockHttpClientResponse();

    const { result } = renderHook(() => useSystemPrompts(USER_ID));

    await waitFor(() => expect(httpMock.get).toHaveBeenCalled());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.inlineEdits[PROMPT_ID]).toBe('Draft content');
    expect(result.current.hasUnsavedChanges(PROMPT_ID)).toBe(true);
  });

  test('setInlineEdit persists to localStorage and state', async () => {
    const httpMock = mockHttpClientResponse();
    const { result } = renderHook(() => useSystemPrompts(USER_ID));

    await waitFor(() => expect(httpMock.get).toHaveBeenCalled());

    act(() => {
      result.current.setInlineEdit(PROMPT_ID, 'Inline body');
    });

    expect(localStorage.getItem(STORAGE_KEY)).toBe('Inline body');
    expect(result.current.inlineEdits[PROMPT_ID]).toBe('Inline body');
    expect(result.current.hasUnsavedChanges(PROMPT_ID)).toBe(true);
  });

  test('clearInlineEdit removes persisted drafts', async () => {
    localStorage.setItem(STORAGE_KEY, 'Existing draft');
    const httpMock = mockHttpClientResponse();
    const { result } = renderHook(() => useSystemPrompts(USER_ID));

    await waitFor(() => expect(httpMock.get).toHaveBeenCalled());

    act(() => {
      result.current.clearInlineEdit(PROMPT_ID);
    });

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(result.current.inlineEdits[PROMPT_ID]).toBeUndefined();
    expect(result.current.hasUnsavedChanges(PROMPT_ID)).toBe(false);
  });

  test('setInlineEdit is a no-op when userId is undefined', () => {
    mockHttpClientResponse(); // Set up mock
    const { result } = renderHook(() => useSystemPrompts(undefined));

    // Clear any calls triggered during render (should be none, but ensures isolation)
    mockHttpClient.get.mockClear();

    act(() => {
      result.current.setInlineEdit(PROMPT_ID, 'Should not persist');
    });

    expect(mockHttpClient.get).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(result.current.inlineEdits[PROMPT_ID]).toBeUndefined();
  });

  test('fetchPrompts gracefully handles missing system prompts (404)', async () => {
    const { HttpError } = require('../lib/http');
    mockHttpClient.get.mockRejectedValue(
      new HttpError(404, 'Not Found', null, { message: 'No prompts found' })
    );

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
