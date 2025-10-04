/**
 * Utilities for building chat configuration objects
 */

import type { ChatMessage, Role } from '../../../lib/chat';

export interface ChatConfigRefs {
  modelRef: string;
  systemPromptRef: string;
  inlineSystemPromptRef: string;
  activeSystemPromptIdRef: string | null;
  shouldStreamRef: boolean;
  reasoningEffortRef: string;
  verbosityRef: string;
  qualityLevelRef: string;
  providerRef: string | null;
}

export interface ChatConfigState {
  conversationId: string | null;
  previousResponseId: string | null;
  providerId: string | null;
  useTools: boolean;
  enabledTools: string[];
  modelCapabilities: Record<string, any>;
}

export interface ChatConfigCallbacks {
  onEvent: (event: any) => void;
  onToken: (token: string) => void;
}

/**
 * Builds a configuration object for sending a chat request
 */
export function buildChatConfig(
  messages: ChatMessage[],
  signal: AbortSignal,
  refs: ChatConfigRefs,
  state: ChatConfigState,
  callbacks: ChatConfigCallbacks
): any {
  // Use inline override if available, otherwise fall back to system prompt.
  const effectiveSystemPrompt = ((refs.inlineSystemPromptRef || refs.systemPromptRef) || '').trim();

  const outgoing = effectiveSystemPrompt
    ? ([{ role: 'system', content: effectiveSystemPrompt } as any, ...messages])
    : messages;

  const config: any = {
    messages: outgoing.map(m => ({ role: m.role as Role, content: m.content })),
    // Prefer the synchronous ref which is updated immediately when the user
    // selects a model. This avoids a race where a model change dispatch
    // hasn't flushed to React state yet but an immediate regenerate/send
    // should use the newly selected model.
    model: refs.modelRef,
    signal,
    conversationId: state.conversationId || undefined,
    responseId: state.previousResponseId || undefined,
    systemPrompt: effectiveSystemPrompt || undefined,
    activeSystemPromptId: refs.activeSystemPromptIdRef || undefined,
    // Use refs for chat parameters to ensure immediate updates are used
    shouldStream: refs.shouldStreamRef,
    reasoningEffort: refs.reasoningEffortRef,
    verbosity: refs.verbosityRef,
    qualityLevel: refs.qualityLevelRef,
    modelCapabilities: state.modelCapabilities,
    onEvent: callbacks.onEvent,
    onToken: callbacks.onToken,
  };

  // Only add providerId if it's not null
  if (state.providerId) {
    config.providerId = refs.providerRef || state.providerId;
  }

  // Add tools if enabled
  if (state.useTools && state.enabledTools.length > 0) {
    config.tools = state.enabledTools;
    config.tool_choice = 'auto';
  }

  return config;
}
