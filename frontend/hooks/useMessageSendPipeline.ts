import {
  useCallback,
  useEffect,
  useRef,
  type MutableRefObject,
  type Dispatch,
  type SetStateAction,
} from 'react';
import {
  clearDraft,
  convertConversationMeta,
  mergeToolCallDelta,
  buildHistoryForModel,
  formatUpstreamError,
  MessageEventAccumulator,
} from '../lib';
import type {
  ChatMessage as Message,
  Conversation,
  ConversationBranch,
  MessageContent,
  ChatOptionsExtended,
  ChatResponse,
  PendingState,
  Status,
} from '../lib';
import { conversations as conversationsApi, chat } from '../lib/api';
import { APIError, StreamingNotSupportedError } from '../lib/streaming';

const STREAMING_TEXT_FLUSH_INTERVAL_MS = 40;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ComparisonResult = NonNullable<Message['comparisonResults']>[string];

/** Refs and setters that the pipeline needs from surrounding hooks. */
export interface SendPipelineDeps {
  // -- Model / provider refs --
  modelRef: MutableRefObject<string>;
  providerIdRef: MutableRefObject<string | null>;
  modelToProviderRef: MutableRefObject<Record<string, string>>;
  modelCapabilities: Record<string, boolean>;

  // -- Settings refs --
  reasoningEffortRef: MutableRefObject<string>;
  shouldStreamRef: MutableRefObject<boolean>;
  providerStreamRef: MutableRefObject<boolean>;
  useToolsRef: MutableRefObject<boolean>;
  enabledToolsRef: MutableRefObject<string[]>;
  customRequestParamsIdRef: MutableRefObject<string[]>;
  systemPromptRef: MutableRefObject<string | null>;
  activeSystemPromptIdRef: MutableRefObject<string | null | undefined>;

  // -- Messages --
  messagesRef: MutableRefObject<Message[]>;
  setMessages: Dispatch<SetStateAction<Message[]>>;

  // -- Streaming --
  abortControllerRef: MutableRefObject<AbortController | null>;
  currentRequestIdRef: MutableRefObject<string | null>;
  tokenStatsRef: MutableRefObject<{
    count: number;
    charCount: number;
    startTime: number;
    messageId: string;
    lastUpdated: number;
    provider?: string | null;
    model?: string;
    isEstimate: boolean;
    activeGenerationMs?: number;
    lastActivityStartedAt?: number | null;
    activeToolCalls?: number;
    durationMsOverride?: number;
    baseCompletionTokens?: number;
    baseCompletionMs?: number;
  } | null>;
  setStatus: Dispatch<SetStateAction<Status>>;
  setPending: Dispatch<SetStateAction<PendingState>>;

  // -- Conversations --
  conversationIdRef: MutableRefObject<string | null>;
  setConversationId: (id: string | null) => void;
  setCurrentConversationTitle: (title: string | null) => void;
  setConversations: Dispatch<SetStateAction<Conversation[]>>;
  setActiveBranchId: (id: string | null) => void;
  activeBranchIdRef: MutableRefObject<string | null>;
  setBranches: Dispatch<SetStateAction<ConversationBranch[]>>;

  // -- Attachments --
  buildMessageContent: (text: string) => Promise<MessageContent>;
  clearAttachments: () => void;

  // -- Compare mode --
  linkedConversationsRef: MutableRefObject<Record<string, string>>;
  setLinkedConversations: Dispatch<SetStateAction<Record<string, string>>>;

  // -- Error --
  setError: (msg: string | null) => void;

  // -- User --
  user: { id: string } | null;

  // -- UI helpers --
  generateClientId: () => string;
  setInput: (val: string | ((prev: string) => string)) => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useMessageSendPipeline(deps: SendPipelineDeps) {
  const {
    modelRef,
    providerIdRef,
    modelToProviderRef,
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
    setActiveBranchId,
    activeBranchIdRef,
    setBranches,
    buildMessageContent,
    clearAttachments,
    linkedConversationsRef,
    setLinkedConversations,
    setError,
    user,
    generateClientId,
    setInput,
  } = deps;

  const bufferedStreamingTextRef = useRef<
    Record<
      string,
      {
        assistantMessageId: string;
        isPrimary: boolean;
        targetModel: string;
        text: string;
        message_events: any[];
        provider?: string | null;
        model?: string;
        timeoutId: ReturnType<typeof setTimeout> | null;
      }
    >
  >({});

  // ---------------------------------------------------------------------------
  // updateMessageState – thin helper to update the last assistant message
  // ---------------------------------------------------------------------------
  const updateMessageState = useCallback(
    (
      isPrimary: boolean,
      assistantMessageId: string,
      targetModel: string,
      updater: (current: Message | ComparisonResult) => Partial<Message> | Partial<ComparisonResult>
    ) => {
      setMessages((prev) => {
        let messageIdx = prev.findIndex((message) => message.id === assistantMessageId);
        if (messageIdx < 0 && !isPrimary) {
          // Primary completion can replace the placeholder assistant id while comparison
          // requests are still in-flight; recover by targeting the active comparison slot.
          messageIdx = prev.findIndex(
            (message) =>
              message.role === 'assistant' &&
              message.comparisonResults?.[targetModel]?.status === 'streaming'
          );
        }
        if (messageIdx < 0) return prev;
        const lastMsg = prev[messageIdx];
        if (!lastMsg || lastMsg.role !== 'assistant') return prev;

        if (isPrimary) {
          const updates = updater(lastMsg) as Partial<Message>;
          return [
            ...prev.slice(0, messageIdx),
            { ...lastMsg, ...updates },
            ...prev.slice(messageIdx + 1),
          ];
        } else {
          const existingRes = lastMsg.comparisonResults?.[targetModel];
          if (!existingRes) return prev;
          const updates = updater(existingRes) as Partial<ComparisonResult>;
          return [
            ...prev.slice(0, messageIdx),
            {
              ...lastMsg,
              comparisonResults: {
                ...lastMsg.comparisonResults,
                [targetModel]: { ...existingRes, ...updates },
              },
            },
            ...prev.slice(messageIdx + 1),
          ];
        }
      });
    },
    [setMessages]
  );

  const getBufferedStreamKey = useCallback(
    (assistantMessageId: string, targetModel: string, isPrimary: boolean) =>
      `${assistantMessageId}::${isPrimary ? '__primary__' : targetModel}`,
    []
  );

  const flushBufferedStreamingText = useCallback(
    (
      assistantMessageId: string,
      targetModel: string,
      isPrimary: boolean,
      options?: { cancelScheduledTimeout?: boolean }
    ) => {
      const bufferKey = getBufferedStreamKey(assistantMessageId, targetModel, isPrimary);
      const entry = bufferedStreamingTextRef.current[bufferKey];
      if (!entry) return;

      if (options?.cancelScheduledTimeout !== false && entry.timeoutId != null) {
        clearTimeout(entry.timeoutId);
      }
      entry.timeoutId = null;

      const pendingText = entry.text;
      const pendingEvents = [...entry.message_events];

      if (!pendingText && pendingEvents.length === 0) {
        delete bufferedStreamingTextRef.current[bufferKey];
        return;
      }

      updateMessageState(isPrimary, assistantMessageId, targetModel, (current) => {
        const prev = typeof current.content === 'string' ? current.content : '';
        const prevEvents = (current as any).message_events || [];
        // Use a new accumulator to merge the pending events into existing ones
        const accumulator = new MessageEventAccumulator({ initialEvents: prevEvents });
        for (const ev of pendingEvents) {
          accumulator.addEvent(ev.type, ev.payload);
        }

        return {
          content: prev + pendingText,
          message_events: accumulator.getEvents(),
          provider: (current as any).provider || entry.provider,
          model: (current as any).model || entry.model,
        };
      });

      entry.text = '';
      entry.message_events = [];

      if (!entry.text && entry.message_events.length === 0 && entry.timeoutId == null) {
        delete bufferedStreamingTextRef.current[bufferKey];
      }
    },
    [getBufferedStreamKey, tokenStatsRef, updateMessageState]
  );

  const queueBufferedStreamingText = useCallback(
    (
      isPrimary: boolean,
      assistantMessageId: string,
      targetModel: string,
      text: string,
      provider?: string | null,
      model?: string,
      event?: any
    ) => {
      if (!text && !event) return;

      const bufferKey = getBufferedStreamKey(assistantMessageId, targetModel, isPrimary);
      const existing = bufferedStreamingTextRef.current[bufferKey];
      const entry =
        existing ||
        (bufferedStreamingTextRef.current[bufferKey] = {
          assistantMessageId,
          isPrimary,
          targetModel,
          text: '',
          message_events: [],
          provider,
          model,
          timeoutId: null,
        });

      if (text) entry.text += text;
      if (event) entry.message_events.push(event);

      if (entry.timeoutId != null) {
        return;
      }

      entry.timeoutId = setTimeout(() => {
        const scheduledEntry = bufferedStreamingTextRef.current[bufferKey];
        if (!scheduledEntry) return;
        scheduledEntry.timeoutId = null;
        flushBufferedStreamingText(assistantMessageId, targetModel, isPrimary, {
          cancelScheduledTimeout: false,
        });
      }, STREAMING_TEXT_FLUSH_INTERVAL_MS);
    },
    [flushBufferedStreamingText, getBufferedStreamKey]
  );

  useEffect(() => {
    return () => {
      Object.values(bufferedStreamingTextRef.current).forEach((entry) => {
        if (entry.timeoutId != null) {
          clearTimeout(entry.timeoutId);
        }
      });
      bufferedStreamingTextRef.current = {};
    };
  }, []);

  const pauseTokenEstimateClock = useCallback(() => {
    const stats = tokenStatsRef.current;
    if (!stats) return;
    const now = Date.now();
    const startedAt = stats.lastActivityStartedAt;
    if (typeof startedAt === 'number') {
      stats.activeGenerationMs = (stats.activeGenerationMs || 0) + Math.max(0, now - startedAt);
      stats.lastActivityStartedAt = null;
      stats.lastUpdated = now;
    }
  }, [tokenStatsRef]);

  const resumeTokenEstimateClock = useCallback(() => {
    const stats = tokenStatsRef.current;
    if (!stats) return;
    if (typeof stats.lastActivityStartedAt === 'number') return;
    const now = Date.now();
    stats.lastActivityStartedAt = now;
    stats.lastUpdated = now;
  }, [tokenStatsRef]);

  const addEstimatedOutputChars = useCallback(
    (messageId: string, charDelta: number) => {
      if (!Number.isFinite(charDelta) || charDelta <= 0) return;
      const stats = tokenStatsRef.current;
      if (!stats || stats.messageId !== messageId) return;

      stats.charCount += charDelta;
      if (stats.isEstimate) {
        stats.count = (stats.baseCompletionTokens || 0) + stats.charCount / 4;
      }
      stats.lastUpdated = Date.now();
    },
    [tokenStatsRef]
  );

  const refreshBranchState = useCallback(
    async (
      conversationId: string,
      options?: {
        userMessageClientId?: string;
        userMessageDbId?: string | number | null;
        assistantMessageId?: string;
      }
    ) => {
      if (typeof conversationsApi.getBranches !== 'function') return;
      try {
        const branchData = await conversationsApi.getBranches(conversationId);
        const activeBranch = branchData.active_branch_id ?? null;
        setActiveBranchId(activeBranch);
        setBranches(Array.isArray(branchData.branches) ? branchData.branches : []);

        const resolvedUserMessageDbId =
          typeof options?.userMessageDbId === 'number'
            ? options.userMessageDbId
            : typeof options?.userMessageDbId === 'string' && /^\d+$/.test(options.userMessageDbId)
              ? Number(options.userMessageDbId)
              : null;

        // Stamp branch_id and _parentMessageId on messages that are missing them
        // so the branch switcher can render without a full page reload.
        if (activeBranch) {
          setMessages((prev) => {
            const needsUpdate = prev.some(
              (m) =>
                !m.branch_id ||
                (m.role === 'user' &&
                  m.id === options?.userMessageClientId &&
                  resolvedUserMessageDbId != null &&
                  m._dbId !== resolvedUserMessageDbId) ||
                (m.role === 'assistant' &&
                  m.id === options?.assistantMessageId &&
                  (m._parentMessageId == null ||
                    !Object.prototype.hasOwnProperty.call(m, '_parentMessageId')))
            );
            if (!needsUpdate) return prev;
            let lastUserDbId: number | null = null;
            let changed = false;

            const nextMessages = prev.map((m) => {
              let nextMessage = m;

              if (m.role === 'user') {
                const patchedDbId =
                  m.id === options?.userMessageClientId && resolvedUserMessageDbId != null
                    ? resolvedUserMessageDbId
                    : typeof m._dbId === 'number'
                      ? m._dbId
                      : null;

                if (
                  m.id === options?.userMessageClientId &&
                  resolvedUserMessageDbId != null &&
                  m._dbId !== resolvedUserMessageDbId
                ) {
                  nextMessage = { ...nextMessage, _dbId: resolvedUserMessageDbId };
                  changed = true;
                }

                lastUserDbId = patchedDbId;
              }

              const needsBranchId = !nextMessage.branch_id;
              const hasParentMessageId = Object.prototype.hasOwnProperty.call(
                nextMessage,
                '_parentMessageId'
              );
              const needsAssistantParentBackfill =
                nextMessage.role === 'assistant' &&
                nextMessage.id === options?.assistantMessageId &&
                nextMessage._parentMessageId == null &&
                lastUserDbId != null;

              if (!needsBranchId && hasParentMessageId && !needsAssistantParentBackfill) {
                return nextMessage;
              }

              const parentId =
                nextMessage.role === 'user'
                  ? typeof nextMessage._parentMessageId === 'number' ||
                    nextMessage._parentMessageId === null
                    ? nextMessage._parentMessageId
                    : null
                  : lastUserDbId;

              changed = true;
              nextMessage = {
                ...nextMessage,
                ...(needsBranchId ? { branch_id: activeBranch } : {}),
                ...(!hasParentMessageId || needsAssistantParentBackfill
                  ? { _parentMessageId: parentId }
                  : {}),
              };

              return nextMessage;
            });

            return changed ? nextMessages : prev;
          });
        }
      } catch {
        // Ignore branch refresh errors and keep the message update path responsive.
      }
    },
    [setActiveBranchId, setBranches, setMessages]
  );

  // ---------------------------------------------------------------------------
  // executeRequest – send a single model request, handle streaming callbacks
  // ---------------------------------------------------------------------------
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
        noRevisionBranch?: boolean;
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
      if (isPrimary && tokenStatsRef.current) {
        tokenStatsRef.current.provider = targetProviderId;
        tokenStatsRef.current.model = actualModelId;
      }

      const reasoning =
        reasoningEffortRef.current !== 'unset' ? { effort: reasoningEffortRef.current } : undefined;
      const accumulator = new MessageEventAccumulator();
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

      if (isPrimary) {
        setPending((prev) => ({ ...prev, streaming: true }));
      } else {
        setMessages((prev) => {
          const targetIdx = prev.findIndex((m) => m.id === messageId);
          if (targetIdx < 0) return prev;
          const targetMessage = prev[targetIdx];
          if (!targetMessage || targetMessage.role !== 'assistant') return prev;
          return [
            ...prev.slice(0, targetIdx),
            {
              ...targetMessage,
              comparisonResults: {
                ...targetMessage.comparisonResults,
                [targetModel]: { messageId: undefined, content: '', status: 'streaming' },
              },
            } as Message,
            ...prev.slice(targetIdx + 1),
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
          branchId: isPrimary ? activeBranchIdRef.current : null,
          parentConversationId,
          streamingEnabled: shouldStreamRef.current,
          toolsEnabled: useToolsRef.current,
          tools: enabledToolsRef.current,
          reasoning,
          customRequestParamsId:
            customRequestParamsIdRef.current.length > 0 ? customRequestParamsIdRef.current : null,
          systemPrompt: systemPromptRef.current || undefined,
          activeSystemPromptId: activeSystemPromptIdRef.current || undefined,
          modelCapabilities,
          noRevisionBranch: options?.noRevisionBranch === true || undefined,
          onToken: (token: string) => {
            if (
              isPrimary &&
              tokenStatsRef.current &&
              tokenStatsRef.current.messageId === messageId
            ) {
              resumeTokenEstimateClock();
              addEstimatedOutputChars(messageId, token.length);
            }
            queueBufferedStreamingText(
              isPrimary,
              messageId,
              targetModel,
              token,
              targetProviderId,
              actualModelId
            );
          },
          onEvent: (event: any) => {
            const clearRetryStatusIfCurrentModel = () => {
              setPending((prev) => {
                if (!prev.retryStatus) return prev;
                if (
                  (prev.retryStatus.modelId ?? 'primary') !== (isPrimary ? 'primary' : targetModel)
                ) {
                  return prev;
                }
                return { ...prev, retryStatus: undefined };
              });
            };

            if (event.type === 'text') {
              if (isPrimary && typeof event.value === 'string') {
                resumeTokenEstimateClock();
                addEstimatedOutputChars(messageId, event.value.length);
              }
              queueBufferedStreamingText(
                isPrimary,
                messageId,
                targetModel,
                event.value,
                targetProviderId,
                actualModelId
              );
              clearRetryStatusIfCurrentModel();
            } else if (event.type === 'reasoning') {
              if (isPrimary && typeof event.value === 'string') {
                resumeTokenEstimateClock();
                addEstimatedOutputChars(messageId, event.value.length);
              }
              clearRetryStatusIfCurrentModel();
            } else if (event.type === 'message_event') {
              // Accumulate structured message events (defensively handle legacy batched payloads)
              const messageEvents = Array.isArray(event.value) ? event.value : [event.value];
              for (const messageEvent of messageEvents) {
                if (!messageEvent) continue;
                queueBufferedStreamingText(
                  isPrimary,
                  messageId,
                  targetModel,
                  '',
                  targetProviderId,
                  actualModelId,
                  messageEvent
                );
              }
              clearRetryStatusIfCurrentModel();
            } else if (event.type === 'retry_status') {
              setPending((prev) => ({
                ...prev,
                streaming: true,
                retryStatus: {
                  ...(event.value || {}),
                  // Normalize to frontend slot ids so retry UI can bind reliably.
                  // Providers may emit raw model ids (e.g. "gemini-3.1-pro-preview")
                  // while the primary column is keyed as "primary" and comparison
                  // columns are keyed by `targetModel` (often provider-prefixed).
                  modelId: isPrimary ? 'primary' : targetModel,
                },
              }));
            } else if (event.type === 'conversation') {
              flushBufferedStreamingText(messageId, targetModel, isPrimary);
              clearRetryStatusIfCurrentModel();
              if (isPrimary && event.value) {
                const c = event.value;
                if (!conversationIdRef.current || conversationIdRef.current === c.id) {
                  if (!conversationIdRef.current) {
                    setConversationId(c.id);
                  }
                  setCurrentConversationTitle(c.title || null);
                  if (typeof c.active_branch_id === 'string' && c.active_branch_id) {
                    setActiveBranchId(c.active_branch_id);
                  }
                  setConversations((prev) => {
                    if (prev.some((curr) => curr.id === c.id)) {
                      return prev.map((curr) =>
                        curr.id === c.id ? { ...curr, title: c.title || '' } : curr
                      );
                    }
                    return [
                      {
                        id: c.id,
                        title: c.title || '',
                        created_at: c.created_at,
                        updatedAt: c.created_at,
                      },
                      ...prev,
                    ];
                  });
                }
              }
            } else if (event.type === 'tool_call') {
              flushBufferedStreamingText(messageId, targetModel, isPrimary);
              clearRetryStatusIfCurrentModel();
              if (
                isPrimary &&
                tokenStatsRef.current &&
                tokenStatsRef.current.messageId === messageId
              ) {
                tokenStatsRef.current.activeToolCalls =
                  (tokenStatsRef.current.activeToolCalls || 0) + 1;
                pauseTokenEstimateClock();
              }
              updateMessageState(isPrimary, messageId, targetModel, (current) => ({
                tool_calls: mergeToolCallDelta(
                  current.tool_calls || [],
                  event.value,
                  typeof current.content === 'string' ? current.content.length : 0
                ),
              }));
            } else if (event.type === 'usage') {
              flushBufferedStreamingText(messageId, targetModel, isPrimary);
              clearRetryStatusIfCurrentModel();
              // Update stats for the progress bar / stats row
              if (
                isPrimary &&
                tokenStatsRef.current &&
                tokenStatsRef.current.messageId === messageId
              ) {
                const base = tokenStatsRef.current.baseCompletionTokens || 0;
                if (event.value.completion_tokens !== undefined) {
                  tokenStatsRef.current.count = base + event.value.completion_tokens;
                }
                if (event.value.provider) {
                  tokenStatsRef.current.provider = event.value.provider;
                }
                if (event.value.model) {
                  tokenStatsRef.current.model = event.value.model;
                }
                tokenStatsRef.current.isEstimate = false;
                tokenStatsRef.current.lastUpdated = Date.now();

                if (event.value.completion_ms !== undefined) {
                  const baseMs = tokenStatsRef.current.baseCompletionMs || 0;
                  tokenStatsRef.current.durationMsOverride = baseMs + event.value.completion_ms;
                }
              }

              updateMessageState(isPrimary, messageId, targetModel, (prev) => ({
                usage: { ...(prev as any).usage, ...event.value },
                provider: event.value.provider || (prev as any).provider,
                model: event.value.model || (prev as any).model,
              }));
            } else if (event.type === 'tool_output') {
              flushBufferedStreamingText(messageId, targetModel, isPrimary);
              clearRetryStatusIfCurrentModel();
              if (
                isPrimary &&
                tokenStatsRef.current &&
                tokenStatsRef.current.messageId === messageId
              ) {
                const prevActiveCalls = tokenStatsRef.current.activeToolCalls || 0;
                const activeCalls = Math.max(0, prevActiveCalls - 1);
                tokenStatsRef.current.activeToolCalls = activeCalls;
                if (activeCalls === 0 && prevActiveCalls > 0) {
                  const stats = tokenStatsRef.current;
                  stats.baseCompletionTokens = stats.count || 0;
                  stats.baseCompletionMs = stats.durationMsOverride || 0;
                  stats.charCount = 0;
                  stats.isEstimate = true;
                  stats.durationMsOverride = undefined;
                  resumeTokenEstimateClock();
                }
              }
              updateMessageState(isPrimary, messageId, targetModel, (current) => ({
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
            flushBufferedStreamingText(messageId, targetModel, isPrimary);
            response = await chat.sendMessage({ ...payload, providerStream: false });
          } else {
            throw err;
          }
        }

        flushBufferedStreamingText(messageId, targetModel, isPrimary);
        if (isPrimary) {
          pauseTokenEstimateClock();
        }

        if (isPrimary) {
          if (response.conversation) {
            const isNew = conversationIdRef.current !== response.conversation.id;
            setConversationId(response.conversation.id);
            setCurrentConversationTitle(response.conversation.title || null);
            await refreshBranchState(response.conversation.id, {
              userMessageClientId: userMessageId,
              userMessageDbId: response.conversation.user_message_id,
              assistantMessageId: messageId,
            });
            if (isNew)
              setConversations((prev) => {
                if (prev.some((c) => c.id === response.conversation!.id)) return prev;
                return [convertConversationMeta(response.conversation as any), ...prev];
              });
          }
          if (user?.id) clearDraft(user.id, conversationIdRef.current || '');
          conversationsApi.clearListCache();
        } else if (response.conversation?.id) {
          setLinkedConversations((prev) => ({ ...prev, [targetModel]: response.conversation!.id }));
        }

        updateMessageState(
          isPrimary,
          messageId,
          targetModel,
          (current: any) =>
            ({
              content: response.content || current.content,
              message_events:
                (response as any).message_events ||
                (current as any).message_events ||
                accumulator.getEvents(),
              status: isPrimary ? undefined : 'complete',
              id: isPrimary
                ? response.conversation?.assistant_message_id?.toString() || messageId
                : undefined,
              regenerate_revision_count: isPrimary
                ? (response.conversation?.regenerate_revision_count ?? undefined)
                : undefined,
              anchor_user_message_id: isPrimary
                ? (response.conversation?.regenerate_anchor_message_id ?? undefined)
                : undefined,
              messageId: isPrimary
                ? undefined
                : response.conversation?.assistant_message_id?.toString() ||
                  (current as any).messageId,
            }) as any
        );
        if (isPrimary) {
          setPending((prev) => ({ ...prev, streaming: false }));
        }

        return response;
      } catch (err: any) {
        flushBufferedStreamingText(messageId, targetModel, isPrimary);
        if (isPrimary) {
          pauseTokenEstimateClock();
        }

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
          setPending((prev) => ({ ...prev, error: msg, streaming: false, retryStatus: undefined }));
        } else
          updateMessageState(
            false,
            messageId,
            targetModel,
            () => ({ status: 'error', error: msg }) as any
          );
      }
    },
    [
      providerIdRef,
      modelToProviderRef,
      reasoningEffortRef,
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
      addEstimatedOutputChars,
      pauseTokenEstimateClock,
      resumeTokenEstimateClock,
      updateMessageState,
      queueBufferedStreamingText,
      flushBufferedStreamingText,
      activeBranchIdRef,
      conversationIdRef,
      setConversationId,
      setCurrentConversationTitle,
      setConversations,
      setActiveBranchId,
      user,
      setLinkedConversations,
      setStatus,
      setError,
      setPending,
      abortControllerRef,
      refreshBranchState,
    ]
  );

  // ---------------------------------------------------------------------------
  // sendMessage – main entry-point: build content, orchestrate requests
  // ---------------------------------------------------------------------------
  const sendMessage = useCallback(
    async (
      content?: string,
      opts?: any,
      /** Snapshot of current input value (avoids stale-closure on `input` state). */
      currentInput?: string,
      /** Current attachment counts so the gate check works without stale closures. */
      attachmentCounts?: { images: number; audios: number; files: number },
      /** Active comparison models (snapshot to avoid stale closure). */
      compareModels?: string[],
      /** Prebuilt message content to bypass attachment processing */
      overriddenMessageContent?: MessageContent
    ) => {
      let msgContent: MessageContent;

      if (overriddenMessageContent !== undefined) {
        msgContent = overriddenMessageContent;
      } else {
        const text = content || currentInput || '';
        const counts = attachmentCounts || { images: 0, audios: 0, files: 0 };
        if (!text.trim() && !counts.images && !counts.audios && !counts.files) return;

        try {
          msgContent = await buildMessageContent(text);
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to prepare attachments';
          setError(msg);
          setStatus('idle');
          setPending((prev) => ({ ...prev, error: msg, streaming: false, abort: null }));
          return;
        }
      }

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
        activeGenerationMs: 0,
        lastActivityStartedAt: Date.now(),
        activeToolCalls: 0,
        durationMsOverride: undefined,
        baseCompletionTokens: 0,
        baseCompletionMs: 0,
      };
      setPending({
        streaming: true,
        abort: abortControllerRef.current,
        tokenStats: tokenStatsRef.current,
        retryStatus: undefined,
      });

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
      const activeCompares = (opts?.comparisonModelsOverride ?? compareModels ?? []).filter(
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

      let primaryResponse: ChatResponse | undefined;

      if (effId && activeCompares.length > 0) {
        const p1 = executeRequest(primaryModel, true, messageId, userMsgId, msgContent, {
          conversationId: effId,
          signal,
          noRevisionBranch: true,
          ...opts,
        });
        const p2 = activeCompares.map((m: string) =>
          executeRequest(m, false, messageId, userMsgId, msgContent, {
            conversationId: linkedConversationsRef.current[m],
            parentConversationId: linkedConversationsRef.current[m] ? undefined : effId,
            signal,
            noRevisionBranch: true,
            ...opts,
          })
        );
        const [resp] = await Promise.all([p1, ...p2]);
        primaryResponse = resp;
      } else {
        const resp = await executeRequest(primaryModel, true, messageId, userMsgId, msgContent, {
          conversationId: effId || undefined,
          signal,
          ...opts,
        });
        primaryResponse = resp;
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

      if (primaryResponse?.conversation) {
        const c = primaryResponse.conversation;
        if (!c.title || c.title === 'Untitled conversation' || c.title === 'New conversation') {
          setTimeout(async () => {
            if (conversationIdRef.current === c.id) {
              try {
                const updated = await conversationsApi.get(c.id, { limit: 1 });
                if (updated.title && updated.title !== c.title) {
                  setCurrentConversationTitle(updated.title);
                  setConversations((prev) =>
                    prev.map((cur) =>
                      cur.id === c.id ? { ...cur, title: updated.title || '' } : cur
                    )
                  );
                }
              } catch (e) {
                /* ignore */
              }
            }
          }, 3000);
        }
      }

      setStatus('idle');
      setPending((prev) => ({ ...prev, streaming: false, abort: null, retryStatus: undefined }));
      return primaryResponse;
    },
    [
      buildMessageContent,
      setStatus,
      setError,
      generateClientId,
      setPending,
      setMessages,
      setInput,
      clearAttachments,
      modelRef,
      conversationIdRef,
      setConversationId,
      setConversations,
      providerIdRef,
      executeRequest,
      linkedConversationsRef,
      abortControllerRef,
      currentRequestIdRef,
      setCurrentConversationTitle,
      tokenStatsRef,
    ]
  );

  // ---------------------------------------------------------------------------
  // regenerate – resubmit the last user message
  // ---------------------------------------------------------------------------
  const regenerate = useCallback(
    async (msgs: Message[], compareModels: string[]) => {
      setMessages(msgs);
      const lastUser = msgs
        .slice()
        .reverse()
        .find((m) => m.role === 'user');
      if (lastUser)
        return sendMessage(
          typeof lastUser.content === 'string' ? lastUser.content : '',
          {
            clientMessageId: lastUser.id,
            skipLocalUserMessage: true,
          },
          '', // currentInput – unused because content is explicit
          { images: 0, audios: 0, files: 0 },
          compareModels,
          lastUser.content
        );
      return undefined;
    },
    [setMessages, sendMessage]
  );

  // ---------------------------------------------------------------------------
  // retryComparisonModel – retry a single model in comparison mode
  // ---------------------------------------------------------------------------
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
      if (isPrimary) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  content: '',
                  tool_calls: undefined,
                  tool_outputs: undefined,
                  message_events: undefined,
                  usage: undefined,
                }
              : m
          )
        );
      }
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
      setMessages,
      executeRequest,
      conversationIdRef,
      linkedConversationsRef,
      abortControllerRef,
    ]
  );

  return {
    sendMessage,
    regenerate,
    retryComparisonModel,
    executeRequest,
    updateMessageState,
  };
}
