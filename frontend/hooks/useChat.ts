import { useState, useCallback, useRef, useEffect } from 'react';
import { useSystemPrompts } from './useSystemPrompts';
import type { MessageContent, TextContent, MessageEvent } from '../lib';
import { conversations as conversationsApi, chat, auth } from '../lib/api';
import { httpClient } from '../lib/http';
import { APIError, StreamingNotSupportedError } from '../lib/streaming';
import type { ConversationMeta, Provider, ChatOptionsExtended } from '../lib/types';
import { supportsReasoningControls, getDraft, setDraft, clearDraft } from '../lib';

// Types
export interface PendingState {
  streaming: boolean;
  error?: string;
  abort: AbortController | null;
  tokenStats?: {
    count: number;
    startTime: number;
    messageId: string;
    lastUpdated: number;
  };
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: MessageContent;
  timestamp?: number;
  tool_calls?: any[];
  message_events?: MessageEvent[];
  tool_call_id?: string;
  tool_outputs?: Array<{
    tool_call_id?: string;
    name?: string;
    output: any;
    status?: string;
  }>;
  usage?: {
    provider?: string;
    model?: string;
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    reasoning_tokens?: number;
  };
  comparisonResults?: Record<
    string,
    {
      content: MessageContent;
      usage?: any;
      status: 'streaming' | 'complete' | 'error';
      error?: string;
      tool_calls?: any[];
      tool_outputs?: Array<{
        tool_call_id?: string;
        name?: string;
        output: any;
        status?: string;
      }>;
      message_events?: MessageEvent[];
    }
  >;
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
export type QualityLevel = 'unset' | 'minimal' | 'low' | 'medium' | 'high';

// Add constant for default system prompt ID
const DEFAULT_SYSTEM_PROMPT_ID = null; // No system prompt by default

// Helper function to convert ConversationMeta to Conversation
function convertConversationMeta(meta: ConversationMeta): Conversation {
  return {
    id: meta.id,
    title: meta.title || '',
    created_at: meta.created_at,
    updatedAt: meta.created_at, // Use created_at as updatedAt fallback
  };
}

// Helper function to merge tool outputs from tool messages into assistant messages
function mergeToolOutputsToAssistantMessages(messages: Message[]): Message[] {
  // Build a map of tool_call_id to assistant message for quick lookup
  const assistantMessagesByToolCallId = new Map<string, Message>();

  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.tool_calls) {
      for (const toolCall of msg.tool_calls) {
        if (toolCall.id) {
          assistantMessagesByToolCallId.set(toolCall.id, msg);
        }
      }
    }
  }

  // Process messages and merge tool outputs
  const result: Message[] = [];

  for (const msg of messages) {
    if (msg.role === 'tool') {
      // Handle tool messages with tool_outputs array (streaming format)
      if (msg.tool_outputs) {
        for (const output of msg.tool_outputs) {
          const toolCallId = output.tool_call_id;
          if (toolCallId) {
            const assistantMsg = assistantMessagesByToolCallId.get(toolCallId);
            if (assistantMsg) {
              // Initialize tool_outputs array if needed
              if (!assistantMsg.tool_outputs) {
                assistantMsg.tool_outputs = [];
              }
              // Add the output if not already present
              const exists = assistantMsg.tool_outputs.some((o) => o.tool_call_id === toolCallId);
              if (!exists) {
                assistantMsg.tool_outputs.push(output);
              }
            }
          }
        }
      }

      // Handle tool messages with tool_call_id and content (database format)
      if (msg.tool_call_id && msg.content) {
        const assistantMsg = assistantMessagesByToolCallId.get(msg.tool_call_id);
        if (assistantMsg) {
          // Initialize tool_outputs array if needed
          if (!assistantMsg.tool_outputs) {
            assistantMsg.tool_outputs = [];
          }
          // Add the output if not already present
          const exists = assistantMsg.tool_outputs.some((o) => o.tool_call_id === msg.tool_call_id);
          if (!exists) {
            // Convert database format to tool_outputs format
            assistantMsg.tool_outputs.push({
              tool_call_id: msg.tool_call_id,
              output: msg.content,
              status: 'success',
            });
          }
        }
      }

      // Skip all tool messages - don't add them to the result
      continue;
    }

    // Add all non-tool messages to the result
    result.push(msg);
  }

  return result;
}

function mergeToolCallDelta(existingToolCalls: any[], tcDelta: any, textOffset: number) {
  const existingIdx = tcDelta.id
    ? existingToolCalls.findIndex((tc: any) => tc.id === tcDelta.id)
    : existingToolCalls.findIndex((tc: any) => (tc.index ?? 0) === (tcDelta.index ?? 0));

  if (existingIdx >= 0) {
    const updatedToolCalls = [...existingToolCalls];
    const existing = { ...updatedToolCalls[existingIdx] };
    if (tcDelta.id) existing.id = tcDelta.id;
    if (tcDelta.type) existing.type = tcDelta.type;
    if (tcDelta.index !== undefined) existing.index = tcDelta.index;
    if (tcDelta.function?.name) {
      existing.function = { ...existing.function, name: tcDelta.function.name };
    }
    if (tcDelta.function?.arguments) {
      existing.function = {
        ...existing.function,
        arguments: (existing.function?.arguments || '') + tcDelta.function.arguments,
      };
    }
    updatedToolCalls[existingIdx] = existing;
    return updatedToolCalls;
  }

  return [
    ...existingToolCalls,
    {
      id: tcDelta.id,
      type: tcDelta.type || 'function',
      index: tcDelta.index ?? existingToolCalls.length,
      textOffset,
      function: {
        name: tcDelta.function?.name || '',
        arguments: tcDelta.function?.arguments || '',
      },
    },
  ];
}

function isEmptyAssistantPayload(
  content: MessageContent,
  toolCalls?: any[],
  toolOutputs?: any[]
): boolean {
  const hasContent =
    typeof content === 'string'
      ? content.trim().length > 0
      : Array.isArray(content)
        ? content.length > 0
        : content != null;
  const hasToolCalls = Array.isArray(toolCalls) && toolCalls.length > 0;
  const hasToolOutputs = Array.isArray(toolOutputs) && toolOutputs.length > 0;
  return !hasContent && !hasToolCalls && !hasToolOutputs;
}

function buildHistoryForModel(
  sourceMessages: Message[],
  targetModel: string,
  isPrimary: boolean
): Array<{
  id: string;
  role: Message['role'];
  content: MessageContent;
  tool_calls?: any[];
  tool_outputs?: any[];
}> {
  if (isPrimary) {
    return sourceMessages.map((msg) => ({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      tool_calls: msg.tool_calls,
      tool_outputs: msg.tool_outputs,
    }));
  }

  const history: Array<{
    id: string;
    role: Message['role'];
    content: MessageContent;
    tool_calls?: any[];
    tool_outputs?: any[];
  }> = [];

  for (const msg of sourceMessages) {
    if (msg.role === 'assistant') {
      const comparison = msg.comparisonResults?.[targetModel];
      if (!comparison) continue;
      const content = comparison.content ?? '';
      if (isEmptyAssistantPayload(content, comparison.tool_calls, comparison.tool_outputs)) {
        continue;
      }
      history.push({
        id: msg.id,
        role: msg.role,
        content,
        tool_calls: comparison.tool_calls,
        tool_outputs: comparison.tool_outputs,
      });
      continue;
    }

    if (msg.role === 'tool') {
      continue;
    }

    history.push({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      tool_calls: msg.tool_calls,
      tool_outputs: msg.tool_outputs,
    });
  }

  return history;
}

function prependReasoningToContent(content: MessageContent, reasoningText: string): MessageContent {
  const normalizedReasoning = reasoningText.trim();
  if (!normalizedReasoning) {
    return content;
  }

  const thinkingBlock = `<thinking>${normalizedReasoning}</thinking>`;

  if (!content || (typeof content === 'string' && content.trim().length === 0)) {
    return thinkingBlock;
  }

  if (typeof content === 'string') {
    if (content.includes('<thinking>')) {
      return content;
    }
    const suffix = content.length > 0 ? `\n\n${content}` : '';
    return `${thinkingBlock}${suffix}`;
  }

  if (!Array.isArray(content)) {
    return thinkingBlock;
  }

  const hasExistingThinking = content.some(
    (item) => item.type === 'text' && item.text.includes('<thinking>')
  );
  if (hasExistingThinking) {
    return content;
  }

  const updated = [...content];
  const firstTextIndex = updated.findIndex((item) => item.type === 'text');

  if (firstTextIndex === -1) {
    return [{ type: 'text', text: thinkingBlock }, ...updated];
  }

  const firstItem = updated[firstTextIndex];
  if (firstItem.type === 'text') {
    const suffix = firstItem.text.length > 0 ? `\n\n${firstItem.text}` : '';
    updated[firstTextIndex] = {
      ...firstItem,
      text: `${thinkingBlock}${suffix}`,
    } as TextContent;
  }

  return updated;
}

function formatUpstreamError(error: APIError): string {
  const body =
    error.body && typeof error.body === 'object' ? (error.body as Record<string, unknown>) : null;
  const upstream =
    body && typeof body.upstream === 'object' && body.upstream !== null
      ? (body.upstream as Record<string, unknown>)
      : null;

  const upstreamMessage = typeof upstream?.message === 'string' ? upstream.message.trim() : '';
  const bodyMessage = typeof body?.message === 'string' ? body.message.trim() : '';
  const statusValue =
    upstream && upstream.status !== undefined && upstream.status !== null
      ? upstream.status
      : undefined;
  const statusPart = statusValue !== undefined ? ` (status ${statusValue})` : '';

  if (upstreamMessage) {
    return `Upstream provider error${statusPart}: ${upstreamMessage}`;
  }

  if (bodyMessage) {
    return `Upstream provider error${statusPart}: ${bodyMessage}`;
  }

  return error.message;
}

export function useChat() {
  // Helper to generate reasonably-unique client IDs for local messages.
  // Prefer the browser-native crypto.randomUUID when available, fall back to
  // a time+random string if not. This reduces the chance of duplicates
  // compared to using Date.now() alone.
  const generateClientId = () => {
    try {
      if (typeof crypto !== 'undefined' && typeof (crypto as any).randomUUID === 'function') {
        return (crypto as any).randomUUID();
      }
    } catch {
      // ignore and fall back
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  };

  // Message & Conversation State
  const [messages, setMessages] = useState<Message[]>([]);
  const messagesRef = useRef<Message[]>([]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationTitle, setCurrentConversationTitle] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingConversations, setLoadingConversations] = useState(false);

  // UI State
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      const stored = window.localStorage.getItem('sidebarCollapsed');
      return stored === 'true';
    } catch {
      return false;
    }
  });
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(false);
  const [historyEnabled] = useState(true); // Make configurable if needed

  // Editing State
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState<string>('');

  // Model & Provider State
  const SELECTED_MODEL_KEY = 'selectedModel';

  // model state - internal setter is kept separate from the persisted setter
  const [model, setModelState] = useState<string>('');
  // persisted setter - saves last manually selected model to localStorage
  const setModel = useCallback((m: string) => {
    setModelState(m);
    modelRef.current = m;
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
  const [modelCapabilities, setModelCapabilities] = useState<any>(null);

  // Comparison State
  const [compareModels, setCompareModels] = useState<string[]>([]);
  // Linked comparison conversations (model -> conversationId)
  const [linkedConversations, setLinkedConversations] = useState<Record<string, string>>({});
  const linkedConversationsRef = useRef<Record<string, string>>({});

  // Tool & Quality State
  const [useTools, setUseTools] = useState(true);
  const [enabledTools, setEnabledTools] = useState<string[]>([]);
  const [shouldStream, setShouldStream] = useState(true);
  const [qualityLevel, setQualityLevel] = useState<QualityLevel>('unset');

  // Image State
  const [images, setImages] = useState<any[]>([]);

  // File State
  const [files, setFiles] = useState<any[]>([]);

  // System Prompt State
  const [activeSystemPromptId, setActiveSystemPromptId] = useState<string | null | undefined>(
    undefined
  );
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);

  // Refs to track latest values to avoid stale closures in sendMessage
  const systemPromptRef = useRef<string | null>(null);
  const activeSystemPromptIdRef = useRef<string | null | undefined>(undefined);
  const modelRef = useRef<string>('');
  const providerIdRef = useRef<string | null>(null);
  const shouldStreamRef = useRef<boolean>(true);
  const providerStreamRef = useRef<boolean>(true);
  const useToolsRef = useRef<boolean>(true);
  const enabledToolsRef = useRef<string[]>([]);
  const qualityLevelRef = useRef<QualityLevel>('unset');
  const modelToProviderRef = useRef<Record<string, string>>({});

  // User State
  const [user, setUser] = useState<{ id: string } | null>(null);

  // Abort Controller
  const abortControllerRef = useRef<AbortController | null>(null);
  const currentRequestIdRef = useRef<string | null>(null);

  // Token streaming stats
  const [pending, setPending] = useState<PendingState>({
    streaming: false,
    error: undefined,
    abort: null,
  });

  // Use ref to track token stats to avoid triggering re-renders on every token
  const tokenStatsRef = useRef<{
    count: number;
    startTime: number;
    messageId: string;
    lastUpdated: number;
  } | null>(null);

  // Track whether draft has been restored to avoid restoring multiple times
  const draftRestoredRef = useRef(false);

  // Actions - Sidebar
  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        if (typeof window !== 'undefined') {
          window.localStorage.setItem('sidebarCollapsed', String(next));
        }
      } catch {
        // ignore storage failures
      }
      return next;
    });
  }, []);

  const toggleRightSidebar = useCallback(() => {
    setRightSidebarCollapsed((prev) => !prev);
  }, []);

  // Actions - Conversations
  const selectConversation = useCallback(
    async (id: string) => {
      try {
        setLoadingConversations(true);

        // Clear draft for the previous conversation when switching
        if (user?.id && conversationId && conversationId !== id) {
          clearDraft(user.id, conversationId);
        }

        // Request a larger message page by default so the UI can show history
        const data = await conversationsApi.get(id, { limit: 200 });

        // Convert backend messages to frontend format
        const rawMessages: Message[] = data.messages.map((msg) => {
          const baseContent = (msg.content ?? '') as MessageContent;
          const reasoningText =
            msg.role === 'assistant' && Array.isArray(msg.reasoning_details)
              ? msg.reasoning_details
                  .map((detail: any) =>
                    typeof detail?.text === 'string' ? detail.text.trim() : ''
                  )
                  .filter(Boolean)
                  .join('\n\n')
              : '';
          const hasMessageEvents =
            Array.isArray(msg.message_events) && msg.message_events.length > 0;

          const content =
            msg.role === 'assistant' && reasoningText && !hasMessageEvents
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
          };
        });

        // Merge tool outputs from tool messages into their corresponding assistant messages
        const convertedMessages = mergeToolOutputsToAssistantMessages(rawMessages);

        setMessages(convertedMessages);
        setConversationId(id);
        setCurrentConversationTitle(data.title || null);

        // Apply conversation settings without persisting to localStorage
        // (persist only user manual selections)
        const providerFromPayload = (data as any).provider ?? (data as any).provider_id;
        const normalizeProvider = (value: unknown): string | null => {
          if (typeof value !== 'string') return null;
          const trimmed = value.trim();
          return trimmed.length ? trimmed : null;
        };

        const resolveProviderFromModel = (rawModel: string | null): string | null => {
          if (!rawModel) return null;
          const direct = modelToProviderRef.current[rawModel];
          if (direct) return direct;
          const entries = Object.entries(modelToProviderRef.current);
          const match = entries.find(([key]) => key.endsWith(`::${rawModel}`));
          return match ? match[1] : null;
        };

        const rawModel = typeof data.model === 'string' ? data.model.trim() : null;
        const providerFromData = normalizeProvider(providerFromPayload);

        let resolvedProvider: string | null = providerFromData;
        let finalModelValue: string | null = rawModel;

        if (rawModel) {
          if (rawModel.includes('::')) {
            const [maybeProvider, maybeModel] = rawModel.split('::', 2);
            const trimmedModel = maybeModel?.trim() || '';
            if (!resolvedProvider && maybeProvider?.trim()) {
              resolvedProvider = maybeProvider.trim();
            }
            finalModelValue =
              resolvedProvider && trimmedModel ? `${resolvedProvider}::${trimmedModel}` : rawModel;
          } else {
            if (!resolvedProvider) {
              resolvedProvider = resolveProviderFromModel(rawModel);
            }
            finalModelValue = resolvedProvider ? `${resolvedProvider}::${rawModel}` : rawModel;
          }
        }

        if (finalModelValue) {
          setModelState(finalModelValue);
          modelRef.current = finalModelValue;
        }

        setProviderId(resolvedProvider);
        providerIdRef.current = resolvedProvider;

        // Apply tools settings
        const toolsFromData = (data as any).active_tools || [];
        if (toolsFromData && Array.isArray(toolsFromData)) {
          setEnabledTools(toolsFromData);
          enabledToolsRef.current = toolsFromData;
        }

        // Apply streaming and tools enabled flags
        if (typeof data.streaming_enabled === 'boolean') {
          setShouldStream(data.streaming_enabled);
          shouldStreamRef.current = data.streaming_enabled;
          providerStreamRef.current = data.streaming_enabled;
        }
        if (typeof data.tools_enabled === 'boolean') {
          setUseTools(data.tools_enabled);
          useToolsRef.current = data.tools_enabled;
        }

        // Apply quality level
        if (data.quality_level) {
          setQualityLevel(data.quality_level as QualityLevel);
          qualityLevelRef.current = data.quality_level as QualityLevel;
        }

        // Apply system prompt
        const promptFromData = (data as any).system_prompt ?? null;
        if (promptFromData !== undefined) {
          setSystemPrompt(promptFromData);
          systemPromptRef.current = promptFromData;
        }

        // Apply active system prompt ID (always set, even if null)
        if ('active_system_prompt_id' in data) {
          setActiveSystemPromptId(data.active_system_prompt_id);
          activeSystemPromptIdRef.current = data.active_system_prompt_id;
        }

        // Load linked comparison conversations (if any)
        try {
          const linkedResult = await conversationsApi.getLinked(id);
          if (linkedResult.conversations && linkedResult.conversations.length > 0) {
            const linkedMap: Record<string, string> = {};

            // Fetch messages from each linked conversation and populate comparisonResults
            for (const linked of linkedResult.conversations) {
              if (linked.model) {
                const rawLinkedModel = String(linked.model).trim();
                if (!rawLinkedModel) continue;
                const linkedProviderId =
                  typeof linked.provider_id === 'string' ? linked.provider_id.trim() : '';
                const normalizedLinkedModel = rawLinkedModel.includes('::')
                  ? rawLinkedModel
                  : linkedProviderId
                    ? `${linkedProviderId}::${rawLinkedModel}`
                    : resolveProviderFromModel(rawLinkedModel)
                      ? `${resolveProviderFromModel(rawLinkedModel)}::${rawLinkedModel}`
                      : rawLinkedModel;

                linkedMap[normalizedLinkedModel] = linked.id;

                // Fetch the linked conversation's messages
                try {
                  const linkedData = await conversationsApi.get(linked.id);
                  if (linkedData.messages && linkedData.messages.length > 0) {
                    // Merge linked conversation messages into comparisonResults
                    setMessages((prevMessages) => {
                      // Build a map of user message indices to assistant message indices
                      // for the linked conversation
                      const linkedUserIndices: number[] = [];
                      const linkedAssistantIndices: number[] = [];

                      for (let i = 0; i < linkedData.messages.length; i++) {
                        const msg = linkedData.messages[i];
                        if (msg.role === 'user') {
                          linkedUserIndices.push(i);
                        } else if (msg.role === 'assistant') {
                          linkedAssistantIndices.push(i);
                        }
                      }

                      // Build comparison results for each message
                      const updatedMessages = prevMessages.map((msg, idx) => {
                        if (msg.role !== 'assistant') return msg;

                        // Find the corresponding assistant message in the linked conversation
                        // by matching the position (index among assistant messages)
                        const assistantIndex =
                          prevMessages.slice(0, idx + 1).filter((m) => m.role === 'assistant')
                            .length - 1;

                        if (assistantIndex >= 0 && assistantIndex < linkedAssistantIndices.length) {
                          const linkedIdx = linkedAssistantIndices[assistantIndex];
                          const linkedMsg = linkedData.messages[linkedIdx];
                          if (linkedMsg) {
                            return {
                              ...msg,
                              comparisonResults: {
                                ...msg.comparisonResults,
                                [normalizedLinkedModel]: {
                                  content: linkedMsg.content ?? '',
                                  usage: (linkedMsg as any).usage,
                                  status: 'complete' as const,
                                  tool_calls: linkedMsg.tool_calls,
                                  tool_outputs: linkedMsg.tool_outputs,
                                  message_events: linkedMsg.message_events,
                                },
                              },
                            };
                          }
                        }
                        return msg;
                      });

                      return updatedMessages;
                    });
                  }
                } catch (err) {
                  console.warn(
                    `[useChat] Failed to load messages from linked conversation ${linked.id}:`,
                    err
                  );
                  // Continue with other linked conversations
                }
              }
            }
            setLinkedConversations(linkedMap);
            const primaryModelValue = finalModelValue || modelRef.current;
            setCompareModels(
              Object.keys(linkedMap).filter((modelId) => modelId && modelId !== primaryModelValue)
            );
          } else {
            setLinkedConversations({});
            setCompareModels([]);
          }
        } catch {
          // Non-fatal: if loading linked conversations fails, just clear state
          setLinkedConversations({});
          setCompareModels([]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load conversation');
      } finally {
        setLoadingConversations(false);
      }
    },
    [user?.id, conversationId]
  );

  const deleteConversation = useCallback(
    async (id: string) => {
      try {
        await conversationsApi.delete(id);
        setConversations((prev) => prev.filter((c) => c.id !== id));
        if (conversationId === id) {
          setConversationId(null);
          setMessages([]);
          setLinkedConversations({});
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete conversation');
      }
    },
    [conversationId]
  );

  const loadMoreConversations = useCallback(async () => {
    if (!nextCursor || loadingConversations) return;
    try {
      setLoadingConversations(true);
      const data = await conversationsApi.list({ cursor: nextCursor, limit: 20 });
      setConversations((prev) => [...prev, ...data.items.map(convertConversationMeta)]);
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
    setPending((prev) => ({ ...prev, error: undefined, streaming: false, abort: null }));
    setEditingMessageId(null);
    setEditingContent('');
    setImages([]);
    setFiles([]);
    setCurrentConversationTitle(null);
    setLinkedConversations({});

    // Clear draft for the previous conversation when starting a new chat
    if (user?.id && conversationId) {
      clearDraft(user.id, conversationId);
    }

    // When starting a new chat (no active conversation) prefer the saved model
    try {
      if (typeof window !== 'undefined') {
        const saved = window.localStorage.getItem(SELECTED_MODEL_KEY);
        if (saved) {
          setModelState(saved);
          modelRef.current = saved;
        }
      }
    } catch {
      // ignore localStorage errors
    }

    // Reset quality level to unset so `reasoning_effort` is not included in
    // requests when the selected model does NOT support reasoning controls.
    // Use the resolved model (modelRef.current) and the current
    // `modelCapabilities` map to determine support.
    try {
      const modelToCheck = modelRef.current;
      const supports = supportsReasoningControls(modelToCheck, modelCapabilities);
      if (!supports) {
        setQualityLevel('unset');
        qualityLevelRef.current = 'unset';
      }
    } catch {
      // conservative fallback: don't change user selection on errors
    }
  }, [modelCapabilities, user?.id, conversationId]);

  // On mount, when there is no active conversation, load the saved selected model
  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && !conversationId) {
        const saved = window.localStorage.getItem(SELECTED_MODEL_KEY);
        if (saved) {
          setModelState(saved);
          modelRef.current = saved;
        }
      }
    } catch {
      // ignore
    }
    // We intentionally only run this on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    linkedConversationsRef.current = linkedConversations;
  }, [linkedConversations]);

  // Actions - Messages
  const sendMessage = useCallback(
    async (
      content?: string,
      opts?: {
        clientMessageId?: string;
        skipLocalUserMessage?: boolean;
        retried?: boolean;
        comparisonModelsOverride?: string[];
      }
    ) => {
      const messageText = content || input;
      if (!messageText.trim() && images.length === 0) return;

      try {
        setStatus('streaming');
        setError(null);

        // Create abort controller
        abortControllerRef.current = new AbortController();

        // Initialize token stats using ref to avoid re-renders
        const messageId = generateClientId();
        currentRequestIdRef.current = messageId;
        tokenStatsRef.current = {
          count: 0,
          startTime: Date.now(),
          messageId,
          lastUpdated: Date.now(),
        };
        setPending({
          streaming: true,
          error: undefined,
          abort: abortControllerRef.current,
          tokenStats: tokenStatsRef.current,
        });

        // Prepend file contents to message text if present
        let finalMessageText = messageText;
        if (files.length > 0) {
          const fileContexts = files
            .map((f) => {
              // Get file extension for language detection
              const ext = f.name.split('.').pop()?.toLowerCase() || '';
              const langMap: Record<string, string> = {
                js: 'javascript',
                jsx: 'javascript',
                ts: 'typescript',
                tsx: 'typescript',
                py: 'python',
                rb: 'ruby',
                java: 'java',
                cpp: 'cpp',
                c: 'c',
                go: 'go',
                rs: 'rust',
                sh: 'bash',
                bash: 'bash',
                json: 'json',
                xml: 'xml',
                yaml: 'yaml',
                yml: 'yaml',
                md: 'markdown',
                html: 'html',
                css: 'css',
                scss: 'scss',
                sql: 'sql',
                graphql: 'graphql',
              };
              const language = langMap[ext] || ext;

              return `File: ${f.name}\n\`\`\`${language}\n${f.content || ''}\n\`\`\``;
            })
            .join('\n\n');

          finalMessageText = fileContexts + '\n\n' + messageText;
        }

        // Convert images to content format if present
        let messageContent: MessageContent = finalMessageText;
        if (images.length > 0) {
          const contentParts: any[] = [{ type: 'text', text: finalMessageText }];
          for (const img of images) {
            contentParts.push({
              type: 'image_url',
              image_url: { url: img.downloadUrl || img.url },
            });
          }
          messageContent = contentParts;
        }

        // Create user message (reuse provided clientMessageId when regenerating)
        const userMessage: Message = {
          id: opts?.clientMessageId ?? generateClientId(),
          role: 'user',
          content: messageContent,
          timestamp: Date.now(),
        };
        // When regenerating we already set the messages to the baseMessages which
        // include the original user message. In that case, skip appending another
        // local copy to avoid duplication.
        if (!opts?.skipLocalUserMessage) {
          setMessages((prev) => [...prev, userMessage]);
        }

        // Create placeholder assistant message
        const assistantMessage: Message = {
          id: messageId, // Use the same ID for token tracking
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
        };
        // Always append assistant placeholder (even when regenerating)
        setMessages((prev) => [...prev, assistantMessage]);

        // Clear input, images, and files immediately after adding message to UI
        setInput('');
        setImages([]);
        setFiles([]);

        // Send message with streaming
        // Use refs to get the latest values and avoid stale closures
        const primaryModel = modelRef.current;
        const comparisonModelsSource = opts?.comparisonModelsOverride ?? compareModels;
        const activeComparisonModels = comparisonModelsSource.filter((m) => m !== primaryModel);

        // Helper to update message state - works for both primary and secondary models
        const updateMessageState = (
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
        };

        const executeRequest = async (
          targetModel: string,
          isPrimary: boolean,
          options?: { conversationId?: string; parentConversationId?: string }
        ) => {
          const targetConversationId = options?.conversationId;
          const parentConversationId = options?.parentConversationId;
          // Extract actual model ID from provider-qualified format (provider::model)
          const actualModelId = targetModel.includes('::')
            ? targetModel.split('::')[1]
            : targetModel;

          // Determine provider for this model
          let targetProviderId = providerIdRef.current || '';
          if (targetModel.includes('::')) {
            targetProviderId = targetModel.split('::')[0];
          } else if (modelToProviderRef.current[targetModel]) {
            targetProviderId = modelToProviderRef.current[targetModel];
          }

          // Map qualityLevel to reasoning effort if the model supports reasoning
          const reasoning =
            qualityLevelRef.current !== 'unset' ? { effort: qualityLevelRef.current } : undefined;

          const currentMessages = messagesRef.current;
          const isEmptyAssistantPlaceholder = (msg: Message) =>
            msg.role === 'assistant' &&
            (msg.content === '' || (Array.isArray(msg.content) && msg.content.length === 0)) &&
            (!Array.isArray(msg.tool_calls) || msg.tool_calls.length === 0) &&
            (!Array.isArray(msg.tool_outputs) || msg.tool_outputs.length === 0);
          const isCurrentAssistant = (msg: Message) =>
            msg.role === 'assistant' && msg.id === messageId;

          // Prepare the new message object
          const newMessageObj = {
            id: userMessage.id,
            role: 'user' as const,
            content: messageContent,
          };

          let messagesPayload;
          if (targetConversationId) {
            // Optimization for existing conversations
            messagesPayload = [newMessageObj];
          } else {
            // Full history for new conversations or secondary comparison requests
            // (Secondary requests use undefined conversationId, so they need full history)
            const historySource = isPrimary
              ? currentMessages
              : currentMessages.filter(
                  (m) => !isEmptyAssistantPlaceholder(m) && !isCurrentAssistant(m)
                );
            const history = buildHistoryForModel(historySource, targetModel, isPrimary);

            // Check if the message is already in history (e.g. retry/regenerate)
            const exists = history.some((m) => m.id === newMessageObj.id);
            if (exists) {
              // Update existing message in place (in case content changed)
              messagesPayload = history.map((m) =>
                m.id === newMessageObj.id ? { ...m, ...newMessageObj } : m
              );
            } else {
              // Append new message
              messagesPayload = [...history, newMessageObj];
            }
          }

          // Initialize comparison result for this model if it's secondary
          if (!isPrimary) {
            setMessages((prev) => {
              const lastIdx = prev.length - 1;
              if (lastIdx < 0) return prev;
              const lastMsg = prev[lastIdx];
              if (!lastMsg || lastMsg.role !== 'assistant') return prev;

              return [
                ...prev.slice(0, lastIdx),
                {
                  ...lastMsg,
                  comparisonResults: {
                    ...(lastMsg.comparisonResults || {}),
                    [targetModel]: {
                      content: '',
                      status: 'streaming',
                    },
                  },
                },
              ];
            });
          }

          try {
            const response = await chat.sendMessage({
              messages: messagesPayload,
              model: actualModelId,
              providerId: targetProviderId,
              stream: shouldStreamRef.current,
              providerStream: providerStreamRef.current,
              requestId: isPrimary ? messageId : `${messageId}-${targetModel}`,
              signal: abortControllerRef.current?.signal,
              conversationId: targetConversationId || undefined,
              parentConversationId: parentConversationId || undefined,
              streamingEnabled: shouldStreamRef.current,
              toolsEnabled: useToolsRef.current,
              tools: enabledToolsRef.current,
              qualityLevel: qualityLevelRef.current,
              reasoning: reasoning,
              systemPrompt: systemPromptRef.current || undefined,
              activeSystemPromptId: activeSystemPromptIdRef.current || undefined,
              modelCapabilities: modelCapabilities,
              onToken: (token: string) => {
                // Update token stats for primary model only
                if (
                  isPrimary &&
                  tokenStatsRef.current &&
                  tokenStatsRef.current.messageId === messageId
                ) {
                  const isFirstToken = tokenStatsRef.current.count === 0;
                  tokenStatsRef.current.count += 1;
                  if (isFirstToken) {
                    tokenStatsRef.current.startTime = Date.now();
                  }
                  tokenStatsRef.current.lastUpdated = Date.now();
                }

                updateMessageState(isPrimary, targetModel, (current) => {
                  const currentContent = typeof current.content === 'string' ? current.content : '';
                  return { content: currentContent + token };
                });
              },
              onEvent: (event) => {
                if (event.type === 'text') {
                  // Update token stats for primary model only
                  if (
                    isPrimary &&
                    tokenStatsRef.current &&
                    tokenStatsRef.current.messageId === messageId
                  ) {
                    const isFirstContent = tokenStatsRef.current.count === 0;
                    tokenStatsRef.current.count += 1;
                    if (isFirstContent) {
                      tokenStatsRef.current.startTime = Date.now();
                    }
                    tokenStatsRef.current.lastUpdated = Date.now();
                  }

                  updateMessageState(isPrimary, targetModel, (current) => {
                    const currentContent =
                      typeof current.content === 'string' ? current.content : '';
                    return { content: currentContent + event.value };
                  });
                } else if (event.type === 'tool_call') {
                  updateMessageState(isPrimary, targetModel, (current) => {
                    const currentTextLength =
                      typeof current.content === 'string' ? current.content.length : 0;
                    const existingToolCalls = current.tool_calls || [];
                    const updatedToolCalls = mergeToolCallDelta(
                      existingToolCalls,
                      event.value,
                      currentTextLength
                    );
                    return { tool_calls: updatedToolCalls };
                  });
                } else if (event.type === 'tool_output') {
                  updateMessageState(isPrimary, targetModel, (current) => {
                    const outputValue = event.value;
                    const toolCallId = outputValue.tool_call_id;
                    const outputName = outputValue.name;
                    const existingToolOutputs = current.tool_outputs || [];

                    // Check if this tool output already exists
                    const existingIdx = existingToolOutputs.findIndex((out: any) => {
                      if (toolCallId && out.tool_call_id) return out.tool_call_id === toolCallId;
                      if (outputName && out.name) return out.name === outputName;
                      return false;
                    });

                    if (existingIdx === -1) {
                      return { tool_outputs: [...existingToolOutputs, outputValue] };
                    }
                    return {}; // No update if duplicate
                  });
                } else if (event.type === 'usage') {
                  updateMessageState(isPrimary, targetModel, (current) => {
                    // For primary, check if usage actually changed
                    if (isPrimary) {
                      const existingUsage = (current as Message).usage;
                      const newUsage = event.value;
                      if (existingUsage) {
                        const unchanged =
                          existingUsage.provider === newUsage.provider &&
                          existingUsage.model === newUsage.model &&
                          existingUsage.prompt_tokens === newUsage.prompt_tokens &&
                          existingUsage.completion_tokens === newUsage.completion_tokens &&
                          existingUsage.total_tokens === newUsage.total_tokens &&
                          existingUsage.reasoning_tokens === newUsage.reasoning_tokens;
                        if (unchanged) return {};
                      }
                    }
                    return { usage: event.value };
                  });
                }
              },
            } as ChatOptionsExtended);

            // Completion handling
            if (isPrimary) {
              setMessages((prev) => {
                const lastIdx = prev.length - 1;
                if (lastIdx < 0) return prev;
                const lastMsg = prev[lastIdx];
                if (!lastMsg || lastMsg.role !== 'assistant') return prev;

                const responseContent = response.content as MessageContent;
                const hasResponseContent =
                  typeof responseContent === 'string'
                    ? responseContent.length > 0
                    : Array.isArray(responseContent)
                      ? responseContent.length > 0
                      : responseContent != null;

                const finalContent = hasResponseContent ? responseContent : lastMsg.content;
                return [...prev.slice(0, lastIdx), { ...lastMsg, content: finalContent }];
              });

              // Update conversation metadata if returned
              if (response.conversation) {
                const isNewConversation = conversationId !== response.conversation.id;
                setConversationId(response.conversation.id);
                setCurrentConversationTitle(response.conversation.title || null);

                if (isNewConversation) {
                  const newConversation: Conversation = {
                    id: response.conversation.id,
                    title: response.conversation.title || 'Untitled conversation',
                    created_at: response.conversation.created_at,
                    updatedAt: response.conversation.created_at,
                  };

                  setConversations((prev) => {
                    const exists = prev.some((c) => c.id === newConversation.id);
                    if (exists) return prev;
                    return [newConversation, ...prev];
                  });

                  if (
                    !response.conversation.title ||
                    response.conversation.title === 'Untitled conversation'
                  ) {
                    setTimeout(async () => {
                      try {
                        const updated = await conversationsApi.get(response.conversation!.id, {
                          limit: 1,
                        });
                        if (updated.title && updated.title !== response.conversation!.title) {
                          setCurrentConversationTitle(updated.title);
                          setConversations((prev) =>
                            prev.map((c) =>
                              c.id === response.conversation!.id
                                ? { ...c, title: updated.title ?? c.title }
                                : c
                            )
                          );
                        }
                      } catch (err) {
                        console.warn('Failed to fetch updated conversation title:', err);
                      }
                    }, 2000);
                  }
                }
              }

              // Clear the draft after successful send
              if (user?.id) {
                clearDraft(user.id, conversationId);
                if (response.conversation?.id) {
                  clearDraft(user.id, response.conversation.id);
                }
              }

              const effectiveConversationId = response.conversation?.id ?? conversationId;
              if (effectiveConversationId) {
                conversationsApi.invalidateDetailCache(effectiveConversationId);
              }
              conversationsApi.clearListCache();
            } else {
              // Secondary completion
              setMessages((prev) => {
                const lastIdx = prev.length - 1;
                if (lastIdx < 0) return prev;
                const lastMsg = prev[lastIdx];
                const existingRes = lastMsg.comparisonResults?.[targetModel];
                if (!existingRes) return prev;

                const responseContent = response.content as MessageContent;
                const hasResponseContent =
                  typeof responseContent === 'string'
                    ? responseContent.length > 0
                    : Array.isArray(responseContent)
                      ? responseContent.length > 0
                      : responseContent != null;
                const finalContent = hasResponseContent ? responseContent : existingRes.content;

                return [
                  ...prev.slice(0, lastIdx),
                  {
                    ...lastMsg,
                    comparisonResults: {
                      ...lastMsg.comparisonResults,
                      [targetModel]: {
                        ...existingRes,
                        content: finalContent,
                        status: 'complete',
                      },
                    },
                  },
                ];
              });

              // Track the linked conversation ID
              if (response.conversation?.id) {
                setLinkedConversations((prev) => ({
                  ...prev,
                  [targetModel]: response.conversation!.id,
                }));
              }
            }

            return response;
          } catch (err) {
            // Error handling - use same error formatting for both primary and secondary
            let errorMessage: string;
            if (err instanceof StreamingNotSupportedError) {
              // For primary, try to retry without streaming
              if (isPrimary && !opts?.retried) {
                providerStreamRef.current = false;
                setMessages((prev) => prev.slice(0, -1));
                setTimeout(() => {
                  void sendMessage(content, { ...opts, skipLocalUserMessage: true, retried: true });
                }, 0);
                return;
              }
              errorMessage = 'Streaming not supported by provider';
            } else if (err instanceof APIError) {
              errorMessage = formatUpstreamError(err);
            } else if (err instanceof Error && err.name === 'AbortError') {
              errorMessage = 'Message cancelled';
            } else if (err instanceof Error) {
              errorMessage = err.message;
            } else {
              errorMessage = isPrimary ? 'Failed to send message' : 'Failed to generate';
            }

            if (isPrimary) {
              setError(errorMessage);
              setStatus('idle');
              setPending((prev) => ({
                ...prev,
                streaming: false,
                error: errorMessage,
              }));
            } else {
              setMessages((prev) => {
                const lastIdx = prev.length - 1;
                if (lastIdx < 0) return prev;
                const lastMsg = prev[lastIdx];
                const existingRes = lastMsg.comparisonResults?.[targetModel];
                if (!existingRes) return prev;

                return [
                  ...prev.slice(0, lastIdx),
                  {
                    ...lastMsg,
                    comparisonResults: {
                      ...lastMsg.comparisonResults,
                      [targetModel]: {
                        ...existingRes,
                        status: 'error',
                        error: errorMessage,
                      },
                    },
                  },
                ];
              });
            }
          }
        };

        // For comparison mode with new conversations, create the conversation upfront
        // so all requests can start in parallel instead of waiting for primary to complete
        let effectiveConversationId = conversationId;

        if (!conversationId && activeComparisonModels.length > 0) {
          try {
            const actualModelId = primaryModel.includes('::')
              ? primaryModel.split('::')[1]
              : primaryModel;
            const newConversation = await conversationsApi.create({
              model: actualModelId,
              provider_id: providerIdRef.current || undefined,
              streamingEnabled: shouldStreamRef.current,
              toolsEnabled: useToolsRef.current,
              qualityLevel:
                qualityLevelRef.current !== 'unset' ? qualityLevelRef.current : undefined,
            });
            effectiveConversationId = newConversation.id;
            setConversationId(newConversation.id);

            // Add to conversations list immediately
            const newConversationEntry: Conversation = {
              id: newConversation.id,
              title: newConversation.title || 'Untitled conversation',
              created_at: newConversation.created_at || new Date().toISOString(),
              updatedAt: newConversation.created_at || new Date().toISOString(),
            };
            setConversations((prev) => {
              const exists = prev.some((c) => c.id === newConversationEntry.id);
              if (exists) return prev;
              return [newConversationEntry, ...prev];
            });
          } catch (err) {
            console.warn(
              '[useChat] Failed to create conversation upfront, falling back to sequential:',
              err
            );
            // Fall through to original sequential behavior
          }
        }

        // Execute requests - parallel if we have conversation ID, sequential otherwise
        if (effectiveConversationId && activeComparisonModels.length > 0) {
          // All requests can run in parallel since we have the conversation ID
          const primaryPromise = executeRequest(primaryModel, true, {
            conversationId: effectiveConversationId,
          });

          const secondaryPromises = activeComparisonModels.map((modelId) => {
            const linkedConversationId = linkedConversationsRef.current[modelId];
            return executeRequest(modelId, false, {
              conversationId: linkedConversationId || undefined,
              parentConversationId: linkedConversationId ? undefined : effectiveConversationId,
            });
          });

          await Promise.all([primaryPromise, ...secondaryPromises]);
        } else {
          // Original sequential behavior for non-comparison mode or fallback
          const primaryPromise = executeRequest(primaryModel, true, {
            conversationId: conversationId || undefined,
          });

          // For comparison mode without upfront conversation, wait for primary
          primaryPromise.then((primaryResponse) => {
            const parentId = primaryResponse?.conversation?.id || conversationId || undefined;
            activeComparisonModels.forEach((modelId) => {
              const linkedConversationId = linkedConversationsRef.current[modelId];
              void executeRequest(modelId, false, {
                conversationId: linkedConversationId || undefined,
                parentConversationId: linkedConversationId ? undefined : parentId,
              });
            });
          });

          await primaryPromise;
        }

        setStatus('idle');
        setPending((prev) => ({
          ...prev,
          streaming: false,
          tokenStats: tokenStatsRef.current ?? undefined,
        }));
      } catch (err) {
        // Fallback global error catcher if primary execution fails synchronously before try block
        // (should unlikely reach here due to inner try/catch)
        setError(err instanceof Error ? err.message : 'Unknown error');
        setStatus('idle');
        setPending((prev) => ({ ...prev, streaming: false }));
      } finally {
        currentRequestIdRef.current = null;
        abortControllerRef.current = null;
      }
    },
    [input, images, files, conversationId, modelCapabilities, compareModels, user?.id]
  );

  const stopStreaming = useCallback(() => {
    const requestId = currentRequestIdRef.current;
    if (requestId) {
      void chat.stopMessage({ requestId });
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setStatus('idle');
    setPending((prev) => ({ ...prev, streaming: false }));
  }, []);

  const regenerate = useCallback(
    async (baseMessages: Message[]) => {
      setMessages(baseMessages);

      if (baseMessages.length === 0) return;

      const comparisonModelsOverride = Array.from(
        new Set(baseMessages.flatMap((message) => Object.keys(message.comparisonResults || {})))
      );

      const lastUserMessage = baseMessages
        .slice()
        .reverse()
        .find((m) => m.role === 'user');

      if (lastUserMessage) {
        // When regenerating, reuse the original user message id and avoid
        // appending a duplicate local user message (baseMessages already contain it).
        await sendMessage(
          typeof lastUserMessage.content === 'string' ? lastUserMessage.content : '',
          {
            clientMessageId: lastUserMessage.id,
            skipLocalUserMessage: true,
            comparisonModelsOverride:
              comparisonModelsOverride.length > 0 ? comparisonModelsOverride : undefined,
          }
        );
      }
    },
    [sendMessage]
  );

  const retryComparisonModel = useCallback(
    async (messageId: string, modelId: string) => {
      if (status === 'streaming') return;

      const currentMessages = messagesRef.current;
      const assistantIdx = currentMessages.findIndex(
        (msg) => msg.id === messageId && msg.role === 'assistant'
      );
      if (assistantIdx === -1) return;

      const historySource = currentMessages.slice(0, assistantIdx);
      if (historySource.length === 0) return;

      const isEmptyAssistantPlaceholder = (msg: Message) =>
        msg.role === 'assistant' &&
        (msg.content === '' || (Array.isArray(msg.content) && msg.content.length === 0)) &&
        (!Array.isArray(msg.tool_calls) || msg.tool_calls.length === 0) &&
        (!Array.isArray(msg.tool_outputs) || msg.tool_outputs.length === 0);

      const isPrimary = modelId === 'primary';
      const modelKey = isPrimary ? modelRef.current : modelId;
      if (!modelKey) return;

      const history = buildHistoryForModel(
        historySource.filter((msg) => !isEmptyAssistantPlaceholder(msg)),
        modelKey,
        isPrimary
      );
      if (history.length === 0) return;

      const actualModelId = modelKey.includes('::') ? modelKey.split('::')[1] : modelKey;
      let targetProviderId = providerIdRef.current || '';
      if (modelKey.includes('::')) {
        targetProviderId = modelKey.split('::')[0];
      } else if (modelToProviderRef.current[modelKey]) {
        targetProviderId = modelToProviderRef.current[modelKey];
      }

      const targetConversationId = isPrimary
        ? conversationId || undefined
        : linkedConversationsRef.current[modelKey] || undefined;
      const parentConversationId =
        !isPrimary && !targetConversationId ? conversationId || undefined : undefined;

      setStatus('streaming');
      setError(null);

      abortControllerRef.current = new AbortController();
      const requestId = `retry-${messageId}-${modelKey}-${Date.now()}`;
      currentRequestIdRef.current = requestId;
      setPending({
        streaming: true,
        error: undefined,
        abort: abortControllerRef.current,
      });

      if (isPrimary) {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === messageId
              ? {
                  ...msg,
                  content: '',
                  tool_calls: undefined,
                  tool_outputs: undefined,
                  message_events: undefined,
                  usage: undefined,
                }
              : msg
          )
        );
      } else {
        setMessages((prev) =>
          prev.map((msg) => {
            if (msg.id !== messageId) return msg;
            const existing = msg.comparisonResults?.[modelKey];
            return {
              ...msg,
              comparisonResults: {
                ...(msg.comparisonResults || {}),
                [modelKey]: {
                  ...(existing || {}),
                  content: '',
                  status: 'streaming' as const,
                  error: undefined,
                  tool_calls: undefined,
                  tool_outputs: undefined,
                  message_events: undefined,
                  usage: undefined,
                },
              },
            };
          })
        );
      }

      const updateTargetMessageState = (
        updater: (
          current: Message | { content: MessageContent; tool_calls?: any[]; tool_outputs?: any[] }
        ) =>
          | Partial<Message>
          | Partial<{ content: MessageContent; tool_calls?: any[]; tool_outputs?: any[] }>
      ) => {
        setMessages((prev) =>
          prev.map((msg) => {
            if (msg.id !== messageId) return msg;
            if (isPrimary) {
              const updates = updater(msg);
              return { ...msg, ...updates };
            }
            const existing = msg.comparisonResults?.[modelKey];
            if (!existing) return msg;
            const updates = updater(existing);
            return {
              ...msg,
              comparisonResults: {
                ...(msg.comparisonResults || {}),
                [modelKey]: { ...existing, ...updates },
              },
            };
          })
        );
      };

      const reasoning =
        qualityLevelRef.current !== 'unset' ? { effort: qualityLevelRef.current } : undefined;

      try {
        const response = await chat.sendMessage({
          messages: history,
          model: actualModelId,
          providerId: targetProviderId,
          stream: shouldStreamRef.current,
          providerStream: providerStreamRef.current,
          requestId,
          signal: abortControllerRef.current?.signal,
          conversationId: targetConversationId,
          parentConversationId,
          streamingEnabled: shouldStreamRef.current,
          toolsEnabled: useToolsRef.current,
          tools: enabledToolsRef.current,
          qualityLevel: qualityLevelRef.current,
          reasoning,
          systemPrompt: systemPromptRef.current || undefined,
          activeSystemPromptId: activeSystemPromptIdRef.current || undefined,
          modelCapabilities: modelCapabilities,
          onToken: (token: string) => {
            updateTargetMessageState((current) => {
              const currentContent = typeof current.content === 'string' ? current.content : '';
              return { content: currentContent + token };
            });
          },
          onEvent: (event) => {
            if (event.type === 'text') {
              updateTargetMessageState((current) => {
                const currentContent = typeof current.content === 'string' ? current.content : '';
                return { content: currentContent + event.value };
              });
            } else if (event.type === 'tool_call') {
              updateTargetMessageState((current) => {
                const currentTextLength =
                  typeof current.content === 'string' ? current.content.length : 0;
                const existingToolCalls = current.tool_calls || [];
                const updatedToolCalls = mergeToolCallDelta(
                  existingToolCalls,
                  event.value,
                  currentTextLength
                );
                return { tool_calls: updatedToolCalls };
              });
            } else if (event.type === 'tool_output') {
              updateTargetMessageState((current) => {
                const outputValue = event.value;
                const toolCallId = outputValue.tool_call_id;
                const outputName = outputValue.name;
                const existingToolOutputs = current.tool_outputs || [];

                const existingIdx = existingToolOutputs.findIndex((out: any) => {
                  if (toolCallId && out.tool_call_id) return out.tool_call_id === toolCallId;
                  if (outputName && out.name) return out.name === outputName;
                  return false;
                });

                if (existingIdx === -1) {
                  return { tool_outputs: [...existingToolOutputs, outputValue] };
                }
                return {};
              });
            } else if (event.type === 'usage') {
              updateTargetMessageState(() => ({ usage: event.value }));
            }
          },
        } as ChatOptionsExtended);

        if (isPrimary) {
          const responseContent = response.content as MessageContent;
          updateTargetMessageState(() => ({
            content: responseContent ?? '',
          }));
          if (response.conversation?.id && !conversationId) {
            setConversationId(response.conversation.id);
          }
          const effectiveConversationId = response.conversation?.id ?? conversationId;
          if (effectiveConversationId) {
            conversationsApi.invalidateDetailCache(effectiveConversationId);
          }
          conversationsApi.clearListCache();
        } else {
          setMessages((prev) =>
            prev.map((msg) => {
              if (msg.id !== messageId) return msg;
              const existing = msg.comparisonResults?.[modelKey];
              if (!existing) return msg;

              const responseContent = response.content as MessageContent;
              const hasResponseContent =
                typeof responseContent === 'string'
                  ? responseContent.length > 0
                  : Array.isArray(responseContent)
                    ? responseContent.length > 0
                    : responseContent != null;
              const finalContent = hasResponseContent ? responseContent : existing.content;

              return {
                ...msg,
                comparisonResults: {
                  ...(msg.comparisonResults || {}),
                  [modelKey]: {
                    ...existing,
                    content: finalContent,
                    status: 'complete' as const,
                  },
                },
              };
            })
          );

          if (response.conversation?.id) {
            setLinkedConversations((prev) => ({
              ...prev,
              [modelKey]: response.conversation!.id,
            }));
          }
          const effectiveConversationId = response.conversation?.id ?? targetConversationId;
          if (effectiveConversationId) {
            conversationsApi.invalidateDetailCache(effectiveConversationId);
          }
          conversationsApi.clearListCache();
        }
      } catch (err) {
        let errorMessage: string;
        if (err instanceof StreamingNotSupportedError) {
          errorMessage = 'Streaming not supported by provider';
        } else if (err instanceof APIError) {
          errorMessage = formatUpstreamError(err);
        } else if (err instanceof Error && err.name === 'AbortError') {
          errorMessage = 'Message cancelled';
        } else if (err instanceof Error) {
          errorMessage = err.message;
        } else {
          errorMessage = 'Failed to regenerate';
        }

        if (isPrimary) {
          setError(errorMessage);
        } else {
          setMessages((prev) =>
            prev.map((msg) => {
              if (msg.id !== messageId) return msg;
              const existing = msg.comparisonResults?.[modelKey];
              if (!existing) return msg;
              return {
                ...msg,
                comparisonResults: {
                  ...(msg.comparisonResults || {}),
                  [modelKey]: {
                    ...existing,
                    status: 'error' as const,
                    error: errorMessage,
                  },
                },
              };
            })
          );
        }
      } finally {
        setStatus('idle');
        setPending((prev) => ({ ...prev, streaming: false }));
        currentRequestIdRef.current = null;
        abortControllerRef.current = null;
      }
    },
    [status, conversationId, modelCapabilities]
  );

  // Actions - Editing
  const startEdit = useCallback((messageId: string, content: MessageContent) => {
    setEditingMessageId(messageId);
    // Convert MessageContent to string for editing
    const contentStr =
      typeof content === 'string'
        ? content
        : content.map((c) => (c.type === 'text' ? c.text : '[Image]')).join('\n');
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
      setMessages((prev) =>
        prev.map((m) => (m.id === editingMessageId ? { ...m, content: editingContent } : m))
      );

      // If a new conversation was created, update the conversation ID
      if (result.new_conversation_id !== conversationId) {
        setConversationId(result.new_conversation_id);
        setCompareModels([]);
        setLinkedConversations({});
        setMessages((prev) =>
          prev.map((message) =>
            message.comparisonResults ? { ...message, comparisonResults: undefined } : message
          )
        );
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
      const providersList = providersResponse.data.providers.filter(
        (p: Provider) => p.enabled === 1
      );

      if (providersList.length === 0) {
        setModelGroups([]);
        setModelOptions([]);
        setModelToProvider({});
        modelToProviderRef.current = {};
        return;
      }

      // Fetch models for each provider
      const groups: ModelGroup[] = [];
      const options: ModelOption[] = [];
      const modelToProviderMap: Record<string, string> = {};
      const capabilitiesMap: Record<string, any> = {};

      for (const provider of providersList) {
        try {
          const modelsResponse = await httpClient.get<{ provider: any; models: any[] }>(
            `/v1/providers/${provider.id}/models`
          );
          const models = modelsResponse.data.models || [];

          if (models.length > 0) {
            // Create model options for this provider with provider-qualified values
            const providerOptions: ModelOption[] = models.map((model: any) => ({
              value: `${provider.id}::${model.id}`,
              label: model.id,
            }));

            groups.push({
              id: provider.id,
              label: provider.name,
              options: providerOptions,
            });

            options.push(...providerOptions);

            // Build model to provider mapping (now using qualified model IDs)
            // and store model capabilities
            models.forEach((model: any) => {
              const qualifiedId = `${provider.id}::${model.id}`;
              modelToProviderMap[qualifiedId] = provider.id;
              capabilitiesMap[qualifiedId] = model;

              if (!modelToProviderMap[model.id]) {
                modelToProviderMap[model.id] = provider.id;
              }

              if (Array.isArray(model.aliases)) {
                for (const alias of model.aliases) {
                  if (typeof alias === 'string' && !modelToProviderMap[alias]) {
                    modelToProviderMap[alias] = provider.id;
                  }
                }
              }
            });
          }
        } catch (err) {
          console.warn(`Failed to load models for provider ${provider.name}:`, err);
        }
      }

      setModelGroups(groups);
      setModelOptions(options);
      setModelToProvider(modelToProviderMap);
      setModelCapabilities(capabilitiesMap);
      modelToProviderRef.current = modelToProviderMap;

      // Set default provider if not already set (use functional update to avoid capturing providerId)
      if (providersList.length > 0) {
        setProviderId((prev) => {
          const nextValue = prev ?? providersList[0].id;
          providerIdRef.current = nextValue;
          return nextValue;
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load models');
    } finally {
      setIsLoadingModels(false);
    }
  }, []);

  const setInlineSystemPromptOverride = useCallback((prompt: string | null) => {
    setSystemPrompt(prompt);
    systemPromptRef.current = prompt;
  }, []);

  // Wrapper setters that update both state and refs to avoid stale closures
  const setProviderIdWrapper = useCallback(
    (id: string | null | ((prev: string | null) => string | null)) => {
      setProviderId((prev) => {
        const nextValue = typeof id === 'function' ? id(prev) : id;
        providerIdRef.current = nextValue;
        return nextValue;
      });
    },
    []
  );

  const setUseToolsWrapper = useCallback((value: boolean) => {
    setUseTools(value);
    useToolsRef.current = value;
  }, []);

  const setEnabledToolsWrapper = useCallback((tools: string[]) => {
    setEnabledTools(tools);
    enabledToolsRef.current = tools;
  }, []);

  const setShouldStreamWrapper = useCallback((value: boolean) => {
    setShouldStream(value);
    shouldStreamRef.current = value;
    // Control upstream streaming based on user toggle
    // This affects whether backend requests streaming from upstream provider
    providerStreamRef.current = value;
  }, []);

  const setQualityLevelWrapper = useCallback((level: QualityLevel) => {
    setQualityLevel(level);
    qualityLevelRef.current = level;
  }, []);

  const setActiveSystemPromptIdWrapper = useCallback((id: string | null | undefined) => {
    setActiveSystemPromptId(id);
    activeSystemPromptIdRef.current = id;
  }, []);

  // Load user profile on mount
  useEffect(() => {
    const loadUser = async () => {
      try {
        const profile = await auth.getProfile();
        setUser({ id: profile.id });
      } catch {
        // User not authenticated, that's ok
      }
    };
    loadUser();
  }, []);

  // Use system prompts hook (depends on user)
  const { prompts: systemPrompts, loading: systemPromptsLoading } = useSystemPrompts(user?.id);

  // Auto-select builtin:default when prompts load and there's no active conversation.
  // Run only once per mount to avoid clobbering any user selection.
  const defaultPromptAssignedRef = useRef(false);
  useEffect(() => {
    if (defaultPromptAssignedRef.current) return;
    if (conversationId) return; // only for new chats
    if (systemPromptsLoading) return;
    if (!systemPrompts) return;

    // If conversation loaded (activeSystemPromptIdRef.current !== undefined),
    // don't override with default, even if null
    if (activeSystemPromptIdRef.current !== undefined || systemPromptRef.current) {
      defaultPromptAssignedRef.current = true;
      return;
    }

    // If DEFAULT_SYSTEM_PROMPT_ID is null, clear the system prompt
    if (DEFAULT_SYSTEM_PROMPT_ID === null) {
      setSystemPrompt('');
      systemPromptRef.current = '';
      setActiveSystemPromptId(null);
      activeSystemPromptIdRef.current = null;
    } else {
      const defaultPrompt = systemPrompts.built_ins.find((p) => p.id === DEFAULT_SYSTEM_PROMPT_ID);
      if (defaultPrompt) {
        // Apply to local chat state and refs so UI and sendMessage use it
        setSystemPrompt(defaultPrompt.body);
        systemPromptRef.current = defaultPrompt.body;
        setActiveSystemPromptId(defaultPrompt.id);
        activeSystemPromptIdRef.current = defaultPrompt.id;
      }
    }

    // Mark as assigned even if default not present to avoid re-checks
    defaultPromptAssignedRef.current = true;
  }, [systemPrompts, systemPromptsLoading, conversationId]);

  // Load providers and models on mount
  useEffect(() => {
    loadProvidersAndModels();
  }, [loadProvidersAndModels]);

  // Normalize comparison models once model options are available so UI selections resolve.
  useEffect(() => {
    if (compareModels.length === 0 || modelOptions.length === 0) return;

    const optionValues = new Set(modelOptions.map((option) => option.value));
    let didChange = false;
    const normalized: string[] = [];

    for (const modelId of compareModels) {
      let nextModel = modelId;

      if (!optionValues.has(nextModel) && !nextModel.includes('::')) {
        const providerId =
          modelToProviderRef.current[nextModel] || modelToProvider[nextModel] || '';
        const qualified = providerId ? `${providerId}::${nextModel}` : '';
        if (qualified && optionValues.has(qualified)) {
          nextModel = qualified;
          didChange = true;
        }
      }

      if (!normalized.includes(nextModel)) {
        if (nextModel !== modelId) didChange = true;
        normalized.push(nextModel);
      } else if (nextModel === modelId) {
        didChange = true;
      }
    }

    if (didChange) {
      setCompareModels(normalized);
    }
  }, [compareModels, modelOptions, modelToProvider]);

  // Restore draft message when user and conversation are available
  // This preserves drafts across session expiry and re-authentication
  useEffect(() => {
    // Only restore if we have a user, conversation is loaded, and haven't restored yet
    if (!user?.id || draftRestoredRef.current) {
      return;
    }

    // Small delay to ensure state is settled
    const timer = setTimeout(() => {
      const savedDraft = getDraft(user.id, conversationId);
      if (savedDraft && savedDraft.trim()) {
        setInput(savedDraft);
      }
      draftRestoredRef.current = true;
    }, 100);

    return () => clearTimeout(timer);
  }, [user?.id, conversationId]);

  // Debounced save of draft to localStorage
  // Saves 1 second after user stops typing to avoid excessive localStorage writes
  useEffect(() => {
    if (!user?.id || !input.trim()) {
      return;
    }

    const timer = setTimeout(() => {
      setDraft(user.id, conversationId, input);
    }, 1000);

    return () => clearTimeout(timer);
  }, [input, user?.id, conversationId]);

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
    pending,
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
    files,
    user,
    activeSystemPromptId,
    systemPrompt,
    compareModels,
    linkedConversations,

    // Actions
    setMessages,
    setInput,
    setModel,
    setProviderId: setProviderIdWrapper,
    setUseTools: setUseToolsWrapper,
    setEnabledTools: setEnabledToolsWrapper,
    setShouldStream: setShouldStreamWrapper,
    setQualityLevel: setQualityLevelWrapper,
    setImages,
    setFiles,
    setActiveSystemPromptId: setActiveSystemPromptIdWrapper,
    setCompareModels,
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
    retryComparisonModel,
    startEdit,
    cancelEdit,
    updateEditContent,
    saveEdit,
    loadProvidersAndModels,
    setInlineSystemPromptOverride,
  };
}
