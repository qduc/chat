/**
 * Maps a ChatForge provider (user-created: an id, a name, a provider type and a
 * base URL) onto the catalog provider whose prices apply.
 *
 * - Well-known hosts map directly: openrouter.ai -> `openrouter`,
 *   api.openai.com -> `openai`, api.anthropic.com -> `anthropic`,
 *   api.moonshot.ai/.cn -> `moonshotai`.
 * - Otherwise a provider whose id or name is itself a catalog provider id (e.g.
 *   a provider named "openrouter") maps to it, and provider type `anthropic`
 *   maps to `anthropic`.
 * - Anything else (OpenAI-compatible gateways, Gemini, ...) maps to no catalog
 *   provider: lookups then use the catalog's cross-provider model-id fallback,
 *   as term2 does for gateways.
 * - Local servers (type `llama-cpp`, localhost/private-network hosts) are never
 *   catalog-priced: they cost nothing per token, and a borrowed cloud rate
 *   would be misleading. A provider-reported charge still applies.
 */
import { getProviderById } from '../../db/providers.js';
import { CATALOG_PROVIDER_IDS } from './catalog.ts';

export interface PricingTarget {
  /** Catalog provider id to prefer, or null to match by model id alone. */
  readonly catalogProvider: string | null;
  /** False when catalog estimates must not be used (local servers). */
  readonly catalogPriced: boolean;
}

export const UNKNOWN_PRICING_TARGET: PricingTarget = { catalogProvider: null, catalogPriced: true };

export interface ProviderDescriptor {
  readonly id?: string | null;
  readonly name?: string | null;
  readonly provider_type?: string | null;
  readonly base_url?: string | null;
}

const HOST_TO_CATALOG: ReadonlyArray<readonly [RegExp, string]> = [
  [/(^|\.)openrouter\.ai$/, 'openrouter'],
  [/^api\.openai\.com$/, 'openai'],
  [/^api\.anthropic\.com$/, 'anthropic'],
  [/^api\.moonshot\.(ai|cn)$/, 'moonshotai'],
];

function hostOf(baseUrl: string | null | undefined): string | null {
  if (!baseUrl || typeof baseUrl !== 'string') return null;
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(baseUrl) ? baseUrl : `http://${baseUrl}`;
    return new URL(withScheme).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    return null;
  }
}

function isLocalHost(host: string): boolean {
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal'))
    return true;
  if (host === '::1' || host === '0.0.0.0' || host.startsWith('fe80:') || /^f[cd][0-9a-f]{2}:/.test(host)) return true;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (!ipv4) return false;
  const a = Number(ipv4[1]);
  const b = Number(ipv4[2]);
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
}

/** Pricing target for a provider row / settings object. Pure. */
export function pricingTargetForProvider(provider: ProviderDescriptor | null | undefined): PricingTarget {
  if (!provider) return UNKNOWN_PRICING_TARGET;
  const type = (provider.provider_type ?? '').toLowerCase();
  const host = hostOf(provider.base_url);

  if (type === 'llama-cpp' || (host && isLocalHost(host))) return { catalogProvider: null, catalogPriced: false };

  if (host) {
    for (const [pattern, catalogProvider] of HOST_TO_CATALOG) {
      if (pattern.test(host)) return { catalogProvider, catalogPriced: true };
    }
  }

  for (const candidate of [provider.id, provider.name]) {
    const key = typeof candidate === 'string' ? candidate.trim().toLowerCase() : '';
    if (key && CATALOG_PROVIDER_IDS.includes(key)) return { catalogProvider: key, catalogPriced: true };
  }
  // Messages API format: prefer Anthropic's own rates. Only a preference; a
  // non-Claude model behind an Anthropic-compatible endpoint still falls back.
  if (type === 'anthropic') return { catalogProvider: 'anthropic', catalogPriced: true };
  return UNKNOWN_PRICING_TARGET;
}

/**
 * Pricing target for a stored provider id, scoped to its owner. Unknown or
 * foreign providers resolve to the model-id-only target.
 */
export function resolvePricingTarget(providerId: string | null | undefined, userId: string | null | undefined): PricingTarget {
  if (!providerId || !userId) return UNKNOWN_PRICING_TARGET;
  try {
    const row = getProviderById(providerId, userId) as ProviderDescriptor | null;
    return pricingTargetForProvider(row);
  } catch {
    return UNKNOWN_PRICING_TARGET;
  }
}

/** Per-call cache so a page of messages resolves each provider once. */
export function createPricingTargetResolver(userId: string | null | undefined): (providerId: string | null | undefined) => PricingTarget {
  const cache = new Map<string, PricingTarget>();
  return (providerId) => {
    if (!providerId) return UNKNOWN_PRICING_TARGET;
    let target = cache.get(providerId);
    if (!target) {
      target = resolvePricingTarget(providerId, userId);
      cache.set(providerId, target);
    }
    return target;
  };
}
