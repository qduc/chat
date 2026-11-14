/**
 * One `Model` wrapper per ChatForge provider, and a per-turn registry.
 *
 * The wrappers share `ProviderModel`'s streaming core; each adds only what its
 * provider does differently. Wrappers hold no module-level state: every turn
 * builds its own, so concurrent turns (comparison mode, many users) never share
 * a request, a cache key or a continuation.
 */
import { addPromptCaching } from '../promptCaching.js';
import { ProviderModel } from './providerModel.ts';
import type { ChatCompletionsBody, ChatForgeProvider, ProviderModelOptions } from './providerModel.ts';
import type { ModelRef, ModelRegistry, ModelRequest } from '@qduc/agent-core';

/** Applies ChatForge's cache breakpoints when the provider supports them. */
async function withPromptCaching(
  body: ChatCompletionsBody,
  request: ModelRequest,
  provider: ChatForgeProvider,
  userId: string | null,
): Promise<ChatCompletionsBody> {
  // The JSDoc on addPromptCaching types these as strings; both are only logged.
  const options = {
    conversationId: request.affinity?.conversationKey,
    userId,
    provider,
    hasTools: Boolean(body.tools?.length),
  } as Parameters<typeof addPromptCaching>[1];
  return (await addPromptCaching(body, options)) as ChatCompletionsBody;
}

/** OpenAI and OpenAI-compatible servers (Chat Completions or Responses API). */
export class OpenAIModel extends ProviderModel {
  /**
   * Only the Responses API holds server-side state to continue from.
   * OpenRouter answers 400 for `previous_response_id` ("not supported on this
   * proxy"), so those requests always send the full history.
   */
  protected override supportsContinuation(): boolean {
    if (!(this.provider.shouldUseResponsesAPI?.() ?? false)) return false;
    const baseUrl = `${this.provider.baseUrl ?? ''} ${this.provider.settings?.baseUrl ?? ''}`.toLowerCase();
    return !baseUrl.includes('openrouter.ai');
  }

  /** OpenRouter passes Anthropic-style breakpoints through for Claude models. */
  protected override finalizeBody(body: ChatCompletionsBody, request: ModelRequest): Promise<ChatCompletionsBody> {
    return withPromptCaching(body, request, this.provider, this.userId);
  }
}

/** llama.cpp's server: OpenAI-compatible, with its own reasoning format (set by the provider). */
export class LlamaCppModel extends OpenAIModel {
  protected override supportsContinuation(): boolean {
    return false;
  }
}

/** Anthropic Messages API. Prompt-cache breakpoints are placed here, per request. */
export class AnthropicModel extends ProviderModel {
  protected override finalizeBody(body: ChatCompletionsBody, request: ModelRequest): Promise<ChatCompletionsBody> {
    return withPromptCaching(body, request, this.provider, this.userId);
  }
}

/** Gemini. Thought signatures round-trip on tool_call items' providerMetadata. */
export class GeminiModel extends ProviderModel {}

const WRAPPERS: Record<string, new (options: ProviderModelOptions) => ProviderModel> = {
  'openai-responses': OpenAIModel,
  'openai-completions': OpenAIModel,
  openai: OpenAIModel,
  'llama-cpp': LlamaCppModel,
  anthropic: AnthropicModel,
  gemini: GeminiModel,
};

/** The wrapper for a provider instance, chosen by its provider type. */
export function createModel(options: ProviderModelOptions): ProviderModel {
  const type = (options.provider.settings?.providerType ?? 'openai-completions').toLowerCase();
  const Wrapper = WRAPPERS[type] ?? OpenAIModel;
  return new Wrapper(options);
}

/** A registry over the models one turn may use. */
export function createModelRegistry(models: readonly ProviderModel[]): ModelRegistry {
  const key = (ref: ModelRef) => `${ref.provider}\u0000${ref.model}`;
  const byRef = new Map(models.map((model) => [key(model.ref), model]));
  return {
    resolve(ref) {
      const model = byRef.get(key(ref));
      if (!model) throw new Error(`No model registered for ${ref.provider}/${ref.model}`);
      return model;
    },
    list() {
      return models.map((model) => model.ref);
    },
  };
}
