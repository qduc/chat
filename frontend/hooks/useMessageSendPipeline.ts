import { useCallback, type MutableRefObject, type Dispatch, type SetStateAction } from 'react';
import {
  clearDraft,
  convertConversationMeta,
  mergeToolCallDelta,
  buildHistoryForModel,
  formatUpstreamError,
} from '../lib';
import type {
  ChatMessage as Message,
  MessageContent,
  ChatOptionsExtended,
  ChatResponse,
  PendingState,
  Status,
} from '../lib';
import { conversations as conversationsApi, chat } from '../lib/api';
import { APIError, StreamingNotSupportedError } from '../lib/streaming';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
    provider?: string;
    isEstimate: boolean;
  } | null>;
  setStatus: Dispatch<SetStateAction<Status>>;
  setPending: Dispatch<SetStateAction<PendingState>>;

  // -- Conversations --
  conversationIdRef: MutableRefObject<string | null>;
  setConversationId: (id: string | null) => void;
  setCurrentConversationTitle: (title: string | null) => void;
  setConversations: Dispatch<SetStateAction<any[]>>;

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
    buildMessageContent,
    clearAttachments,
    linkedConversationsRef,
    setLinkedConversations,
    setError,
    user,
    generateClientId,
    setInput,
  } = deps;

  // ---------------------------------------------------------------------------
  // updateMessageState – thin helper to update the last assistant message
  // ---------------------------------------------------------------------------
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
        reasoningEffortRef.current !== 'unset' ? { effort: reasoningEffortRef.current } : undefined;
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
            } else if (event.type === 'conversation') {
              if (isPrimary && event.value) {
                const c = event.value;
                if (!conversationIdRef.current || conversationIdRef.current === c.id) {
                  if (!conversationIdRef.current) {
                    setConversationId(c.id);
                  }
                  setCurrentConversationTitle(c.title || null);
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
                : response.conversation?.assistant_message_id?.toString() ||
                  (current as any).messageId,
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
      compareModels?: string[]
    ) => {
      const text = content || currentInput || '';
      const counts = attachmentCounts || { images: 0, audios: 0, files: 0 };
      if (!text.trim() && !counts.images && !counts.audios && !counts.files) return;

      let msgContent: MessageContent;
      try {
        msgContent = await buildMessageContent(text);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to prepare attachments';
        setError(msg);
        setStatus('idle');
        setPending((prev) => ({ ...prev, error: msg, streaming: false, abort: null }));
        return;
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
      };
      setPending({
        streaming: true,
        abort: abortControllerRef.current,
        tokenStats: tokenStatsRef.current,
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
      setPending((prev) => ({ ...prev, streaming: false, abort: null }));
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
        await sendMessage(
          typeof lastUser.content === 'string' ? lastUser.content : '',
          {
            clientMessageId: lastUser.id,
            skipLocalUserMessage: true,
          },
          '', // currentInput – unused because content is explicit
          { images: 0, audios: 0, files: 0 },
          compareModels
        );
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

  return {
    sendMessage,
    regenerate,
    retryComparisonModel,
    executeRequest,
    updateMessageState,
  };
}
