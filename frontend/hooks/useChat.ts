import { useState, useCallback, useRef } from 'react';
import type { MessageContent } from '../lib';

// Types
export interface PendingState {
  streaming: boolean;
  error?: string;
  abort: AbortController | null;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
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
  const [model, setModel] = useState('gpt-4');
  const [providerId, setProviderId] = useState<string | null>(null);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelGroups, setModelGroups] = useState<ModelGroup[]>([]);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [modelToProvider, setModelToProvider] = useState<Record<string, string>>({});
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
      // TODO: Fetch conversation from API
      // const data = await fetchConversation(id);
      // setMessages(data.messages);
      setConversationId(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load conversation');
    } finally {
      setLoadingConversations(false);
    }
  }, []);

  const deleteConversation = useCallback(async (id: string) => {
    try {
      // TODO: Delete from API
      // await deleteConversationAPI(id);
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
      // TODO: Fetch more conversations
      // const data = await fetchConversations(nextCursor);
      // setConversations(prev => [...prev, ...data.conversations]);
      // setNextCursor(data.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load conversations');
    } finally {
      setLoadingConversations(false);
    }
  }, [nextCursor, loadingConversations]);

  const refreshConversations = useCallback(async () => {
    try {
      setLoadingConversations(true);
      // TODO: Fetch conversations from API
      // const data = await fetchConversations();
      // setConversations(data.conversations);
      // setNextCursor(data.nextCursor);
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

      // TODO: Send message to API
      // const response = await sendMessageAPI({
      //   content: messageText,
      //   conversationId,
      //   model,
      //   images,
      //   signal: abortControllerRef.current.signal
      // });

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
  }, [input, images, conversationId, model]);

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
    if (!editingMessageId) return;

    try {
      // TODO: Save edit to API
      // await saveMessageEdit(editingMessageId, editingContent);

      setMessages(prev =>
        prev.map(m =>
          m.id === editingMessageId ? { ...m, content: editingContent } : m
        )
      );

      cancelEdit();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save edit');
    }
  }, [editingMessageId, editingContent, cancelEdit]);

  // Actions - Models & Providers
  const loadProvidersAndModels = useCallback(async () => {
    try {
      setIsLoadingModels(true);
      // TODO: Fetch from API
      // const data = await fetchModels();
      // setModelGroups(data.groups);
      // setModelOptions(data.options);
      // setModelToProvider(data.modelToProvider);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load models');
    } finally {
      setIsLoadingModels(false);
    }
  }, []);

  const setInlineSystemPromptOverride = useCallback((prompt: string | null) => {
    setSystemPrompt(prompt);
  }, []);

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
