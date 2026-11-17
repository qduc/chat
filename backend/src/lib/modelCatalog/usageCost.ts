/**
 * Turns ChatForge usage into the client-facing `cost` object:
 *
 *     cost?: { usd: number; source: 'provider' | 'catalog'; cache_savings_usd?: number }
 *
 * - A provider-reported charge (OpenRouter `usage.cost`) wins: `source: 'provider'`.
 * - Otherwise the catalog estimate: `source: 'catalog'`.
 * - Unpriced (unknown model, missing/ambiguous usage, local server) -> no
 *   `cost` at all; never `$0` for an unknown price.
 * - `cache_savings_usd`: cache-read tokens at the uncached input rate minus the
 *   same tokens at the cache-read rate, when the catalog knows both rates and
 *   the request read from cache.
 *
 * One assistant message can span several model requests (tool rounds). Each
 * request is priced on its own (tiered rates are per request) and the charges
 * add up; if any request is unpriced, the message has no `cost`.
 */
import { computeModelCost, resolveBillableTokens, selectPriceTier, toMicros } from './modelCost.ts';
import type { BillableUsage } from './modelCost.ts';
import { getModelPricing } from './pricing.ts';
import { UNKNOWN_PRICING_TARGET } from './providerTarget.ts';
import type { PricingTarget } from './providerTarget.ts';

/** Usage of one model request, in ChatForge's normalized field names. */
export interface RequestUsage {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  provider_cost_usd?: number | null;
}

export interface ClientCost {
  usd: number;
  source: 'provider' | 'catalog';
  cache_savings_usd?: number;
}

const USD_MICROS_PER_DOLLAR = 1_000_000;

function finiteOrUndefined(value: unknown): number | undefined {
  if (value == null) return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

/**
 * ChatForge usage -> the cost math's usage shape. ChatForge's `prompt_tokens`
 * includes cache writes; the cost math's excludes them.
 */
export function toBillableUsage(usage: RequestUsage): BillableUsage {
  const prompt = finiteOrUndefined(usage.prompt_tokens);
  const completion = finiteOrUndefined(usage.completion_tokens);
  const cacheRead = finiteOrUndefined(usage.cache_read_input_tokens);
  const cacheWrite = finiteOrUndefined(usage.cache_creation_input_tokens);
  const billable: BillableUsage = {};
  if (prompt !== undefined) {
    // Writes larger than the whole prompt cannot be mapped: leave the prompt
    // unknown so the request is reported as ambiguous instead of mispriced.
    if (cacheWrite === undefined || cacheWrite <= prompt) billable.prompt_tokens = prompt - (cacheWrite ?? 0);
  }
  if (completion !== undefined) billable.completion_tokens = completion;
  if (cacheRead !== undefined) billable.cache_read_tokens = cacheRead;
  if (cacheWrite !== undefined) billable.cache_creation_tokens = cacheWrite;
  return billable;
}

function cacheSavingsMicros(usage: RequestUsage, target: PricingTarget, model: string): number | undefined {
  const cacheRead = finiteOrUndefined(usage.cache_read_input_tokens) ?? 0;
  if (cacheRead <= 0 || !target.catalogPriced || !model) return undefined;
  const tokens = resolveBillableTokens(toBillableUsage(usage));
  if (tokens === 'missing' || tokens === 'ambiguous') return undefined;
  const lookup = getModelPricing(target.catalogProvider, model);
  if (!lookup.found) return undefined;
  const fullInputTokens = tokens.uncachedInputTokens + tokens.cachedInputTokens + tokens.cacheWriteTokens;
  const price = selectPriceTier(lookup.price, fullInputTokens);
  if (price.cacheReadPerMTok == null) return undefined;
  return toMicros(price.inputPerMTok, cacheRead) - toMicros(price.cacheReadPerMTok, cacheRead);
}

type ModelCandidates = string | null | undefined | readonly (string | null | undefined)[];

/**
 * Cost of the model requests behind one message, or undefined when unpriced.
 * `models` may list several ids for the same model (e.g. the requested id and
 * the id the upstream reported); the first one that prices wins.
 */
export function computeUsageCost(
  requests: readonly RequestUsage[],
  models: ModelCandidates,
  target: PricingTarget = UNKNOWN_PRICING_TARGET,
): ClientCost | undefined {
  const list = Array.isArray(models) ? models : [models];
  const candidates = [...new Set(list.map((m) => (typeof m === 'string' ? m.trim() : '')).filter(Boolean))];
  if (candidates.length === 0) candidates.push('');
  for (const modelId of candidates) {
    const cost = computeForModel(requests, modelId, target);
    if (cost) return cost;
  }
  return undefined;
}

function computeForModel(requests: readonly RequestUsage[], modelId: string, target: PricingTarget): ClientCost | undefined {
  if (requests.length === 0) return undefined;
  let totalMicros = 0;
  let estimated = false;
  let savingsMicros = 0;
  let savingsKnown = false;

  for (const [index, request] of requests.entries()) {
    const providerCost = finiteOrUndefined(request.provider_cost_usd);
    const result = computeModelCost({
      requestId: String(index),
      serviceTier: 'standard',
      outcome: 'completed',
      provider: target.catalogProvider ?? '',
      model: modelId,
      usage: toBillableUsage(request),
      ...(providerCost !== undefined && providerCost >= 0 ? { providerUsd: providerCost } : {}),
      getPrice: (provider, priceModel, tier) =>
        target.catalogPriced && priceModel
          ? getModelPricing(provider, priceModel, tier)
          : { found: false, reason: priceModel ? 'unknown_provider' : 'unknown_model' },
    });
    if (result.usdMicros === undefined) return undefined;
    totalMicros += result.usdMicros;
    if (result.source !== 'provider') estimated = true;

    const savings = cacheSavingsMicros(request, target, modelId);
    if (savings !== undefined) {
      savingsMicros += savings;
      savingsKnown = true;
    }
  }

  return {
    usd: totalMicros / USD_MICROS_PER_DOLLAR,
    source: estimated ? 'catalog' : 'provider',
    ...(savingsKnown ? { cache_savings_usd: savingsMicros / USD_MICROS_PER_DOLLAR } : {}),
  };
}

/**
 * Client-facing copy of one normalized usage object (one model request): drops
 * the internal `provider_cost_usd` and adds `cost` when priced. Non-objects pass
 * through unchanged.
 */
export function toClientUsage<T>(usage: T, models: ModelCandidates, target?: PricingTarget): T {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return usage;
  const { provider_cost_usd: providerCost, cost: _ignored, ...rest } = usage as Record<string, unknown>;
  const cost = computeUsageCost(
    [{ ...(rest as RequestUsage), provider_cost_usd: finiteOrUndefined(providerCost) ?? null }],
    models,
    target,
  );
  return { ...rest, ...(cost ? { cost } : {}) } as T;
}
