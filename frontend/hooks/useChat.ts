import { useState, useCallback, useRef, useEffect } from 'react';
import { useSystemPrompts } from './useSystemPrompts';
import {
  supportsReasoningControls,
  getDraft,
  setDraft,
  clearDraft,
  convertConversationMeta,
  mergeToolOutputsToAssistantMessages,
  mergeToolCallDelta,
  isEmptyAssistantPayload,
  createGeneratedImageContentUpdate,
  buildHistoryForModel,
  prependReasoningToContent,
  formatUpstreamError,
} from '../lib';
import type {
  ChatMessage as Message,
  MessageContent,
  TextContent,
  MessageEvent,
  AudioAttachment,
  PendingState,
  EvaluationDraft,
  Conversation,
  ModelOption,
  ModelGroup,
  Status,
  QualityLevel,
  Provider,
  ChatOptionsExtended,
  CustomRequestParamPreset,
  Evaluation,
  ChatResponse,
} from '../lib';
import { conversations as conversationsApi, chat, judge, auth } from '../lib/api';
import { httpClient } from '../lib/http';
import { APIError, StreamingNotSupportedError } from '../lib/streaming';

import { useMessages } from './useMessages';
import { useModelSelection } from './useModelSelection';
import { useConversations } from './useConversations';
import { useChatStreaming } from './useChatStreaming';
import { useChatAttachments } from './useChatAttachments';
import { useChatSettings } from './useChatSettings';
import { useCompareMode } from './useCompareMode';

const SELECTED_MODEL_KEY = 'selectedModel';

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
    qualityLevel,
    qualityLevelRef,
    setQualityLevel,
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
  const draftRestoredRef = useRef(false);

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

  const updateMessageState = useCallback(
    (
      isPrimary: boolean,
      targetModel: string,
      updater: (
        current: Message | { content: MessageContent; tool_calls?: any[]; tool_outputs?: any[] }
      ) =>
        | Partial<Message>
        | Partial<{ content: MessageContent; tool_calls?: any[]; tool_outputs?: any[] }>
    ) => {
      setMessages((prev) => {
        const lastIdx = prev.length - 1;
        if (lastIdx < 0) return prev;
        const lastMsg = prev[lastIdx];
        if (!lastMsg || lastMsg.role !== 'assistant') return prev;

        if (isPrimary) {
          const updates = updater(lastMsg);
          return [...prev.slice(0, lastIdx), { ...lastMsg, ...updates }];
        } else {
          const existingRes = lastMsg.comparisonResults?.[targetModel];
          if (!existingRes) return prev;
          const updates = updater(existingRes);
          return [
            ...prev.slice(0, lastIdx),
            {
              ...lastMsg,
              comparisonResults: {
                ...lastMsg.comparisonResults,
                [targetModel]: { ...existingRes, ...updates },
              },
            },
          ];
        }
      });
    },
    [setMessages]
  );

  const executeRequest = useCallback(
    async (
      targetModel: string,
      isPrimary: boolean,
      messageId: string,
      userMessageId: string,
      messageContent: MessageContent,
      options?: {
        conversationId?: string;
        parentConversationId?: string;
        retried?: boolean;
        signal?: AbortSignal;
      }
    ) => {
      const targetConversationId = options?.conversationId;
      const parentConversationId = options?.parentConversationId;
      const actualModelId = targetModel.includes('::') ? targetModel.split('::')[1] : targetModel;

      let targetProviderId = providerIdRef.current || '';
      if (targetModel.includes('::')) {
        targetProviderId = targetModel.split('::')[0];
      } else if (modelToProviderRef.current[targetModel]) {
        targetProviderId = modelToProviderRef.current[targetModel];
      }

      const reasoning =
        qualityLevelRef.current !== 'unset' ? { effort: qualityLevelRef.current } : undefined;
      const historySource = isPrimary
        ? messagesRef.current
        : messagesRef.current.filter((m) => {
            const isEmpty =
              m.role === 'assistant' &&
              (m.content === '' || (Array.isArray(m.content) && m.content.length === 0));
            return !isEmpty && m.id !== messageId;
          });
      const history = buildHistoryForModel(historySource, targetModel, isPrimary);
      const exists = history.some((m) => m.id === userMessageId);
      const messagesPayload = exists
        ? history.map((m) => (m.id === userMessageId ? { ...m, content: messageContent } : m))
        : [...history, { id: userMessageId, role: 'user', content: messageContent }];

      if (!isPrimary) {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (!last || last.role !== 'assistant') return prev;
          return [
            ...prev.slice(0, -1),
            {
              ...last,
              comparisonResults: {
                ...last.comparisonResults,
                [targetModel]: { messageId: undefined, content: '', status: 'streaming' },
              },
            } as Message,
          ];
        });
      }

      try {
        const payload: ChatOptionsExtended = {
          messages: messagesPayload,
          model: actualModelId,
          providerId: targetProviderId,
          stream: shouldStreamRef.current,
          providerStream: providerStreamRef.current,
          requestId: isPrimary ? messageId : `${messageId}-${targetModel}`,
          signal: options?.signal || abortControllerRef.current?.signal || undefined,
          conversationId: targetConversationId,
          parentConversationId,
          streamingEnabled: shouldStreamRef.current,
          toolsEnabled: useToolsRef.current,
          tools: enabledToolsRef.current,
          qualityLevel: qualityLevelRef.current,
          reasoning,
          customRequestParamsId:
            customRequestParamsIdRef.current.length > 0 ? customRequestParamsIdRef.current : null,
          systemPrompt: systemPromptRef.current || undefined,
          activeSystemPromptId: activeSystemPromptIdRef.current || undefined,
          modelCapabilities,
          onToken: (token: string) => {
            if (
              isPrimary &&
              tokenStatsRef.current &&
              tokenStatsRef.current.messageId === messageId
            ) {
              if (tokenStatsRef.current.charCount === 0)
                tokenStatsRef.current.startTime = Date.now();
              tokenStatsRef.current.charCount += token.length;
              if (tokenStatsRef.current.isEstimate)
                tokenStatsRef.current.count = tokenStatsRef.current.charCount / 4;
              tokenStatsRef.current.lastUpdated = Date.now();
            }
            updateMessageState(isPrimary, targetModel, (current) => {
              const prev = typeof current.content === 'string' ? current.content : '';
              return { content: prev + token, provider: tokenStatsRef.current?.provider };
            });
          },
          onEvent: (event: any) => {
            if (event.type === 'text') {
              updateMessageState(isPrimary, targetModel, (current) => ({
                content: (typeof current.content === 'string' ? current.content : '') + event.value,
              }));
            } else if (event.type === 'tool_call') {
              updateMessageState(isPrimary, targetModel, (current) => ({
                tool_calls: mergeToolCallDelta(
                  current.tool_calls || [],
                  event.value,
                  typeof current.content === 'string' ? current.content.length : 0
                ),
              }));
            } else if (event.type === 'usage') {
              if (
                isPrimary &&
                tokenStatsRef.current &&
                tokenStatsRef.current.messageId === messageId &&
                event.value.completion_tokens
              ) {
                tokenStatsRef.current.count = event.value.completion_tokens;
                tokenStatsRef.current.isEstimate = false;
              }
              updateMessageState(isPrimary, targetModel, () => ({
                usage: event.value,
                provider: event.value.provider,
              }));
            } else if (event.type === 'tool_output') {
              updateMessageState(isPrimary, targetModel, (current) => ({
                tool_outputs: [...(current.tool_outputs || []), event.value],
              }));
            }
          },
        };

        let response: ChatResponse;
        try {
          response = await chat.sendMessage(payload);
        } catch (err: any) {
          if (err instanceof StreamingNotSupportedError && !options?.retried && isPrimary) {
            response = await chat.sendMessage({ ...payload, providerStream: false });
          } else {
            throw err;
          }
        }

        if (isPrimary) {
          if (response.conversation) {
            const isNew = conversationIdRef.current !== response.conversation.id;
            setConversationId(response.conversation.id);
            setCurrentConversationTitle(response.conversation.title || null);
            if (isNew)
              setConversations((prev) => [
                convertConversationMeta(response.conversation as any),
                ...prev,
              ]);
          }
          if (user?.id) clearDraft(user.id, conversationIdRef.current || '');
          conversationsApi.clearListCache();
        } else if (response.conversation?.id) {
          setLinkedConversations((prev) => ({ ...prev, [targetModel]: response.conversation!.id }));
        }

        updateMessageState(
          isPrimary,
          targetModel,
          (current) =>
            ({
              content: response.content || current.content,
              status: isPrimary ? undefined : 'complete',
              id: isPrimary
                ? response.conversation?.assistant_message_id?.toString() || messageId
                : undefined,
              messageId: isPrimary
                ? undefined
                : response.conversation?.assistant_message_id?.toString() || current.messageId,
            }) as any
        );

        return response;
      } catch (err: any) {
        let msg =
          err instanceof StreamingNotSupportedError
            ? 'Streaming not supported'
            : err instanceof APIError
              ? formatUpstreamError(err)
              : err.message;
        if (err.name === 'AbortError' || err.message === 'aborted') msg = 'Message cancelled';

        if (isPrimary) {
          setError(msg);
          setStatus('idle');
          setPending((prev) => ({ ...prev, error: msg, streaming: false }));
        } else
          updateMessageState(false, targetModel, () => ({ status: 'error', error: msg }) as any);
      }
    },
    [
      providerIdRef,
      modelToProviderRef,
      qualityLevelRef,
      messagesRef,
      setMessages,
      shouldStreamRef,
      providerStreamRef,
      useToolsRef,
      enabledToolsRef,
      customRequestParamsIdRef,
      systemPromptRef,
      activeSystemPromptIdRef,
      modelCapabilities,
      tokenStatsRef,
      updateMessageState,
      conversationIdRef,
      setConversationId,
      setCurrentConversationTitle,
      setConversations,
      user,
      setLinkedConversations,
      setStatus,
      setError,
      setPending,
      abortControllerRef,
    ]
  );

  const sendMessage = useCallback(
    async (content?: string, opts?: any) => {
      const text = content || input;
      if (!text.trim() && !images.length && !audios.length) return;

      setStatus('streaming');
      setError(null);
      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;
      const messageId = generateClientId();
      currentRequestIdRef.current = messageId;
      tokenStatsRef.current = {
        count: 0,
        charCount: 0,
        startTime: Date.now(),
        messageId,
        lastUpdated: Date.now(),
        isEstimate: true,
      };
      setPending({
        streaming: true,
        abort: abortControllerRef.current,
        tokenStats: tokenStatsRef.current,
      });

      const msgContent = await buildMessageContent(text);
      const userMsgId = opts?.clientMessageId ?? generateClientId();
      if (!opts?.skipLocalUserMessage)
        setMessages((prev) => [
          ...prev,
          { id: userMsgId, role: 'user', content: msgContent, timestamp: Date.now() },
        ]);
      setMessages((prev) => [
        ...prev,
        { id: messageId, role: 'assistant', content: '', timestamp: Date.now() },
      ]);

      setInput('');
      clearAttachments();

      const primaryModel = modelRef.current;
      const activeCompares = (opts?.comparisonModelsOverride ?? compareModels).filter(
        (m: string) => m !== primaryModel
      );

      let effId = conversationIdRef.current;
      if (!effId && activeCompares.length > 0) {
        try {
          const newConv = await conversationsApi.create({
            model: primaryModel.split('::')[1] || primaryModel,
            provider_id: providerIdRef.current || undefined,
          });
          effId = newConv.id;
          setConversationId(effId);
          setConversations((prev) => [convertConversationMeta(newConv as any), ...prev]);
        } catch (err) {
          console.warn('Upfront conv creation failed', err);
        }
      }

      if (effId && activeCompares.length > 0) {
        const p1 = executeRequest(primaryModel, true, messageId, userMsgId, msgContent, {
          conversationId: effId,
          signal,
          ...opts,
        });
        const p2 = activeCompares.map((m: string) =>
          executeRequest(m, false, messageId, userMsgId, msgContent, {
            conversationId: linkedConversationsRef.current[m],
            parentConversationId: linkedConversationsRef.current[m] ? undefined : effId,
            signal,
            ...opts,
          })
        );
        await Promise.all([p1, ...p2]);
      } else {
        const resp = await executeRequest(primaryModel, true, messageId, userMsgId, msgContent, {
          conversationId: effId || undefined,
          signal,
          ...opts,
        });
        const parentId = resp?.conversation?.id || effId;
        if (parentId)
          await Promise.all(
            activeCompares.map((m: string) =>
              executeRequest(m, false, messageId, userMsgId, msgContent, {
                conversationId: linkedConversationsRef.current[m],
                parentConversationId: linkedConversationsRef.current[m] ? undefined : parentId,
                signal,
                ...opts,
              })
            )
          );
      }

      setStatus('idle');
      setPending((prev) => ({ ...prev, streaming: false, abort: null }));
    },
    [
      input,
      images.length,
      audios.length,
      buildMessageContent,
      setStatus,
      setError,
      generateClientId,
      setPending,
      setMessages,
      setInput,
      clearAttachments,
      modelRef,
      compareModels,
      conversationIdRef,
      setConversationId,
      setConversations,
      providerIdRef,
      executeRequest,
      linkedConversationsRef,
      abortControllerRef,
    ]
  );

  const selectConversation = useCallback(
    async (id: string) => {
      try {
        setStatus('idle');
        setError(null);

        if (user?.id && conversationIdRef.current && conversationIdRef.current !== id) {
          clearDraft(user.id, conversationIdRef.current);
        }

        const data = await conversationsApi.get(id, { limit: 200, include_linked: 'messages' });

        const rawMessages: Message[] = data.messages.map((msg: any) => {
          const baseContent = (msg.content ?? '') as MessageContent;
          const reasoningText =
            msg.role === 'assistant' && Array.isArray(msg.reasoning_details)
              ? msg.reasoning_details
                  .map((d: any) => (typeof d?.text === 'string' ? d.text.trim() : ''))
                  .filter(Boolean)
                  .join('\n\n')
              : '';
          const hasEvents = Array.isArray(msg.message_events) && msg.message_events.length > 0;
          const content =
            msg.role === 'assistant' && reasoningText && !hasEvents
              ? prependReasoningToContent(baseContent, reasoningText)
              : baseContent;

          return {
            id: String(msg.id),
            role: msg.role,
            content,
            timestamp: new Date(msg.created_at).getTime(),
            tool_calls: msg.tool_calls,
            message_events: msg.message_events,
            tool_outputs: msg.tool_outputs,
            reasoning_details: msg.reasoning_details ?? undefined,
            reasoning_tokens: msg.reasoning_tokens ?? undefined,
            usage: msg.usage ?? undefined,
            provider: msg.provider ?? msg.usage?.provider ?? undefined,
          };
        });

        const convertedMessages = mergeToolOutputsToAssistantMessages(rawMessages);
        setMessages(convertedMessages);
        setEvaluations(Array.isArray((data as any).evaluations) ? (data as any).evaluations : []);
        setEvaluationDrafts([]);
        setConversationId(id);
        setCurrentConversationTitle(data.title || null);

        const rawModel = typeof data.model === 'string' ? data.model.trim() : null;
        let resolvedProvider = (data as any).provider_id || (data as any).provider || null;

        if (rawModel) {
          let finalModelValue = rawModel;
          if (rawModel.includes('::')) {
            const [p, m] = rawModel.split('::', 2);
            if (!resolvedProvider) resolvedProvider = p;
            finalModelValue = resolvedProvider ? `${resolvedProvider}::${m}` : rawModel;
          } else {
            if (!resolvedProvider) resolvedProvider = modelToProviderRef.current[rawModel];
            finalModelValue = resolvedProvider ? `${resolvedProvider}::${rawModel}` : rawModel;
          }
          setModelState(finalModelValue);
          modelRef.current = finalModelValue;
        }

        setProviderId(resolvedProvider || null);
        providerIdRef.current = resolvedProvider || null;

        if (Array.isArray((data as any).active_tools)) {
          setEnabledTools((data as any).active_tools);
          enabledToolsRef.current = (data as any).active_tools;
        }

        if (typeof data.streaming_enabled === 'boolean') {
          setShouldStream(data.streaming_enabled);
          shouldStreamRef.current = data.streaming_enabled;
          providerStreamRef.current = data.streaming_enabled;
        }
        if (typeof data.tools_enabled === 'boolean') {
          setUseTools(data.tools_enabled);
          useToolsRef.current = data.tools_enabled;
        }
        if (data.quality_level) {
          setQualityLevel(data.quality_level as QualityLevel);
          qualityLevelRef.current = data.quality_level as QualityLevel;
        }
        if ((data as any).custom_request_params_id) {
          const ids = normalizeCustomRequestParamsIds((data as any).custom_request_params_id);
          setCustomRequestParamsId(ids);
          customRequestParamsIdRef.current = ids;
        }

        const promptFromData = (data as any).system_prompt ?? null;
        if (promptFromData !== undefined) {
          setSystemPrompt(promptFromData);
          systemPromptRef.current = promptFromData;
        }
        if ((data as any).active_system_prompt_id !== undefined) {
          setActiveSystemPromptId((data as any).active_system_prompt_id);
          activeSystemPromptIdRef.current = (data as any).active_system_prompt_id;
        }

        // Linked Conversations
        if (data.linked_conversations && data.linked_conversations.length > 0) {
          const linkedMap: Record<string, string> = {};
          for (const linked of data.linked_conversations) {
            if (linked.model) {
              const rawM = String(linked.model).trim();
              const pId = typeof linked.provider_id === 'string' ? linked.provider_id.trim() : '';
              const normM = rawM.includes('::')
                ? rawM
                : pId
                  ? `${pId}::${rawM}`
                  : modelToProviderRef.current[rawM]
                    ? `${modelToProviderRef.current[rawM]}::${rawM}`
                    : rawM;
              linkedMap[normM] = linked.id;

              if (linked.messages && linked.messages.length > 0) {
                const linkedAssistants = linked.messages.filter((m: any) => m.role === 'assistant');
                setMessages((prev) => {
                  let assistantCount = 0;
                  return prev.map((m) => {
                    if (m.role !== 'assistant') return m;
                    const lMsg = linkedAssistants[assistantCount++];
                    if (!lMsg) return m;
                    return {
                      ...m,
                      comparisonResults: {
                        ...m.comparisonResults,
                        [normM]: {
                          messageId: String(lMsg.id),
                          content: lMsg.content ?? '',
                          usage: (lMsg as any).usage,
                          status: 'complete',
                          tool_calls: lMsg.tool_calls,
                          tool_outputs: lMsg.tool_outputs,
                          message_events: lMsg.message_events,
                        },
                      },
                    };
                  });
                });
              }
            }
          }
          setLinkedConversations(linkedMap);
          linkedConversationsRef.current = linkedMap;
          setCompareModels(Object.keys(linkedMap).filter((m) => m !== modelRef.current));
        } else {
          setLinkedConversations({});
          linkedConversationsRef.current = {};
          setCompareModels([]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to select conversation');
      }
    },
    [
      user?.id,
      conversationIdRef,
      setStatus,
      setError,
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
      setQualityLevel,
      qualityLevelRef,
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
    ]
  );

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
    if (user?.id && conversationIdRef.current) clearDraft(user.id, conversationIdRef.current);
    try {
      const saved = window.localStorage.getItem(SELECTED_MODEL_KEY);
      if (saved) setModelState(saved);
    } catch {
      /* ignore */
    }
  }, [
    setMessages,
    setConversationId,
    setInput,
    resetStreaming,
    cancelEdit,
    clearAttachments,
    setCurrentConversationTitle,
    setLinkedConversations,
    user?.id,
    conversationIdRef,
    setModelState,
  ]);

  const deleteConversation = useCallback(
    async (id: string) => {
      await deleteConvAction(id);
      if (id === conversationIdRef.current) newChat();
    },
    [deleteConvAction, conversationIdRef, newChat]
  );

  const regenerate = useCallback(
    async (msgs: Message[]) => {
      setMessages(msgs);
      const lastUser = msgs
        .slice()
        .reverse()
        .find((m) => m.role === 'user');
      if (lastUser)
        await sendMessage(typeof lastUser.content === 'string' ? lastUser.content : '', {
          clientMessageId: lastUser.id,
          skipLocalUserMessage: true,
        });
    },
    [setMessages, sendMessage]
  );

  const retryComparisonModel = useCallback(
    async (messageId: string, modelId: string) => {
      const assistantIdx = messagesRef.current.findIndex((m) => m.id === messageId);
      if (assistantIdx === -1) return;
      const userMsg = messagesRef.current
        .slice(0, assistantIdx)
        .reverse()
        .find((m) => m.role === 'user');
      if (!userMsg) return;
      const isPrimary = modelId === 'primary';
      const modelKey = isPrimary ? modelRef.current : modelId;
      setStatus('streaming');
      await executeRequest(modelKey, isPrimary, messageId, userMsg.id, userMsg.content, {
        conversationId: isPrimary
          ? conversationIdRef.current || undefined
          : linkedConversationsRef.current[modelKey],
        signal: abortControllerRef.current?.signal,
      });
      setStatus('idle');
    },
    [
      messagesRef,
      modelRef,
      setStatus,
      executeRequest,
      conversationIdRef,
      linkedConversationsRef,
      abortControllerRef,
    ]
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

  useEffect(() => {
    if (!user?.id || draftRestoredRef.current) return;
    const saved = getDraft(user.id, conversationIdRef.current || '');
    if (saved) setInput(saved);
    draftRestoredRef.current = true;
  }, [user?.id, conversationIdRef, setInput]);

  useEffect(() => {
    if (user?.id && input.trim()) {
      const t = setTimeout(() => setDraft(user.id!, conversationIdRef.current || '', input), 1000);
      return () => clearTimeout(t);
    }
  }, [input, user?.id, conversationIdRef]);

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
    qualityLevel,
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
      clearError();
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
    setQualityLevel: (l: QualityLevel) => {
      setQualityLevel(l);
      qualityLevelRef.current = l;
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
      clearError();
    },
    refreshUserSettings: () => user?.id && refreshSettings(user.id),
  };
}
