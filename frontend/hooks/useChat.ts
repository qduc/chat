import { useState, useCallback, useEffect } from 'react';
import { useSystemPrompts } from './useSystemPrompts';
import { useDraftPersistence } from './useDraftPersistence';
import type {
  ChatMessage as Message,
  MessageContent,
  AudioAttachment,
  PendingState,
  EvaluationDraft,
  ModelOption,
  ModelGroup,
  ReasoningEffortLevel,
  Evaluation,
} from '../lib';
import { conversations as conversationsApi, judge, auth } from '../lib/api';

import { useMessages } from './useMessages';
import { useModelSelection } from './useModelSelection';
import { useConversations } from './useConversations';
import { useChatStreaming } from './useChatStreaming';
import { useChatAttachments } from './useChatAttachments';
import { useChatSettings } from './useChatSettings';
import { useCompareMode } from './useCompareMode';
import { useMessageSendPipeline } from './useMessageSendPipeline';
import { useConversationHydration } from './useConversationHydration';
export type { PendingState, EvaluationDraft };

export function useChat() {
  // --- Sub-hooks ---
  const {
    messages,
    setMessages,
    messagesRef,
    editingMessageId,
    editingContent,
    startEdit,
    cancelEdit,
    updateEditContent,
  } = useMessages();

  const {
    model,
    modelRef,
    providerId,
    providerIdRef,
    isLoadingModels,
    modelGroups,
    modelOptions,
    modelToProvider: modelToProviderMap,
    modelToProviderRef,
    modelCapabilities,
    setModelState,
    setModel,
    setProviderId,
    loadProvidersAndModels: loadModels,
    forceRefreshModels: forceRefresh,
    restoreSavedModel,
  } = useModelSelection();

  const {
    conversations,
    setConversations,
    conversationId,
    setConversationId,
    conversationIdRef,
    currentConversationTitle,
    setCurrentConversationTitle,
    nextCursor,
    loadingConversations,
    refreshConversations: refresh,
    loadMoreConversations: loadMore,
    deleteConversation: deleteConvAction,
  } = useConversations();

  const {
    status,
    setStatus,
    pending,
    setPending,
    abortControllerRef,
    currentRequestIdRef,
    tokenStatsRef,
    stopStreaming,
    resetStreaming,
  } = useChatStreaming();

  const {
    images,
    setImages,
    audios,
    setAudios,
    files,
    setFiles,
    clearAttachments,
    buildMessageContent,
  } = useChatAttachments();

  const {
    useTools,
    useToolsRef,
    setUseTools,
    enabledTools,
    enabledToolsRef,
    setEnabledTools,
    shouldStream,
    shouldStreamRef,
    providerStreamRef,
    setShouldStream,
    reasoningEffort,
    reasoningEffortRef,
    setReasoningEffort,
    customRequestParams,
    customRequestParamsId,
    customRequestParamsIdRef,
    setCustomRequestParamsId,
    activeSystemPromptId,
    activeSystemPromptIdRef,
    setActiveSystemPromptId,
    systemPrompt,
    systemPromptRef,
    setSystemPrompt,
    refreshUserSettings: refreshSettings,
  } = useChatSettings();

  const {
    compareModels,
    setCompareModels,
    linkedConversations,
    setLinkedConversations,
    linkedConversationsRef,
    evaluations,
    setEvaluations,
    evaluationDrafts,
    setEvaluationDrafts,
  } = useCompareMode();

  // --- UI State & User ---
  const [input, setInputState] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<{ id: string } | null>(null);

  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === 'undefined') return true;
    const saved = window.localStorage.getItem('sidebarCollapsed');
    return saved !== 'true';
  });
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false);

  // --- Helpers ---
  const generateClientId = useCallback(() => {
    try {
      if (typeof crypto !== 'undefined' && typeof (crypto as any).randomUUID === 'function') {
        return (crypto as any).randomUUID();
      }
    } catch {
      /* ignore */
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }, []);

  const clearError = useCallback(() => {
    setError(null);
    setPending((prev) => (prev.error ? { ...prev, error: undefined } : prev));
  }, [setPending]);

  const setInput = useCallback(
    (val: string | ((prev: string) => string)) => {
      setInputState(val);
      clearError();
    },
    [clearError]
  );

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('sidebarCollapsed', next ? 'false' : 'true');
      }
      return next;
    });
  }, []);
  const toggleRightSidebar = useCallback(() => setRightSidebarOpen((prev) => !prev), []);

  const normalizeCustomRequestParamsIds = useCallback((value: any): string[] => {
    if (!value) return [];
    if (Array.isArray(value))
      return value
        .filter((i) => typeof i === 'string')
        .map((i) => i.trim())
        .filter(Boolean);
    if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
    return [];
  }, []);

  // --- Send Pipeline (extracted) ---
  const pipelineDeps = {
    modelRef,
    providerIdRef,
    modelToProviderRef: modelToProviderRef as any,
    modelCapabilities,
    reasoningEffortRef,
    shouldStreamRef,
    providerStreamRef,
    useToolsRef,
    enabledToolsRef,
    customRequestParamsIdRef,
    systemPromptRef,
    activeSystemPromptIdRef,
    messagesRef,
    setMessages,
    abortControllerRef,
    currentRequestIdRef,
    tokenStatsRef,
    setStatus,
    setPending,
    conversationIdRef,
    setConversationId,
    setCurrentConversationTitle,
    setConversations,
    buildMessageContent,
    clearAttachments,
    linkedConversationsRef,
    setLinkedConversations,
    setError,
    user,
    generateClientId,
    setInput,
  };

  const {
    sendMessage: pipelineSendMessage,
    regenerate: pipelineRegenerate,
    retryComparisonModel,
    executeRequest,
  } = useMessageSendPipeline(pipelineDeps);

  // Wrap pipelineSendMessage so callers keep the original (content?, opts?) signature.
  // We snapshot the reactive values (input, attachment counts, compareModels) here so
  // the pipeline doesn't rely on stale closures over them.
  const sendMessage = useCallback(
    async (content?: string, opts?: any) => {
      await pipelineSendMessage(
        content,
        opts,
        input,
        { images: images.length, audios: audios.length, files: files.length },
        compareModels
      );
    },
    [pipelineSendMessage, input, images.length, audios.length, files.length, compareModels]
  );

  // --- Conversation Hydration (extracted) ---
  const hydrationDeps = {
    setStatus,
    setError,
    clearError,
    setMessages,
    setEvaluations,
    setEvaluationDrafts,
    setConversationId,
    setCurrentConversationTitle,
    modelToProviderRef,
    setModelState,
    modelRef,
    setProviderId,
    providerIdRef,
    setEnabledTools,
    enabledToolsRef,
    setShouldStream,
    shouldStreamRef,
    providerStreamRef,
    setUseTools,
    useToolsRef,
    setReasoningEffort,
    reasoningEffortRef,
    normalizeCustomRequestParamsIds,
    setCustomRequestParamsId,
    customRequestParamsIdRef,
    setSystemPrompt,
    systemPromptRef,
    setActiveSystemPromptId,
    activeSystemPromptIdRef,
    setLinkedConversations,
    linkedConversationsRef,
    setCompareModels,
  };

  const { selectConversation } = useConversationHydration(hydrationDeps);

  const judgeComparisonAction = useCallback(
    async (options: {
      messageId: string;
      selectedModelIds: string[];
      judgeModelId: string;
      criteria?: string | null;
    }) => {
      const { messageId, judgeModelId, criteria, selectedModelIds } = options;
      if (!conversationId) throw new Error('No active conversation');
      if (selectedModelIds.length < 2) throw new Error('At least 2 models must be selected');

      const primaryMessage = messagesRef.current.find((msg) => msg.id === messageId);
      const primaryModelName = modelRef.current;

      const models = selectedModelIds.map((mid) => {
        if (mid === 'primary') {
          return {
            modelId: primaryModelName,
            conversationId: conversationId,
            messageId: messageId,
          };
        } else {
          const compConvId = linkedConversationsRef.current[mid];
          const compMsgId = primaryMessage?.comparisonResults?.[mid]?.messageId;
          if (!compConvId || !compMsgId)
            throw new Error(`Missing comparison data for model ${mid}`);
          return { modelId: mid, conversationId: compConvId, messageId: compMsgId };
        }
      });

      let judgeProviderId: string | null = null;
      if (!judgeModelId.includes('::')) {
        judgeProviderId = modelToProviderRef.current[judgeModelId] || null;
      }

      const draftId = generateClientId();
      const draft: EvaluationDraft = {
        id: draftId,
        messageId,
        selectedModelIds,
        judgeModelId,
        criteria: criteria ?? null,
        content: '',
        status: 'streaming',
      };
      setEvaluationDrafts((prev) => [...prev, draft]);

      try {
        const evaluation = await judge.evaluate({
          conversationId,
          messageId,
          models,
          judgeModelId,
          judgeProviderId,
          criteria,
          onToken: (token) => {
            setEvaluationDrafts((prev) =>
              prev.map((item) =>
                item.id === draftId ? { ...item, content: `${item.content}${token}` } : item
              )
            );
          },
          onEvaluation: (evaluated) => {
            setEvaluations((prev) => {
              const idx = prev.findIndex((entry) => entry.id === evaluated.id);
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = evaluated;
                return next;
              }
              return [...prev, evaluated];
            });
          },
        });
        setEvaluations((prev) => {
          const idx = prev.findIndex((entry) => entry.id === evaluation.id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = evaluation;
            return next;
          }
          return [...prev, evaluation];
        });
        setEvaluationDrafts((prev) => prev.filter((item) => item.id !== draftId));
        return evaluation;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to judge responses';
        setEvaluationDrafts((prev) =>
          prev.map((item) =>
            item.id === draftId ? { ...item, status: 'error', error: msg } : item
          )
        );
        throw err;
      }
    },
    [
      conversationId,
      messagesRef,
      modelRef,
      linkedConversationsRef,
      modelToProviderRef,
      generateClientId,
      setEvaluationDrafts,
      setEvaluations,
    ]
  );

  const deleteJudgeAction = useCallback(
    async (id: string) => {
      try {
        await judge.deleteEvaluation(id);
        setEvaluations((prev) => prev.filter((evalItem) => evalItem.id !== id));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete judge response');
        throw err;
      }
    },
    [setEvaluations, setError]
  );

  const newChat = useCallback(() => {
    setMessages([]);
    setConversationId(null);
    setInput('');
    setError(null);
    resetStreaming();
    cancelEdit();
    clearAttachments();
    setCurrentConversationTitle(null);
    setLinkedConversations({});
    // We no longer clear the draft when starting a new chat.
    restoreSavedModel();
  }, [
    setMessages,
    setConversationId,
    setInput,
    resetStreaming,
    cancelEdit,
    clearAttachments,
    setCurrentConversationTitle,
    setLinkedConversations,
    restoreSavedModel,
    user,
  ]);

  const deleteConversation = useCallback(
    async (id: string) => {
      await deleteConvAction(id);
      if (id === conversationIdRef.current) newChat();
    },
    [deleteConvAction, conversationIdRef, newChat]
  );

  // regenerate wraps the pipeline's regenerate with current compareModels snapshot
  const regenerate = useCallback(
    async (msgs: Message[]) => {
      await pipelineRegenerate(msgs, compareModels);
    },
    [pipelineRegenerate, compareModels]
  );

  const saveEdit = useCallback(async () => {
    if (!editingMessageId || !conversationIdRef.current) return;
    const result = await conversationsApi.editMessage(
      conversationIdRef.current,
      editingMessageId,
      editingContent
    );
    setMessages((prev) =>
      prev.map((m) => (m.id === editingMessageId ? { ...m, content: editingContent } : m))
    );
    if (result.new_conversation_id !== conversationIdRef.current) {
      setConversationId(result.new_conversation_id);
      setLinkedConversations({});
      setCompareModels([]);
      setMessages((prev) =>
        prev.map((m) => (m.comparisonResults ? { ...m, comparisonResults: undefined } : m))
      );
    }
    cancelEdit();
  }, [
    editingMessageId,
    conversationIdRef,
    editingContent,
    setMessages,
    setConversationId,
    setLinkedConversations,
    setCompareModels,
    cancelEdit,
  ]);

  // Effects
  useEffect(() => {
    const loadU = async () => {
      try {
        const profile = await auth.getProfile();
        setUser({ id: profile.id });
      } catch {
        /* ignore */
      }
    };
    loadU();
  }, []);

  useEffect(() => {
    if (user?.id) refreshSettings(user.id);
  }, [refreshSettings, user?.id]);
  useEffect(() => {
    loadModels();
  }, [loadModels]);

  useDraftPersistence(user?.id, conversationId, input, setInput);

  // Use system prompts hook
  const { prompts: systemPrompts, loading: systemPromptsLoading } = useSystemPrompts(user?.id);

  return {
    messages,
    conversations,
    conversationId,
    status,
    input,
    error,
    pending,
    model,
    providerId,
    user,
    modelGroups: modelGroups as ModelGroup[],
    modelOptions: modelOptions as ModelOption[],
    modelToProvider: modelToProviderMap,
    modelCapabilities,
    isLoadingModels,
    currentConversationTitle,
    editingMessageId,
    editingContent,
    images,
    audios,
    files,
    systemPrompt,
    activeSystemPromptId,
    systemPrompts,
    systemPromptsLoading,
    compareModels,
    linkedConversations,
    customRequestParams,
    evaluations,
    evaluationDrafts,
    shouldStream,
    useTools,
    enabledTools,
    reasoningEffort,
    customRequestParamsId,
    nextCursor,
    loadingConversations,
    historyEnabled: !!user,
    sidebarCollapsed: !sidebarOpen,
    rightSidebarCollapsed: !rightSidebarOpen,
    compareMode: compareModels.length > 0,
    setMessages,
    setInput,
    setModel,
    setProviderId: (id: string | null) => {
      setProviderId(id);
      providerIdRef.current = id;
    },
    setUseTools: (v: boolean) => {
      setUseTools(v);
      useToolsRef.current = v;
      clearError();
    },
    setEnabledTools: (t: string[]) => {
      setEnabledTools(t);
      enabledToolsRef.current = t;
      clearError();
    },
    setShouldStream: (v: boolean) => {
      setShouldStream(v);
      shouldStreamRef.current = v;
      providerStreamRef.current = v;
      clearError();
    },
    setReasoningEffort: (l: ReasoningEffortLevel) => {
      setReasoningEffort(l);
      reasoningEffortRef.current = l;
      clearError();
    },
    setCustomRequestParamsId: (ids: string[] | null) => {
      const n = ids || [];
      setCustomRequestParamsId(n);
      customRequestParamsIdRef.current = n;
      clearError();
    },
    setImages: (i: any[]) => {
      setImages(i);
      clearError();
    },
    setAudios: (a: AudioAttachment[]) => {
      setAudios(a);
      clearError();
    },
    setFiles: (f: any[]) => {
      setFiles(f);
      clearError();
    },
    setActiveSystemPromptId: (id: string | null | undefined) => {
      setActiveSystemPromptId(id);
      activeSystemPromptIdRef.current = id;
      clearError();
    },
    setCompareModels: (m: string[]) => {
      const normalized = Array.from(
        new Set(
          m.map((mid) => {
            if (mid.includes('::')) return mid;
            const p = modelToProviderRef.current[mid];
            return p ? `${p}::${mid}` : mid;
          })
        )
      );
      setCompareModels(normalized);
      clearError();
    },
    toggleSidebar,
    toggleRightSidebar,
    selectConversation,
    deleteConversation,
    loadMoreConversations: loadMore,
    refreshConversations: refresh,
    newChat,
    sendMessage,
    stopStreaming,
    regenerate,
    retryComparisonModel,
    judgeComparison: judgeComparisonAction,
    deleteJudgeResponse: deleteJudgeAction,
    clearError,
    startEdit,
    cancelEdit,
    updateEditContent,
    saveEdit,
    loadProvidersAndModels: loadModels,
    forceRefreshModels: forceRefresh,
    setInlineSystemPromptOverride: (p: string | null) => {
      setSystemPrompt(p);
      systemPromptRef.current = p;
    },
    refreshUserSettings: () => user?.id && refreshSettings(user.id),
  };
}
