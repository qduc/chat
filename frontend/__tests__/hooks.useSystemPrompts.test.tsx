/**
 * Expanded tests for useSystemPrompts hook
 * @jest-environment jsdom
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { useSystemPrompts, BuiltInPrompt, CustomPrompt } from '../hooks/useSystemPrompts';
import { httpClient, HttpError } from '../lib/http';

// Get access to the mocked httpClient
const mockHttpClient = httpClient as jest.Mocked<typeof httpClient>;

const createMockBuiltIn = (overrides: Partial<BuiltInPrompt> = {}): BuiltInPrompt => ({
  id: 'builtin-1',
  slug: 'default-assistant',
  name: 'Default Assistant',
  description: 'A helpful assistant',
  order: 1,
  body: 'You are a helpful assistant.',
  read_only: true,
  ...overrides,
});

const createMockCustom = (overrides: Partial<CustomPrompt> = {}): CustomPrompt => ({
  id: 'custom-1',
  name: 'My Custom Prompt',
  body: 'Custom instructions.',
  usage_count: 5,
  last_used_at: '2024-01-01T00:00:00Z',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  ...overrides,
});

const mockPromptsResponse = (
  built_ins: BuiltInPrompt[] = [],
  custom: CustomPrompt[] = [],
  error?: string
) => ({
  data: { built_ins, custom, error },
  status: 200,
  statusText: 'OK',
  headers: new Headers(),
});

describe('useSystemPrompts', () => {
  const USER_ID = 'test-user-123';

  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    mockHttpClient.get.mockResolvedValue(mockPromptsResponse([], []));
    mockHttpClient.post.mockResolvedValue({
      data: {},
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
    });
    mockHttpClient.patch.mockResolvedValue({
      data: {},
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
    });
    mockHttpClient.delete.mockResolvedValue({
      data: {},
      status: 204,
      statusText: 'No Content',
      headers: new Headers(),
    });
  });

  describe('Initial state and fetching', () => {
    it('starts with null prompts and loading false', () => {
      const { result } = renderHook(() => useSystemPrompts(USER_ID));

      // Initially prompts is null, loading becomes true when fetch starts
      expect(result.current.prompts).toBeNull();
      expect(result.current.error).toBeNull();
      expect(result.current.activePromptId).toBeNull();
    });

    it('fetches prompts on mount', async () => {
      const builtIns = [createMockBuiltIn()];
      const custom = [createMockCustom()];
      mockHttpClient.get.mockResolvedValue(mockPromptsResponse(builtIns, custom));

      const { result } = renderHook(() => useSystemPrompts(USER_ID));

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(mockHttpClient.get).toHaveBeenCalledWith('/v1/system-prompts');
      expect(result.current.prompts?.built_ins).toHaveLength(1);
      expect(result.current.prompts?.custom).toHaveLength(1);
    });

    it('sets error when fetch fails', async () => {
      mockHttpClient.get.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useSystemPrompts(USER_ID));

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.error).toBe('Network error');
    });

    it('handles 404 error gracefully', async () => {
      mockHttpClient.get.mockRejectedValue(
        new HttpError(404, 'Not Found', undefined, { message: 'No prompts available' })
      );

      const { result } = renderHook(() => useSystemPrompts(USER_ID));

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.prompts?.error).toBe('No prompts available');
      expect(result.current.error).toBeNull();
    });

    it('handles API response with error field', async () => {
      mockHttpClient.get.mockResolvedValue(
        mockPromptsResponse([], [], 'Database connection failed')
      );

      const { result } = renderHook(() => useSystemPrompts(USER_ID));

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.prompts?.error).toBe('Database connection failed');
    });
  });

  describe('createPrompt', () => {
    it('creates a new prompt and refreshes list', async () => {
      const newPrompt = createMockCustom({ id: 'new-1', name: 'New Prompt' });
      mockHttpClient.post.mockResolvedValue({
        data: newPrompt,
        status: 201,
        statusText: 'Created',
        headers: new Headers(),
      });

      const { result } = renderHook(() => useSystemPrompts(USER_ID));

      await waitFor(() => expect(result.current.loading).toBe(false));

      let created: CustomPrompt | null = null;
      await act(async () => {
        created = await result.current.createPrompt({
          name: 'New Prompt',
          body: 'New content',
        });
      });

      expect(created).toEqual(newPrompt);
      expect(mockHttpClient.post).toHaveBeenCalledWith('/v1/system-prompts', {
        name: 'New Prompt',
        body: 'New content',
      });
      // Should have called get again to refresh
      expect(mockHttpClient.get).toHaveBeenCalledTimes(2);
    });

    it('returns null and sets error on failure', async () => {
      mockHttpClient.post.mockRejectedValue(new Error('Create failed'));

      const { result } = renderHook(() => useSystemPrompts(USER_ID));

      await waitFor(() => expect(result.current.loading).toBe(false));

      let created: CustomPrompt | null = null;
      await act(async () => {
        created = await result.current.createPrompt({
          name: 'New Prompt',
          body: 'Content',
        });
      });

      expect(created).toBeNull();
      expect(result.current.error).toBe('Create failed');
    });
  });

  describe('updatePrompt', () => {
    it('updates a prompt and refreshes list', async () => {
      const updatedPrompt = createMockCustom({ name: 'Updated Name' });
      mockHttpClient.patch.mockResolvedValue({
        data: updatedPrompt,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
      });

      const { result } = renderHook(() => useSystemPrompts(USER_ID));

      await waitFor(() => expect(result.current.loading).toBe(false));

      let updatedResult: any = null;
      await act(async () => {
        updatedResult = await result.current.updatePrompt('custom-1', {
          name: 'Updated Name',
        });
      });

      expect(updatedResult?.name).toBe('Updated Name');
      expect(mockHttpClient.patch).toHaveBeenCalledWith('/v1/system-prompts/custom-1', {
        name: 'Updated Name',
      });
    });

    it('returns null and sets error on failure', async () => {
      mockHttpClient.patch.mockRejectedValue(new Error('Update failed'));

      const { result } = renderHook(() => useSystemPrompts(USER_ID));

      await waitFor(() => expect(result.current.loading).toBe(false));

      let updated: CustomPrompt | null = null;
      await act(async () => {
        updated = await result.current.updatePrompt('custom-1', { name: 'New' });
      });

      expect(updated).toBeNull();
      expect(result.current.error).toBe('Update failed');
    });
  });

  describe('deletePrompt', () => {
    it('deletes a prompt and refreshes list', async () => {
      const { result } = renderHook(() => useSystemPrompts(USER_ID));

      await waitFor(() => expect(result.current.loading).toBe(false));

      let success = false;
      await act(async () => {
        success = await result.current.deletePrompt('custom-1');
      });

      expect(success).toBe(true);
      expect(mockHttpClient.delete).toHaveBeenCalledWith('/v1/system-prompts/custom-1');
    });

    it('clears active prompt ID if deleting active prompt', async () => {
      const { result } = renderHook(() => useSystemPrompts(USER_ID));

      await waitFor(() => expect(result.current.loading).toBe(false));

      act(() => {
        result.current.setActivePromptId('custom-1');
      });

      expect(result.current.activePromptId).toBe('custom-1');

      await act(async () => {
        await result.current.deletePrompt('custom-1');
      });

      expect(result.current.activePromptId).toBeNull();
    });

    it('clears inline edit when deleting prompt', async () => {
      const STORAGE_KEY = `prompt-inline-${USER_ID}-custom-1`;
      localStorage.setItem(STORAGE_KEY, 'Draft content');

      const { result } = renderHook(() => useSystemPrompts(USER_ID));

      await waitFor(() => expect(result.current.loading).toBe(false));
      await waitFor(() => expect(result.current.inlineEdits['custom-1']).toBe('Draft content'));

      await act(async () => {
        await result.current.deletePrompt('custom-1');
      });

      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
      expect(result.current.inlineEdits['custom-1']).toBeUndefined();
    });

    it('returns false and sets error on failure', async () => {
      mockHttpClient.delete.mockRejectedValue(new Error('Delete failed'));

      const { result } = renderHook(() => useSystemPrompts(USER_ID));

      await waitFor(() => expect(result.current.loading).toBe(false));

      let success = false;
      await act(async () => {
        success = await result.current.deletePrompt('custom-1');
      });

      expect(success).toBe(false);
      expect(result.current.error).toBe('Delete failed');
    });
  });

  describe('duplicatePrompt', () => {
    it('duplicates a prompt', async () => {
      const duplicated = createMockCustom({ id: 'dup-1', name: 'My Prompt (Copy)' });
      mockHttpClient.post.mockResolvedValue({
        data: duplicated,
        status: 201,
        statusText: 'Created',
        headers: new Headers(),
      });

      const { result } = renderHook(() => useSystemPrompts(USER_ID));

      await waitFor(() => expect(result.current.loading).toBe(false));

      let dup: CustomPrompt | null = null;
      await act(async () => {
        dup = await result.current.duplicatePrompt('custom-1');
      });

      expect(dup).toEqual(duplicated);
      expect(mockHttpClient.post).toHaveBeenCalledWith('/v1/system-prompts/custom-1/duplicate');
    });
  });

  describe('selectPrompt', () => {
    it('selects a prompt for a conversation', async () => {
      const { result } = renderHook(() => useSystemPrompts(USER_ID));

      await waitFor(() => expect(result.current.loading).toBe(false));

      let success = false;
      await act(async () => {
        success = await result.current.selectPrompt('custom-1', 'conv-123');
      });

      expect(success).toBe(true);
      expect(result.current.activePromptId).toBe('custom-1');
      expect(mockHttpClient.post).toHaveBeenCalledWith('/v1/system-prompts/custom-1/select', {
        conversation_id: 'conv-123',
        inline_override: undefined,
      });
    });

    it('supports inline override', async () => {
      const { result } = renderHook(() => useSystemPrompts(USER_ID));

      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.selectPrompt('custom-1', 'conv-123', 'Override content');
      });

      expect(mockHttpClient.post).toHaveBeenCalledWith('/v1/system-prompts/custom-1/select', {
        conversation_id: 'conv-123',
        inline_override: 'Override content',
      });
    });
  });

  describe('clearPrompt', () => {
    it('clears the prompt for a conversation', async () => {
      const { result } = renderHook(() => useSystemPrompts(USER_ID));

      await waitFor(() => expect(result.current.loading).toBe(false));

      act(() => {
        result.current.setActivePromptId('custom-1');
      });

      let success = false;
      await act(async () => {
        success = await result.current.clearPrompt('conv-123');
      });

      expect(success).toBe(true);
      expect(result.current.activePromptId).toBeNull();
      expect(mockHttpClient.post).toHaveBeenCalledWith('/v1/system-prompts/none/select', {
        conversation_id: 'conv-123',
      });
    });
  });

  describe('Inline editing', () => {
    it('setInlineEdit persists to localStorage', async () => {
      const { result } = renderHook(() => useSystemPrompts(USER_ID));

      await waitFor(() => expect(result.current.loading).toBe(false));

      act(() => {
        result.current.setInlineEdit('custom-1', 'Edited content');
      });

      expect(localStorage.getItem(`prompt-inline-${USER_ID}-custom-1`)).toBe('Edited content');
      expect(result.current.inlineEdits['custom-1']).toBe('Edited content');
      expect(result.current.hasUnsavedChanges('custom-1')).toBe(true);
    });

    it('clearInlineEdit removes from localStorage and state', async () => {
      localStorage.setItem(`prompt-inline-${USER_ID}-custom-1`, 'Draft');

      const { result } = renderHook(() => useSystemPrompts(USER_ID));

      await waitFor(() => expect(result.current.loading).toBe(false));
      await waitFor(() => expect(result.current.inlineEdits['custom-1']).toBe('Draft'));

      act(() => {
        result.current.clearInlineEdit('custom-1');
      });

      expect(localStorage.getItem(`prompt-inline-${USER_ID}-custom-1`)).toBeNull();
      expect(result.current.inlineEdits['custom-1']).toBeUndefined();
      expect(result.current.hasUnsavedChanges('custom-1')).toBe(false);
    });

    it('saveInlineEdit updates prompt and clears edit', async () => {
      const updatedPrompt = createMockCustom({ body: 'Edited content' });
      mockHttpClient.patch.mockResolvedValue({
        data: updatedPrompt,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
      });

      const { result } = renderHook(() => useSystemPrompts(USER_ID));

      await waitFor(() => expect(result.current.loading).toBe(false));

      act(() => {
        result.current.setInlineEdit('custom-1', 'Edited content');
      });

      let success = false;
      await act(async () => {
        success = await result.current.saveInlineEdit('custom-1');
      });

      expect(success).toBe(true);
      expect(mockHttpClient.patch).toHaveBeenCalledWith('/v1/system-prompts/custom-1', {
        body: 'Edited content',
      });
      expect(result.current.inlineEdits['custom-1']).toBeUndefined();
    });

    it('saveInlineEdit returns false when no inline content', async () => {
      const { result } = renderHook(() => useSystemPrompts(USER_ID));

      await waitFor(() => expect(result.current.loading).toBe(false));

      let success = false;
      await act(async () => {
        success = await result.current.saveInlineEdit('custom-1');
      });

      expect(success).toBe(false);
    });

    it('discardInlineEdit removes edit without saving', async () => {
      const { result } = renderHook(() => useSystemPrompts(USER_ID));

      await waitFor(() => expect(result.current.loading).toBe(false));

      act(() => {
        result.current.setInlineEdit('custom-1', 'Draft content');
      });

      expect(result.current.inlineEdits['custom-1']).toBe('Draft content');

      act(() => {
        result.current.discardInlineEdit('custom-1');
      });

      expect(result.current.inlineEdits['custom-1']).toBeUndefined();
      expect(mockHttpClient.patch).not.toHaveBeenCalled();
    });

    it('ignores inline edits when userId is undefined', async () => {
      const { result } = renderHook(() => useSystemPrompts(undefined));

      await waitFor(() => expect(result.current.loading).toBe(false));

      act(() => {
        result.current.setInlineEdit('custom-1', 'Content');
      });

      expect(localStorage.length).toBe(0);
      expect(result.current.inlineEdits['custom-1']).toBeUndefined();
    });
  });

  describe('Utility functions', () => {
    it('getPromptById returns built-in prompt', async () => {
      const builtIn = createMockBuiltIn({ id: 'builtin-1' });
      mockHttpClient.get.mockResolvedValue(mockPromptsResponse([builtIn], []));

      const { result } = renderHook(() => useSystemPrompts(USER_ID));

      await waitFor(() => expect(result.current.loading).toBe(false));

      const prompt = result.current.getPromptById('builtin-1');
      expect(prompt).toEqual(builtIn);
    });

    it('getPromptById returns custom prompt', async () => {
      const custom = createMockCustom({ id: 'custom-1' });
      mockHttpClient.get.mockResolvedValue(mockPromptsResponse([], [custom]));

      const { result } = renderHook(() => useSystemPrompts(USER_ID));

      await waitFor(() => expect(result.current.loading).toBe(false));

      const prompt = result.current.getPromptById('custom-1');
      expect(prompt).toEqual(custom);
    });

    it('getPromptById returns null for unknown ID', async () => {
      mockHttpClient.get.mockResolvedValue(mockPromptsResponse([], []));

      const { result } = renderHook(() => useSystemPrompts(USER_ID));

      await waitFor(() => expect(result.current.loading).toBe(false));

      const prompt = result.current.getPromptById('unknown');
      expect(prompt).toBeNull();
    });

    it('getEffectivePromptContent returns inline edit if present', async () => {
      const custom = createMockCustom({ id: 'custom-1', body: 'Original' });
      mockHttpClient.get.mockResolvedValue(mockPromptsResponse([], [custom]));

      const { result } = renderHook(() => useSystemPrompts(USER_ID));

      await waitFor(() => expect(result.current.loading).toBe(false));

      act(() => {
        result.current.setInlineEdit('custom-1', 'Edited');
      });

      expect(result.current.getEffectivePromptContent('custom-1')).toBe('Edited');
    });

    it('getEffectivePromptContent returns original body if no edit', async () => {
      const custom = createMockCustom({ id: 'custom-1', body: 'Original body' });
      mockHttpClient.get.mockResolvedValue(mockPromptsResponse([], [custom]));

      const { result } = renderHook(() => useSystemPrompts(USER_ID));

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.getEffectivePromptContent('custom-1')).toBe('Original body');
    });

    it('getEffectivePromptContent returns empty string for unknown ID', async () => {
      mockHttpClient.get.mockResolvedValue(mockPromptsResponse([], []));

      const { result } = renderHook(() => useSystemPrompts(USER_ID));

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.getEffectivePromptContent('unknown')).toBe('');
    });
  });

  describe('setActivePromptId', () => {
    it('updates active prompt ID', async () => {
      const { result } = renderHook(() => useSystemPrompts(USER_ID));

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.activePromptId).toBeNull();

      act(() => {
        result.current.setActivePromptId('custom-1');
      });

      expect(result.current.activePromptId).toBe('custom-1');

      act(() => {
        result.current.setActivePromptId(null);
      });

      expect(result.current.activePromptId).toBeNull();
    });
  });

  describe('HttpError handling', () => {
    it('extracts message from HttpError', async () => {
      mockHttpClient.post.mockRejectedValue(
        new HttpError(400, 'Validation failed', undefined, { message: 'Name is required' })
      );

      const { result } = renderHook(() => useSystemPrompts(USER_ID));

      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.createPrompt({ name: '', body: 'Content' });
      });

      // Hook uses err.message directly from HttpError
      expect(result.current.error).toBe('Validation failed');
    });
  });
});
