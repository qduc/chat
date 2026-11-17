import { reportedUsageCost } from '../modelCatalog/modelCost.ts';

function toNumber(value) {
  if (value == null) return undefined;
  const asNumber = Number(value);
  if (!Number.isFinite(asNumber)) return undefined;
  return asNumber;
}

function coalesceNumber(...values) {
  for (const value of values) {
    const num = toNumber(value);
    if (num != null) return num;
  }
  return undefined;
}

function sumNumbers(...values) {
  let total = 0;
  let found = false;
  for (const value of values) {
    const num = toNumber(value);
    if (num == null) continue;
    total += num;
    found = true;
  }
  return found ? total : undefined;
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

/**
 * Normalize provider usage into ChatForge's usage shape.
 *
 * Conventions (the same for every provider):
 * - `prompt_tokens` is the FULL prompt: uncached input + cache reads + cache
 *   writes. OpenAI Chat Completions, OpenRouter, the Responses API and Gemini
 *   already report it that way. Native Anthropic (Messages API) reports
 *   `input_tokens` EXCLUDING cache reads and writes, so they are added back.
 * - `cache_read_input_tokens` / `cache_creation_input_tokens` are subsets of
 *   `prompt_tokens`.
 * - `provider_cost_usd` is the charge the provider reported (OpenRouter
 *   `usage.cost`, BYOK-aware), when there is one.
 *
 * Idempotent: normalizing an already-normalized object yields the same values.
 * Several improvements are ported back from qduc/term2's token-usage.ts (which
 * started as a port of this file).
 */
export function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object') return undefined;

  const promptDetails =
    asRecord(usage.prompt_tokens_details) ??
    asRecord(usage.promptTokensDetails) ??
    asRecord(usage.input_tokens_details) ??
    asRecord(usage.inputTokensDetails);

  let promptTokens = coalesceNumber(
    usage.prompt_tokens,
    usage.input_tokens,
    usage.input_token_count,
    usage.prompt_token_count,
    usage.promptTokenCount,
    usage.inputTokenCount,
    typeof usage.inputTokens === 'number' ? usage.inputTokens : undefined,
    usage.prompt_n !== undefined
      ? (toNumber(usage.cache_n) || 0) + toNumber(usage.prompt_n)
      : undefined
  );

  const completionTokens = coalesceNumber(
    usage.completion_tokens,
    usage.output_tokens,
    usage.output_token_count,
    usage.completion_token_count,
    usage.candidatesTokenCount,
    usage.outputTokenCount,
    typeof usage.outputTokens === 'number' ? usage.outputTokens : undefined,
    usage.predicted_n,
  );

  const cacheCreationTokens = coalesceNumber(
    usage.cache_creation_input_tokens,
    usage.cacheCreationInputTokens,
    // OpenRouter: prompt_tokens_details.cache_write_tokens (already inside prompt_tokens)
    promptDetails?.cache_write_tokens,
    promptDetails?.cacheWriteTokens,
    promptDetails?.cache_creation_input_tokens,
    promptDetails?.cache_creation_tokens,
  );

  const cacheReadTokens = coalesceNumber(
    usage.cache_read_input_tokens,
    usage.cacheReadInputTokens,
    // OpenAI-style: prompt_tokens_details.cached_tokens (Chat Completions) and
    // input_tokens_details.cached_tokens (Responses API)
    promptDetails?.cached_tokens,
    promptDetails?.cachedTokens,
    // Gemini: cachedContentTokenCount (already inside promptTokenCount)
    usage.cachedContentTokenCount,
    usage.cached_content_token_count,
    // DeepSeek: prompt_cache_hit_tokens (already inside prompt_tokens)
    usage.prompt_cache_hit_tokens,
  );

  // Native Anthropic: `input_tokens` excludes cache reads and writes. Only the
  // raw shape (no `prompt_tokens`) is adjusted, so re-normalizing is a no-op.
  if (
    usage.prompt_tokens == null &&
    usage.input_tokens != null &&
    promptTokens != null &&
    (usage.cache_read_input_tokens != null || usage.cache_creation_input_tokens != null)
  ) {
    promptTokens += (cacheReadTokens ?? 0) + (cacheCreationTokens ?? 0);
  }

  // prompt_tokens already includes every cache dimension.
  const totalTokens = coalesceNumber(
    usage.total_tokens,
    usage.total_token_count,
    usage.totalTokenCount,
    typeof usage.totalTokens === 'number' ? usage.totalTokens : undefined,
  ) ?? sumNumbers(
    promptTokens,
    completionTokens,
  );

  const providerCostUsd = coalesceNumber(reportedUsageCost(usage), usage.provider_cost_usd);

  const reasoningTokens = coalesceNumber(
    usage.reasoning_tokens,
    usage.reasoning_token_count,
    usage?.completion_tokens_details?.reasoning_tokens,
    usage?.output_tokens_details?.reasoning_tokens,
    usage.thoughtsTokenCount,
    usage.thoughts_token_count,
  );

  const promptMs = coalesceNumber(
    usage.prompt_ms,
    usage.promptMs,
  );

  const completionMs = coalesceNumber(
    usage.completion_ms,
    usage.completionMs,
    usage.predicted_ms,
    usage.predictedMs,
    usage.output_ms,
    usage.outputMs,
  );

  const mapped = {};
  if (promptTokens != null) mapped.prompt_tokens = promptTokens;
  if (completionTokens != null) mapped.completion_tokens = completionTokens;
  if (totalTokens != null) mapped.total_tokens = totalTokens;
  if (reasoningTokens != null) mapped.reasoning_tokens = reasoningTokens;
  if (cacheCreationTokens != null) mapped.cache_creation_input_tokens = cacheCreationTokens;
  if (cacheReadTokens != null) mapped.cache_read_input_tokens = cacheReadTokens;
  if (providerCostUsd != null && providerCostUsd >= 0) mapped.provider_cost_usd = providerCostUsd;
  if (promptMs != null) mapped.prompt_ms = promptMs;
  if (completionMs != null) mapped.completion_ms = completionMs;
  if (usage.model) mapped.model = String(usage.model);
  if (usage.provider) mapped.provider = String(usage.provider);

  return Object.keys(mapped).length > 0 ? mapped : undefined;
}

export function extractUsage(payload) {
  if (!payload || typeof payload !== 'object') return undefined;

  const results = [];

  const direct = normalizeUsage(payload.usage);
  if (direct) results.push(direct);

  const metadata = normalizeUsage(payload.usageMetadata || payload.usage_metadata);
  if (metadata) results.push(metadata);

  const nested = normalizeUsage(payload.response?.usage);
  if (nested) results.push(nested);

  const timings = normalizeUsage(payload.timings);
  if (timings) results.push(timings);

  if (results.length === 0) return undefined;

  // Merge results: earlier ones take precedence for overlapping fields
  // (e.g. payload.usage is preferred over payload.timings)
  const merged = {};
  for (let i = results.length - 1; i >= 0; i--) {
    Object.assign(merged, results[i]);
  }

  // If model or provider are at the top level (common in some streaming formats), include them
  if (!merged.model && payload.model) merged.model = String(payload.model);
  if (!merged.provider && payload.provider) merged.provider = String(payload.provider);

  return Object.keys(merged).length > 0 ? merged : undefined;
}
