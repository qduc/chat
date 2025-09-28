import { useState, useEffect, useCallback } from 'react';

export interface BuiltInPrompt {
  id: string;
  slug: string;
  name: string;
  description?: string;
  order: number;
  body: string;
  read_only: boolean;
}

export interface CustomPrompt {
  id: string;
  name: string;
  body: string;
  usage_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PromptsListResponse {
  built_ins: BuiltInPrompt[];
  custom: CustomPrompt[];
  error?: string;
}

interface InlineEdit {
  promptId: string;
  content: string;
}

interface UseSystemPromptsReturn {
  // Data
  prompts: PromptsListResponse | null;
  loading: boolean;
  error: string | null;

  // Active selection state
  activePromptId: string | null;
  setActivePromptId: (promptId: string | null) => void;

  // Inline editing state
  inlineEdits: Record<string, string>;
  hasUnsavedChanges: (promptId: string) => boolean;

  // Actions
  fetchPrompts: () => Promise<void>;
  createPrompt: (data: { name: string; body: string }) => Promise<CustomPrompt | null>;
  updatePrompt: (id: string, updates: { name?: string; body?: string }) => Promise<CustomPrompt | null>;
  deletePrompt: (id: string) => Promise<boolean>;
  duplicatePrompt: (id: string) => Promise<CustomPrompt | null>;
  selectPrompt: (promptId: string, conversationId: string, inlineOverride?: string) => Promise<boolean>;
  clearPrompt: (conversationId: string) => Promise<boolean>;

  // Inline editing actions
  setInlineEdit: (promptId: string, content: string) => void;
  clearInlineEdit: (promptId: string) => void;
  saveInlineEdit: (promptId: string) => Promise<boolean>;
  discardInlineEdit: (promptId: string) => void;

  // Utilities
  getPromptById: (id: string) => BuiltInPrompt | CustomPrompt | null;
  getEffectivePromptContent: (promptId: string) => string;
}

const STORAGE_PREFIX = 'prompt-inline-';
const stripTrailingSlash = (value: string) => value.replace(/\/$/, '');
const API_BASE = stripTrailingSlash(process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001');
const buildApiUrl = (path: string) => `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;

// Helper to get auth headers
const getAuthHeaders = () => {
  const headers: Record<string, string> = {};
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('chatforge_auth_token');
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }
  return headers;
};

export function useSystemPrompts(userId?: string): UseSystemPromptsReturn {
  const [prompts, setPrompts] = useState<PromptsListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activePromptId, setActivePromptId] = useState<string | null>(null);
  const [inlineEdits, setInlineEdits] = useState<Record<string, string>>({});

  // Load inline edits from localStorage on mount
  useEffect(() => {
    if (!userId) return;

    const storedEdits: Record<string, string> = {};

    // Scan localStorage for this user's inline edits
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(`${STORAGE_PREFIX}${userId}-`)) {
        const promptId = key.substring(`${STORAGE_PREFIX}${userId}-`.length);
        const content = localStorage.getItem(key);
        if (content) {
          storedEdits[promptId] = content;
        }
      }
    }

    setInlineEdits(storedEdits);
  }, [userId]);

  // Fetch prompts from API
  const fetchPrompts = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(buildApiUrl('/v1/system-prompts'), {
        method: 'GET',
        headers: getAuthHeaders(),
        credentials: 'include',
      });

      if (response.status === 404) {
        let fallbackError = 'No system prompts are available yet.';

        try {
          const errorPayload = await response.json();
          const derivedMessage = errorPayload?.message || errorPayload?.error;
          if (derivedMessage && typeof derivedMessage === 'string') {
            fallbackError = derivedMessage;
          }
        } catch (parseError) {
          console.info('[useSystemPrompts] 404 response without JSON payload', parseError);
        }

        setPrompts({
          built_ins: [],
          custom: [],
          error: fallbackError
        });
        setActivePromptId(null);
        return;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const normalizedError = typeof data?.error === 'string' ? data.error : null;

      setPrompts({
        built_ins: Array.isArray(data?.built_ins) ? data.built_ins : [],
        custom: Array.isArray(data?.custom) ? data.custom : [],
        error: normalizedError
      });

      // Show warning if there's a load error
      if (normalizedError) {
        console.warn('[useSystemPrompts] Built-ins load error:', normalizedError);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch prompts';
      setError(message);
      console.error('[useSystemPrompts] Fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Create custom prompt
  const createPrompt = useCallback(async (data: { name: string; body: string }) => {
    setError(null);

    try {
      const response = await fetch(buildApiUrl('/v1/system-prompts'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        credentials: 'include',
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `HTTP ${response.status}`);
      }

      const newPrompt = await response.json();

      // Refresh prompts list
      await fetchPrompts();

      return newPrompt;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create prompt';
      setError(message);
      console.error('[useSystemPrompts] Create error:', err);
      return null;
    }
  }, [fetchPrompts]);

  // Update custom prompt
  const updatePrompt = useCallback(async (id: string, updates: { name?: string; body?: string }) => {
    setError(null);

    try {
      const response = await fetch(buildApiUrl(`/v1/system-prompts/${id}`), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        credentials: 'include',
        body: JSON.stringify(updates),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `HTTP ${response.status}`);
      }

      const updatedPrompt = await response.json();

      // Refresh prompts list
      await fetchPrompts();

      return updatedPrompt;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update prompt';
      setError(message);
      console.error('[useSystemPrompts] Update error:', err);
      return null;
    }
  }, [fetchPrompts]);

  // Delete custom prompt
  const deletePrompt = useCallback(async (id: string) => {
    setError(null);

    try {
      const response = await fetch(buildApiUrl(`/v1/system-prompts/${id}`), {
        method: 'DELETE',
        headers: getAuthHeaders(),
        credentials: 'include',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `HTTP ${response.status}`);
      }

      // Clear active selection if deleting active prompt
      if (activePromptId === id) {
        setActivePromptId(null);
      }

      // Clear any inline edit for this prompt
      if (userId) {
        localStorage.removeItem(`${STORAGE_PREFIX}${userId}-${id}`);
        setInlineEdits(prev => {
          const { [id]: removed, ...rest } = prev;
          return rest;
        });
      }

      // Refresh prompts list
      await fetchPrompts();

      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete prompt';
      setError(message);
      console.error('[useSystemPrompts] Delete error:', err);
      return false;
    }
  }, [activePromptId, userId, fetchPrompts]);

  // Duplicate prompt
  const duplicatePrompt = useCallback(async (id: string) => {
    setError(null);

    try {
      const response = await fetch(buildApiUrl(`/v1/system-prompts/${id}/duplicate`), {
        method: 'POST',
        headers: getAuthHeaders(),
        credentials: 'include',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `HTTP ${response.status}`);
      }

      const newPrompt = await response.json();

      // Refresh prompts list
      await fetchPrompts();

      return newPrompt;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to duplicate prompt';
      setError(message);
      console.error('[useSystemPrompts] Duplicate error:', err);
      return null;
    }
  }, [fetchPrompts]);

  // Select prompt for conversation
  const selectPrompt = useCallback(async (promptId: string, conversationId: string, inlineOverride?: string) => {
    setError(null);

    try {
      const response = await fetch(buildApiUrl(`/v1/system-prompts/${promptId}/select`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        credentials: 'include',
        body: JSON.stringify({
          conversation_id: conversationId,
          inline_override: inlineOverride
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `HTTP ${response.status}`);
      }

      setActivePromptId(promptId);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to select prompt';
      setError(message);
      console.error('[useSystemPrompts] Select error:', err);
      return false;
    }
  }, []);

  // Clear active prompt
  const clearPrompt = useCallback(async (conversationId: string) => {
    setError(null);

    try {
      const response = await fetch(buildApiUrl('/v1/system-prompts/none/select'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        credentials: 'include',
        body: JSON.stringify({ conversation_id: conversationId }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `HTTP ${response.status}`);
      }

      setActivePromptId(null);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to clear prompt';
      setError(message);
      console.error('[useSystemPrompts] Clear error:', err);
      return false;
    }
  }, []);

  // Inline editing functions
  const setInlineEdit = useCallback((promptId: string, content: string) => {
    if (!userId) return;

    const storageKey = `${STORAGE_PREFIX}${userId}-${promptId}`;
    localStorage.setItem(storageKey, content);

    setInlineEdits(prev => ({
      ...prev,
      [promptId]: content
    }));
  }, [userId]);

  const clearInlineEdit = useCallback((promptId: string) => {
    if (!userId) return;

    const storageKey = `${STORAGE_PREFIX}${userId}-${promptId}`;
    localStorage.removeItem(storageKey);

    setInlineEdits(prev => {
      const { [promptId]: removed, ...rest } = prev;
      return rest;
    });
  }, [userId]);

  const saveInlineEdit = useCallback(async (promptId: string) => {
    const inlineContent = inlineEdits[promptId];
    if (!inlineContent) return false;

    const result = await updatePrompt(promptId, { body: inlineContent });
    if (result) {
      clearInlineEdit(promptId);
      return true;
    }
    return false;
  }, [inlineEdits, updatePrompt, clearInlineEdit]);

  const discardInlineEdit = useCallback((promptId: string) => {
    clearInlineEdit(promptId);
  }, [clearInlineEdit]);

  // Utility functions
  const getPromptById = useCallback((id: string): BuiltInPrompt | CustomPrompt | null => {
    if (!prompts) return null;

    const builtIn = prompts.built_ins.find(p => p.id === id);
    if (builtIn) return builtIn;

    const custom = prompts.custom.find(p => p.id === id);
    if (custom) return custom;

    return null;
  }, [prompts]);

  const getEffectivePromptContent = useCallback((promptId: string): string => {
    const inlineContent = inlineEdits[promptId];
    if (inlineContent) return inlineContent;

    const prompt = getPromptById(promptId);
    return prompt?.body || '';
  }, [inlineEdits, getPromptById]);

  const hasUnsavedChanges = useCallback((promptId: string): boolean => {
    return Boolean(inlineEdits[promptId]);
  }, [inlineEdits]);

  // Auto-fetch on mount
  useEffect(() => {
    if (userId) {
      fetchPrompts();
    }
  }, [userId, fetchPrompts]);

  return {
    // Data
    prompts,
    loading,
    error,
    activePromptId,
    setActivePromptId,
    inlineEdits,
    hasUnsavedChanges,

    // Actions
    fetchPrompts,
    createPrompt,
    updatePrompt,
    deletePrompt,
    duplicatePrompt,
    selectPrompt,
    clearPrompt,

    // Inline editing
    setInlineEdit,
    clearInlineEdit,
    saveInlineEdit,
    discardInlineEdit,

    // Utilities
    getPromptById,
    getEffectivePromptContent,
  };
}