/**
 * Pricing lookup backed by the vendored model catalog (standard tier only).
 *
 * Ported from qduc/term2 (MIT License, Copyright (c) 2025 qduc),
 * src/model/cost/pricing.ts, 2026-11-17. term2's flex/batch overlay is dropped:
 * ChatForge requests are always priced at the standard tier.
 *
 * Matching prefers the named catalog provider and falls back to the same model
 * under any other provider, because a model id identifies a model more reliably
 * than a provider id: ChatForge providers are user-created, and many are
 * OpenAI-compatible gateways the catalog has never heard of. A borrowed rate is
 * flagged (`pricedFromProvider`); gateways resell at their own margins, so such
 * a charge is an estimate.
 */
import { CATALOG, createMemo, findModelMatches, getCatalogModel, lookupModel } from './catalog.ts';
import type { CatalogModelInfo } from './catalog.ts';
import { isValidCatalogPrice } from './modelCost.ts';
import type { CatalogPrice, PricingLookupResult, ServiceTier } from './modelCost.ts';

function normalizeId(id: string): string {
  return id.trim().toLowerCase();
}

type PriceFields = Omit<CatalogModelInfo, 'contextWindow' | 'maxTokens'>;

function entryToCatalogPrice(entry: PriceFields): CatalogPrice | undefined {
  const price: Partial<CatalogPrice> = {
    inputPerMTok: entry.inputPricePerMTok,
    outputPerMTok: entry.outputPricePerMTok,
    ...(entry.cacheReadPricePerMTok !== undefined ? { cacheReadPerMTok: entry.cacheReadPricePerMTok } : {}),
    ...(entry.cacheWritePricePerMTok !== undefined ? { cacheWritePerMTok: entry.cacheWritePricePerMTok } : {}),
    ...(entry.cacheWrite1hPricePerMTok !== undefined ? { cacheWrite1hPerMTok: entry.cacheWrite1hPricePerMTok } : {}),
  };
  if (entry.pricingTiers !== undefined) {
    const tiers: Array<Omit<CatalogPrice, 'tiers'> & { inputTokensAbove: number }> = [];
    for (const tier of entry.pricingTiers) {
      const tierPrice = entryToCatalogPrice(tier);
      // An unpriced tier makes the whole rate card unusable.
      if (!tierPrice) return undefined;
      tiers.push({ ...tierPrice, inputTokensAbove: tier.inputTokensAbove });
    }
    price.tiers = tiers;
  }
  return isValidCatalogPrice(price) ? price : undefined;
}

function lookupStandardPrice(providerId: string, modelId: string): PricingLookupResult {
  const ownEntry = providerId ? lookupModel(CATALOG, providerId, modelId) : undefined;
  const ownPrice = ownEntry ? entryToCatalogPrice(ownEntry) : undefined;
  if (ownPrice) return { found: true, price: ownPrice };

  // Fall back to the best-matching entry under another provider that actually
  // carries a price; an unpriced entry is no better than a miss.
  for (const match of findModelMatches(CATALOG, modelId)) {
    if (match.providerId === providerId) continue;
    const price = entryToCatalogPrice(match.info);
    if (price) return { found: true, price, pricedFromProvider: match.providerId };
  }
  return {
    found: false,
    reason: providerId && !Object.hasOwn(CATALOG, providerId) ? 'unknown_provider' : 'unknown_model',
  };
}

const priceMemo = createMemo<PricingLookupResult>();

/**
 * Price for a catalog provider/model at a service tier. Only `standard` is
 * priced; anything else is a typed `unknown_tier` miss. Memoized per
 * provider+model (the catalog is static per deploy).
 */
export function getModelPricing(provider: string | null | undefined, model: string, tier: ServiceTier = 'standard'): PricingLookupResult {
  if (tier !== 'standard') return { found: false, reason: 'unknown_tier' };
  if (!model || !model.trim()) return { found: false, reason: 'unknown_model' };
  const providerId = provider ? normalizeId(provider) : '';
  const modelId = normalizeId(model);
  return priceMemo.get(`${providerId}\u0000${modelId}`, () => lookupStandardPrice(providerId, modelId));
}

/** Client-facing model metadata (`GET /v1/models/info`). */
export interface ModelInfo {
  model: string;
  context_window: number | null;
  max_output_tokens: number | null;
  pricing: null | {
    input_per_mtok: number;
    output_per_mtok: number;
    cache_read_per_mtok: number | null;
    cache_write_per_mtok: number | null;
  };
}

/** Context window, output limit and base (untiered) rates for a model; nulls when unknown. */
export function getModelInfo(provider: string | null | undefined, model: string): ModelInfo {
  const info = getCatalogModel(provider, model);
  const pricing = getModelPricing(provider, model);
  return {
    model,
    context_window: info?.contextWindow ?? null,
    max_output_tokens: info?.maxTokens ?? null,
    pricing: pricing.found
      ? {
          input_per_mtok: pricing.price.inputPerMTok,
          output_per_mtok: pricing.price.outputPerMTok,
          cache_read_per_mtok: pricing.price.cacheReadPerMTok ?? null,
          cache_write_per_mtok: pricing.price.cacheWritePerMTok ?? null,
        }
      : null,
  };
}
