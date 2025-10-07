import { useState, useCallback, useRef, useEffect } from 'react';
import type { MessageContent } from '../lib';
import { conversations as conversationsApi, chat, providers, auth } from '../lib/api';
import { httpClient } from '../lib/http';
import type { ConversationMeta, ConversationWithMessages, Provider, ChatOptionsExtended } from '../lib/types';

// Types
export interface PendingState {
  streaming: boolean;
  error?: string;
  abort: AbortController | null;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: MessageContent;
  timestamp?: number;
}

export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updatedAt: string;
}

export interface ModelOption {
  value: string;
  label: string;
}

export interface ModelGroup {
  id: string;
  label: string;
  options: ModelOption[];
}

export type Status = 'idle' | 'streaming';
export type QualityLevel = 'quick' | 'balanced' | 'thorough';

// Helper function to convert ConversationMeta to Conversation
function convertConversationMeta(meta: ConversationMeta): Conversation {
  return {
    id: meta.id,
    title: meta.title || '',
    created_at: meta.created_at,
    updatedAt: meta.created_at, // Use created_at as updatedAt fallback
  };
}

export function useChat() {
  // Message & Conversation State
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationTitle, setCurrentConversationTitle] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingConversations, setLoadingConversations] = useState(false);

  // UI State
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(false);
  const [historyEnabled] = useState(true); // Make configurable if needed

  // Editing State
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState<string>('');

  // Model & Provider State
  const SELECTED_MODEL_KEY = 'selectedModel';

  // model state - internal setter is kept separate from the persisted setter
  const [model, setModelState] = useState<string>('gpt-4');
  // persisted setter - saves last manually selected model to localStorage
  const setModel = useCallback((m: string) => {
    setModelState(m);
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(SELECTED_MODEL_KEY, m);
      }
    } catch {
      // ignore localStorage errors
    }
  }, []);
  const [providerId, setProviderId] = useState<string | null>(null);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelGroups, setModelGroups] = useState<ModelGroup[]>([]);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [modelToProvider, setModelToProvider] = useState<Record<string, string>>({});
  /* eslint-disable-next-line @typescript-eslint/no-unused-vars */
  const [modelCapabilities, setModelCapabilities] = useState<any>(null);

  // Tool & Quality State
  const [useTools, setUseTools] = useState(true);
  const [enabledTools, setEnabledTools] = useState<string[]>([]);
  const [shouldStream, setShouldStream] = useState(true);
  const [qualityLevel, setQualityLevel] = useState<QualityLevel>('balanced');

  // Image State
  const [images, setImages] = useState<any[]>([]);

  // System Prompt State
  const [activeSystemPromptId, setActiveSystemPromptId] = useState<string | null>(null);
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);

  // User State
  const [user, setUser] = useState<{ id: string } | null>(null);

  // Abort Controller
  const abortControllerRef = useRef<AbortController | null>(null);

  // Actions - Sidebar
  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed(prev => !prev);
  }, []);

  const toggleRightSidebar = useCallback(() => {
    setRightSidebarCollapsed(prev => !prev);
  }, []);

  // Actions - Conversations
  const selectConversation = useCallback(async (id: string) => {
    try {
      setLoadingConversations(true);
      // Request a larger message page by default so the UI can show history
      const data = await conversationsApi.get(id, { limit: 200 });

      // Convert backend messages to frontend format
      const convertedMessages: Message[] = data.messages.map((msg) => ({
        id: String(msg.id),
        role: msg.role,
        content: msg.content,
        timestamp: new Date(msg.created_at).getTime()
      }));

      setMessages(convertedMessages);
      setConversationId(id);
      setCurrentConversationTitle(data.title || null);
      // If the conversation includes a model, apply it for the active conversation
      // but do NOT persist it to localStorage (persist only user manual selections)
      if (data.model) {
        setModelState(data.model);
      }
      // Accept either `provider` or legacy `provider_id` from API
      const providerFromData = (data as any).provider ?? (data as any).provider_id;
      if (providerFromData) {
        setProviderId(providerFromData);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load conversation');
    } finally {
      setLoadingConversations(false);
    }
  }, []);

  const deleteConversation = useCallback(async (id: string) => {
    try {
      await conversationsApi.delete(id);
      setConversations(prev => prev.filter(c => c.id !== id));
      if (conversationId === id) {
        setConversationId(null);
        setMessages([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete conversation');
    }
  }, [conversationId]);

  const loadMoreConversations = useCallback(async () => {
    if (!nextCursor || loadingConversations) return;
    try {
      setLoadingConversations(true);
      const data = await conversationsApi.list({ cursor: nextCursor, limit: 20 });
      setConversations(prev => [...prev, ...data.items.map(convertConversationMeta)]);
      setNextCursor(data.next_cursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load conversations');
    } finally {
      setLoadingConversations(false);
    }
  }, [nextCursor, loadingConversations]);

  const refreshConversations = useCallback(async () => {
    try {
      setLoadingConversations(true);
      const data = await conversationsApi.list();
      setConversations(data.items.map(convertConversationMeta));
      setNextCursor(data.next_cursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh conversations');
    } finally {
      setLoadingConversations(false);
    }
  }, []);

  const newChat = useCallback(() => {
    setMessages([]);
    setConversationId(null);
    setInput('');
    setError(null);
    setEditingMessageId(null);
    setEditingContent('');
    setImages([]);
    setCurrentConversationTitle(null);
    // When starting a new chat (no active conversation) prefer the saved model
    try {
      if (typeof window !== 'undefined') {
        const saved = window.localStorage.getItem(SELECTED_MODEL_KEY);
        if (saved) setModelState(saved);
      }
    } catch {
      // ignore localStorage errors
    }
  }, []);

  // On mount, when there is no active conversation, load the saved selected model
  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && !conversationId) {
        const saved = window.localStorage.getItem(SELECTED_MODEL_KEY);
        if (saved) setModelState(saved);
      }
    } catch {
      // ignore
    }
    // We intentionally only run this on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Actions - Messages
  const sendMessage = useCallback(async (content?: string) => {
    const messageText = content || input;
    if (!messageText.trim() && images.length === 0) return;

    try {
      setStatus('streaming');
      setError(null);

      // Create abort controller
      abortControllerRef.current = new AbortController();

      // Create user message
      const userMessage: Message = {
        id: Date.now().toString(),
        role: 'user',
        content: messageText,
        timestamp: Date.now()
      };
      setMessages(prev => [...prev, userMessage]);

      // Create placeholder assistant message
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: '',
        timestamp: Date.now()
      };
      setMessages(prev => [...prev, assistantMessage]);

      // Convert images to content format if present
      let messageContent: MessageContent = messageText;
      if (images.length > 0) {
        const contentParts: any[] = [{ type: 'text', text: messageText }];
        for (const img of images) {
          contentParts.push({
            type: 'image_url',
            image_url: { url: img.url }
          });
        }
        messageContent = contentParts;
      }

      // Send message with streaming
      const response = await chat.sendMessage({
        messages: [{ id: userMessage.id, role: 'user', content: messageContent }],
        model,
        providerId: providerId || '',
        stream: shouldStream,
        signal: abortControllerRef.current.signal,
        conversationId: conversationId || undefined,
        streamingEnabled: shouldStream,
        toolsEnabled: useTools,
        tools: enabledTools,
        qualityLevel,
        systemPrompt: systemPrompt || undefined,
        activeSystemPromptId: activeSystemPromptId || undefined,
        onToken: (token: string) => {
          setMessages(prev => {
            const updated = [...prev];
            const lastMsg = updated[updated.length - 1];
            if (lastMsg && lastMsg.role === 'assistant') {
              lastMsg.content = typeof lastMsg.content === 'string'
                ? lastMsg.content + token
                : token;
            }
            return updated;
          });
        }
      } as ChatOptionsExtended);

      // Update assistant message with final content
      setMessages(prev => {
        const updated = [...prev];
        const lastMsg = updated[updated.length - 1];
        if (lastMsg && lastMsg.role === 'assistant') {
          lastMsg.content = response.content;
        }
        return updated;
      });

      // Update conversation metadata if returned
      if (response.conversation) {
        setConversationId(response.conversation.id);
        setCurrentConversationTitle(response.conversation.title || null);
      }

      setInput('');
      setImages([]);
      setStatus('idle');
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        setError('Message cancelled');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to send message');
      }
      setStatus('idle');
    }
  }, [input, images, conversationId, model, providerId, shouldStream, useTools, enabledTools, qualityLevel, systemPrompt, activeSystemPromptId]);

  const stopStreaming = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setStatus('idle');
  }, []);

  const regenerate = useCallback(async (baseMessages: Message[]) => {
    setMessages(baseMessages);

    if (baseMessages.length === 0) return;

    const lastUserMessage = baseMessages
      .slice()
      .reverse()
      .find(m => m.role === 'user');

    if (lastUserMessage) {
      await sendMessage(
        typeof lastUserMessage.content === 'string'
          ? lastUserMessage.content
          : ''
      );
    }
  }, [sendMessage]);

  // Actions - Editing
  const startEdit = useCallback((messageId: string, content: MessageContent) => {
    setEditingMessageId(messageId);
    // Convert MessageContent to string for editing
    const contentStr = typeof content === 'string' ? content :
      content.map(c => c.type === 'text' ? c.text : '[Image]').join('\n');
    setEditingContent(contentStr);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingMessageId(null);
    setEditingContent('');
  }, []);

  const updateEditContent = useCallback((content: string) => {
    setEditingContent(content);
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editingMessageId || !conversationId) return;

    try {
      const result = await conversationsApi.editMessage(
        conversationId,
        editingMessageId,
        editingContent
      );

      // Update local messages
      setMessages(prev =>
        prev.map(m =>
          m.id === editingMessageId ? { ...m, content: editingContent } : m
        )
      );

      // If a new conversation was created, update the conversation ID
      if (result.new_conversation_id !== conversationId) {
        setConversationId(result.new_conversation_id);
      }

      cancelEdit();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save edit');
    }
  }, [editingMessageId, editingContent, conversationId, cancelEdit]);

  // Actions - Models & Providers
  const loadProvidersAndModels = useCallback(async () => {
    try {
      setIsLoadingModels(true);

      // Fetch providers list
      const providersResponse = await httpClient.get<{ providers: Provider[] }>('/v1/providers');
      const providersList = providersResponse.data.providers.filter((p: Provider) => p.enabled === 1);

      if (providersList.length === 0) {
        setModelGroups([]);
        setModelOptions([]);
        setModelToProvider({});
        return;
      }

      // Fetch models for each provider
      const groups: ModelGroup[] = [];
      const options: ModelOption[] = [];
      const modelToProviderMap: Record<string, string> = {};

      for (const provider of providersList) {
        try {
          const modelsResponse = await httpClient.get<{ provider: any; models: any[] }>(`/v1/providers/${provider.id}/models`);
          const models = modelsResponse.data.models || [];

          if (models.length > 0) {
            // Create model options for this provider
            const providerOptions: ModelOption[] = models.map((model: any) => ({
              value: model.id,
              label: model.id
            }));

            groups.push({
              id: provider.id,
              label: provider.name,
              options: providerOptions
            });

            options.push(...providerOptions);

            // Build model to provider mapping
            models.forEach((model: any) => {
              modelToProviderMap[model.id] = provider.id;
            });
          }
        } catch (err) {
          console.warn(`Failed to load models for provider ${provider.name}:`, err);
        }
      }

      setModelGroups(groups);
      setModelOptions(options);
      setModelToProvider(modelToProviderMap);

      // Set default provider if not already set (use functional update to avoid capturing providerId)
      if (providersList.length > 0) {
        setProviderId(prev => prev ?? providersList[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load models');
    } finally {
      setIsLoadingModels(false);
    }
  }, []);

  const setInlineSystemPromptOverride = useCallback((prompt: string | null) => {
    setSystemPrompt(prompt);
  }, []);

  // Load user profile on mount
  useEffect(() => {
    const loadUser = async () => {
      try {
        const profile = await auth.getProfile();
        setUser({ id: profile.id });
      } catch {
        // User not authenticated, that's ok
        console.log('[useChat] User not authenticated');
      }
    };
    loadUser();
  }, []);

  // Load providers and models on mount
  useEffect(() => {
    loadProvidersAndModels();
  }, [loadProvidersAndModels]);

  return {
    // State
    messages,
    conversationId,
    conversations,
    currentConversationTitle,
    nextCursor,
    loadingConversations,
    input,
    status,
    error,
    abort: abortControllerRef.current,
    sidebarCollapsed,
    rightSidebarCollapsed,
    historyEnabled,
    editingMessageId,
    editingContent,
    model,
    providerId,
    isLoadingModels,
    modelGroups,
    modelOptions,
    modelToProvider,
    modelCapabilities,
    useTools,
    enabledTools,
    shouldStream,
    qualityLevel,
    images,
    user,
    activeSystemPromptId,
    systemPrompt,

    // Actions
    setMessages,
    setInput,
    setModel,
    setProviderId,
    setUseTools,
    setEnabledTools,
    setShouldStream,
    setQualityLevel,
    setImages,
    setActiveSystemPromptId,
    toggleSidebar,
    toggleRightSidebar,
    selectConversation,
    deleteConversation,
    loadMoreConversations,
    refreshConversations,
    newChat,
    sendMessage,
    stopStreaming,
    regenerate,
    startEdit,
    cancelEdit,
    updateEditContent,
    saveEdit,
    loadProvidersAndModels,
    setInlineSystemPromptOverride,
  };
}
