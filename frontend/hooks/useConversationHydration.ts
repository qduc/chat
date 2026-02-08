import { useCallback, type MutableRefObject, type Dispatch, type SetStateAction } from 'react';
import { mergeToolOutputsToAssistantMessages, prependReasoningToContent } from '../lib';
import type {
  ChatMessage as Message,
  MessageContent,
  ReasoningEffortLevel,
  Status,
  Evaluation,
  EvaluationDraft,
} from '../lib';
import { conversations as conversationsApi } from '../lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Refs and setters that conversation hydration needs from surrounding hooks. */
export interface ConversationHydrationDeps {
  // -- Status / error --
  setStatus: Dispatch<SetStateAction<Status>>;
  setError: (msg: string | null) => void;
  clearError: () => void;

  // -- Messages --
  setMessages: Dispatch<SetStateAction<Message[]>>;

  // -- Evaluations --
  setEvaluations: Dispatch<SetStateAction<Evaluation[]>>;
  setEvaluationDrafts: Dispatch<SetStateAction<EvaluationDraft[]>>;

  // -- Conversation metadata --
  setConversationId: (id: string | null) => void;
  setCurrentConversationTitle: (title: string | null) => void;

  // -- Model / provider --
  modelToProviderRef: MutableRefObject<Record<string, string>>;
  setModelState: (m: string) => void;
  modelRef: MutableRefObject<string>;
  setProviderId: (id: string | null) => void;
  providerIdRef: MutableRefObject<string | null>;

  // -- Settings --
  setEnabledTools: (tools: string[]) => void;
  enabledToolsRef: MutableRefObject<string[]>;
  setShouldStream: (v: boolean) => void;
  shouldStreamRef: MutableRefObject<boolean>;
  providerStreamRef: MutableRefObject<boolean>;
  setUseTools: (v: boolean) => void;
  useToolsRef: MutableRefObject<boolean>;
  setReasoningEffort: (l: ReasoningEffortLevel) => void;
  reasoningEffortRef: MutableRefObject<ReasoningEffortLevel>;
  normalizeCustomRequestParamsIds: (value: any) => string[];
  setCustomRequestParamsId: (ids: string[]) => void;
  customRequestParamsIdRef: MutableRefObject<string[]>;
  setSystemPrompt: (p: string | null) => void;
  systemPromptRef: MutableRefObject<string | null>;
  setActiveSystemPromptId: (id: string | null | undefined) => void;
  activeSystemPromptIdRef: MutableRefObject<string | null | undefined>;

  // -- Compare mode --
  setLinkedConversations: Dispatch<SetStateAction<Record<string, string>>>;
  linkedConversationsRef: MutableRefObject<Record<string, string>>;
  setCompareModels: Dispatch<SetStateAction<string[]>>;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * Convert raw API messages into hydrated `Message[]`, merging reasoning details
 * and tool outputs.
 */
export function hydrateMessages(rawApiMessages: any[]): Message[] {
  const rawMessages: Message[] = rawApiMessages.map((msg: any) => {
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

  return mergeToolOutputsToAssistantMessages(rawMessages);
}

/**
 * Resolve the model value and provider from conversation data.
 * Returns `{ modelValue, providerId }`.
 */
export function resolveModelAndProvider(
  rawModel: string | null,
  rawProvider: string | null,
  modelToProvider: Record<string, string>
): { modelValue: string | null; providerId: string | null } {
  if (!rawModel) return { modelValue: null, providerId: rawProvider };

  let resolvedProvider = rawProvider;
  let finalModelValue = rawModel;

  if (rawModel.includes('::')) {
    const [p, m] = rawModel.split('::', 2);
    if (!resolvedProvider) resolvedProvider = p;
    finalModelValue = resolvedProvider ? `${resolvedProvider}::${m}` : rawModel;
  } else {
    if (!resolvedProvider) resolvedProvider = modelToProvider[rawModel];
    finalModelValue = resolvedProvider ? `${resolvedProvider}::${rawModel}` : rawModel;
  }

  return { modelValue: finalModelValue, providerId: resolvedProvider };
}

/**
 * Build the linked-conversations map and the set of compare-model IDs
 * from the API response's `linked_conversations` array.
 */
export function buildLinkedConversationMap(
  linkedConversations: any[] | undefined,
  modelToProvider: Record<string, string>,
  primaryModel: string
): {
  linkedMap: Record<string, string>;
  compareModelIds: string[];
} {
  if (!linkedConversations || linkedConversations.length === 0) {
    return { linkedMap: {}, compareModelIds: [] };
  }

  const linkedMap: Record<string, string> = {};
  for (const linked of linkedConversations) {
    if (linked.model) {
      const rawM = String(linked.model).trim();
      const pId = typeof linked.provider_id === 'string' ? linked.provider_id.trim() : '';
      const normM = rawM.includes('::')
        ? rawM
        : pId
          ? `${pId}::${rawM}`
          : modelToProvider[rawM]
            ? `${modelToProvider[rawM]}::${rawM}`
            : rawM;
      linkedMap[normM] = linked.id;
    }
  }

  const compareModelIds = Object.keys(linkedMap).filter((m) => m !== primaryModel);
  return { linkedMap, compareModelIds };
}

/**
 * Merge linked conversation messages into the primary message list as
 * `comparisonResults` on assistant messages.
 */
export function mergeLinkedMessages(
  linkedConversations: any[] | undefined,
  modelToProvider: Record<string, string>
): { normalizedModel: string; assistants: any[] }[] {
  if (!linkedConversations || linkedConversations.length === 0) return [];

  const results: { normalizedModel: string; assistants: any[] }[] = [];

  for (const linked of linkedConversations) {
    if (!linked.model || !linked.messages || linked.messages.length === 0) continue;

    const rawM = String(linked.model).trim();
    const pId = typeof linked.provider_id === 'string' ? linked.provider_id.trim() : '';
    const normM = rawM.includes('::')
      ? rawM
      : pId
        ? `${pId}::${rawM}`
        : modelToProvider[rawM]
          ? `${modelToProvider[rawM]}::${rawM}`
          : rawM;

    const linkedAssistants = linked.messages.filter((m: any) => m.role === 'assistant');
    if (linkedAssistants.length > 0) {
      results.push({ normalizedModel: normM, assistants: linkedAssistants });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useConversationHydration(deps: ConversationHydrationDeps) {
  const {
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
  } = deps;

  const selectConversation = useCallback(
    async (id: string) => {
      try {
        setStatus('idle');
        clearError();

        const data = await conversationsApi.get(id, { limit: 200, include_linked: 'messages' });

        // --- Messages ---
        const convertedMessages = hydrateMessages(data.messages);
        setMessages(convertedMessages);
        setEvaluations(Array.isArray((data as any).evaluations) ? (data as any).evaluations : []);
        setEvaluationDrafts([]);
        setConversationId(id);
        setCurrentConversationTitle(data.title || null);

        // --- Model / Provider ---
        const rawModel = typeof data.model === 'string' ? data.model.trim() : null;
        const rawProvider = (data as any).provider_id || (data as any).provider || null;
        const { modelValue, providerId: resolvedProvider } = resolveModelAndProvider(
          rawModel,
          rawProvider,
          modelToProviderRef.current
        );

        if (modelValue) {
          setModelState(modelValue);
          modelRef.current = modelValue;
        }

        setProviderId(resolvedProvider || null);
        providerIdRef.current = resolvedProvider || null;

        // --- Settings ---
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
        if (data.reasoning_effort) {
          setReasoningEffort(data.reasoning_effort as ReasoningEffortLevel);
          reasoningEffortRef.current = data.reasoning_effort as ReasoningEffortLevel;
        }
        const ids = normalizeCustomRequestParamsIds((data as any).custom_request_params_id);
        setCustomRequestParamsId(ids);
        customRequestParamsIdRef.current = ids;

        const promptFromData = (data as any).system_prompt ?? null;
        if (promptFromData !== undefined) {
          setSystemPrompt(promptFromData);
          systemPromptRef.current = promptFromData;
        }
        if ((data as any).active_system_prompt_id !== undefined) {
          setActiveSystemPromptId((data as any).active_system_prompt_id);
          activeSystemPromptIdRef.current = (data as any).active_system_prompt_id;
        }

        // --- Linked Conversations ---
        const linkedData = data.linked_conversations;
        const { linkedMap, compareModelIds } = buildLinkedConversationMap(
          linkedData,
          modelToProviderRef.current,
          modelRef.current
        );

        if (linkedData && linkedData.length > 0) {
          // Merge linked messages into primary messages as comparisonResults
          const linkedMessageSets = mergeLinkedMessages(linkedData, modelToProviderRef.current);
          if (linkedMessageSets.length > 0) {
            setMessages((prev) => {
              let result = prev;
              for (const { normalizedModel, assistants } of linkedMessageSets) {
                let assistantCount = 0;
                result = result.map((m) => {
                  if (m.role !== 'assistant') return m;
                  const lMsg = assistants[assistantCount++];
                  if (!lMsg) return m;
                  return {
                    ...m,
                    comparisonResults: {
                      ...m.comparisonResults,
                      [normalizedModel]: {
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
              }
              return result;
            });
          }

          setLinkedConversations(linkedMap);
          linkedConversationsRef.current = linkedMap;
          setCompareModels(compareModelIds);
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
    ]
  );

  return { selectConversation };
}
