/**
 * Model catalog lookup: context window, output limit and per-MTok prices for a
 * provider/model pair.
 *
 * Ported from qduc/term2 (MIT License, Copyright (c) 2025 qduc),
 * src/model/providers/model-catalog/catalog.ts, 2026-11-17. The matching
 * rules are unchanged; ChatForge adds a memoized `getCatalogModel` because it
 * prices every stored message on read.
 *
 * Refreshing the data: `catalog.generated.ts` is vendored data. term2
 * regenerates it from OpenRouter's models API (`/api/v1/models`) plus preserved
 * native-provider snapshots; copy the regenerated file over ours and keep the
 * provenance header at its top. No code change is needed unless its schema
 * (`CATALOG_META.schemaVersion`) changes.
 */
import { MODEL_CATALOG } from './catalog.generated.ts';

/** Slim model metadata vendored from the catalog. */
export interface CatalogModelInfo {
  contextWindow: number;
  maxTokens?: number;
  /** Per-million-token USD input price; absent when the catalog carries no price. */
  inputPricePerMTok?: number;
  /** Per-million-token USD output price; absent when the catalog carries no price. */
  outputPricePerMTok?: number;
  /** Per-million-token USD cache-read price; absent when not distinguished. */
  cacheReadPricePerMTok?: number;
  /** Per-million-token USD cache-write price; absent when not distinguished. */
  cacheWritePricePerMTok?: number;
  cacheWrite1hPricePerMTok?: number;
  pricingTiers?: readonly (Omit<CatalogModelInfo, 'contextWindow' | 'maxTokens' | 'pricingTiers'> & {
    inputTokensAbove: number;
  })[];
}

/** provider id -> model id -> model metadata */
export type ModelCatalogData = Readonly<Record<string, Readonly<Record<string, CatalogModelInfo>>>>;

/** The vendored catalog, typed loosely enough to index by arbitrary ids. */
export const CATALOG: ModelCatalogData = MODEL_CATALOG;

/** Provider ids the vendored catalog carries. */
export const CATALOG_PROVIDER_IDS: readonly string[] = Object.keys(MODEL_CATALOG);

function normalizeId(id: string): string {
  return id.trim().toLowerCase();
}

/**
 * Drop a leading `vendor/` segment. Catalog ids under aggregator providers are
 * vendor-qualified (`deepseek/deepseek-v4-flash` under openrouter) while the
 * same model reached through a gateway is usually configured bare
 * (`deepseek-v4-flash`), and vice versa; stripping makes the two comparable.
 */
function stripVendor(id: string): string {
  const slash = id.indexOf('/');
  return slash === -1 ? id : id.slice(slash + 1);
}

/** `wanted` extends `catalogId` on a `-` boundary, so `gpt-4` never matches `gpt-4o`. */
function isDashBoundedPrefix(wanted: string, catalogId: string): boolean {
  return wanted.length > catalogId.length && wanted.startsWith(catalogId) && wanted[catalogId.length] === '-';
}

/**
 * Match quality tiers, best first. Exactness outranks vendor-prefix agreement:
 * an id that matches exactly once a `vendor/` segment is dropped names the
 * model more precisely than a truncated prefix of the full id does. Within a
 * tier, longer matches win. Encoded as `tier * TIER_WEIGHT + matchedLength` so
 * a single numeric score orders matches across providers; the weight exceeds
 * any plausible model-id length, keeping tiers strictly separated.
 */
const TIER_WEIGHT = 1000;
const TIER_EXACT = 3;
const TIER_BARE_EXACT = 2;
const TIER_PREFIX = 1;
const TIER_BARE_PREFIX = 0;

/**
 * Score of the best match for `wanted` inside one provider's models, or
 * undefined when nothing matches. Scores are comparable across providers.
 */
function matchInModels(
  models: Readonly<Record<string, CatalogModelInfo>>,
  wanted: string,
): { info: CatalogModelInfo; score: number } | undefined {
  const exact = Object.hasOwn(models, wanted) ? models[wanted] : undefined;
  if (exact) return { info: exact, score: TIER_EXACT * TIER_WEIGHT + wanted.length };

  const wantedBare = stripVendor(wanted);
  let best: { info: CatalogModelInfo; score: number } | undefined;
  const consider = (info: CatalogModelInfo, tier: number, matchedLength: number) => {
    const score = tier * TIER_WEIGHT + matchedLength;
    if (best === undefined || score > best.score) best = { info, score };
  };

  for (const [catalogId, info] of Object.entries(models)) {
    if (isDashBoundedPrefix(wanted, catalogId)) {
      consider(info, TIER_PREFIX, catalogId.length);
      continue;
    }
    // Comparing bare forms is a no-op when neither id carries a vendor prefix:
    // it can only re-derive the match just rejected, at a strictly lower tier.
    const catalogBare = stripVendor(catalogId);
    if (catalogBare === wantedBare) {
      consider(info, TIER_BARE_EXACT, catalogBare.length);
    } else if (isDashBoundedPrefix(wantedBare, catalogBare)) {
      consider(info, TIER_BARE_PREFIX, catalogBare.length);
    }
  }
  return best;
}

/**
 * Pure catalog lookup against an explicit catalog; exported so the matching
 * rules are unit-testable with synthetic data. Production callers should use
 * getCatalogModel over the vendored catalog.
 *
 * Matching: exact model id first; otherwise the longest catalog id that is a
 * dash-bounded prefix of the requested id (so dated aliases like
 * `claude-sonnet-4-6-20251120` resolve to `claude-sonnet-4-6`). A prefix must
 * end on a `-` boundary so `gpt-4` never matches `gpt-4o`. Both rules are then
 * retried with any leading `vendor/` segment dropped from either side, so a
 * gateway's bare `deepseek-v4-flash` reaches `deepseek/deepseek-v4-flash`.
 */
export function lookupModel(
  catalog: ModelCatalogData,
  providerId: string,
  modelId: string,
): CatalogModelInfo | undefined {
  const key = normalizeId(providerId);
  const provider = Object.hasOwn(catalog, key) ? catalog[key] : undefined;
  if (!provider) return undefined;
  return matchInModels(provider, normalizeId(modelId))?.info;
}

/** One provider's best entry for a requested model id. */
export interface CatalogMatch {
  /** Catalog provider the entry was found under. */
  providerId: string;
  info: CatalogModelInfo;
}

/**
 * Every provider's best entry for a model id, best match first, using the same
 * exact/dash-bounded-prefix rules as the provider-scoped lookup. Callers that
 * need more than the first hit (pricing skips entries with no vendored price)
 * walk the list; callers that just want metadata take `[0]`.
 *
 * Ordering is by match quality, not catalog order: an exact hit under one
 * provider outranks a prefix hit under another, and among prefix hits the
 * longer prefix wins. Ties keep catalog order.
 */
export function findModelMatches(catalog: ModelCatalogData, modelId: string): CatalogMatch[] {
  const wanted = normalizeId(modelId);
  const matches: Array<CatalogMatch & { score: number }> = [];
  for (const [providerId, models] of Object.entries(catalog)) {
    const match = matchInModels(models, wanted);
    if (match) matches.push({ providerId, info: match.info, score: match.score });
  }
  return matches.sort((a, b) => b.score - a.score).map(({ providerId, info }) => ({ providerId, info }));
}

/**
 * Look up metadata for a model against an explicit catalog. The provider id is
 * only a preference: it picks which entry wins when several providers list the
 * same model, and a miss there falls back to matching the model id alone
 * (ChatForge providers are user-created, often OpenAI-compatible gateways whose
 * id is never in the catalog, but a model id is a reliable key).
 */
export function lookupCatalogModel(
  catalog: ModelCatalogData,
  providerId: string | null | undefined,
  modelId: string,
): CatalogModelInfo | undefined {
  return (
    (providerId ? lookupModel(catalog, providerId, modelId) : undefined) ?? findModelMatches(catalog, modelId)[0]?.info
  );
}

/** Bounded memo: the catalog is static per deploy, but model ids come from users. */
const MEMO_LIMIT = 2000;

export function createMemo<V>(limit = MEMO_LIMIT): { get(key: string, compute: () => V): V; clear(): void } {
  const entries = new Map<string, V>();
  return {
    get(key, compute) {
      if (entries.has(key)) return entries.get(key) as V;
      const value = compute();
      if (entries.size >= limit) {
        const oldest = entries.keys().next();
        if (!oldest.done) entries.delete(oldest.value);
      }
      entries.set(key, value);
      return value;
    },
    clear() {
      entries.clear();
    },
  };
}

const modelMemo = createMemo<CatalogModelInfo | undefined>();

/** Vendored metadata for a model (memoized per provider+model). */
export function getCatalogModel(providerId: string | null | undefined, modelId: string): CatalogModelInfo | undefined {
  if (!modelId || !modelId.trim()) return undefined;
  const provider = providerId ? normalizeId(providerId) : '';
  return modelMemo.get(`${provider}\u0000${normalizeId(modelId)}`, () =>
    lookupCatalogModel(CATALOG, provider || null, modelId),
  );
}
