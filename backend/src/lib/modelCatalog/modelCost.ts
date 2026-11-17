/**
 * Cost helpers around `@qduc/agent-core`'s cost arithmetic.
 *
 * The arithmetic itself (`computeModelCost`, `resolveBillableTokens`,
 * `parseUsdMicros`, `isValidCatalogPrice`) is imported from agent-core and
 * re-exported here so ChatForge code has one import site. Note agent-core's
 * `NormalizedUsage` (exported here as `BillableUsage`) counts `prompt_tokens`
 * WITHOUT cache writes, unlike ChatForge's usage; convert with
 * `toBillableUsage` (usageCost.ts).
 *
 * `reportedUsageCost` and `formatUsdMicros` are ported from qduc/term2
 * (MIT License, Copyright (c) 2025 qduc), src/shared/cost/model-cost.ts,
 * 2026-11-17. `selectPriceTier` and `toMicros` mirror agent-core's internal
 * tier selection and rounding, needed for the cache-savings figure.
 */
import type { CatalogPrice, NormalizedUsage } from '@qduc/agent-core';

export { computeModelCost, isValidCatalogPrice, parseUsdMicros, resolveBillableTokens } from '@qduc/agent-core';
export type {
  BillableTokens,
  BillableTokensResult,
  CatalogPrice,
  CostSource,
  ModelCostInput,
  ModelRequestCost,
  PricingLookupResult,
  ServiceTier,
  UnpricedReason,
} from '@qduc/agent-core';

/** agent-core's usage shape: `prompt_tokens` includes cache reads, excludes cache writes. */
export type BillableUsage = NormalizedUsage;

const USD_MICROS_PER_DOLLAR = 1_000_000;
const USD_MICROS_PER_CENT = 10_000;
const MICRO_FRACTION_DIGITS = 6;

/** USD micros for `tokens` at `dollarsPerMTok`, rounded once (as agent-core does). */
export function toMicros(dollarsPerMTok: number, tokens: number): number {
  const scaled = dollarsPerMTok * 1000;
  return Math.round((tokens * scaled) / 1000);
}

/**
 * The rate card that applies to a request with `fullInputTokens` (all input
 * including cache reads and writes): the tier with the highest threshold the
 * request exceeds, else the base rates. Same rule as agent-core's computeModelCost.
 */
export function selectPriceTier(price: CatalogPrice, fullInputTokens: number): Omit<CatalogPrice, 'tiers'> {
  let selected: Omit<CatalogPrice, 'tiers'> = price;
  let matchedThreshold = -1;
  for (const tier of price.tiers ?? []) {
    if (fullInputTokens > tier.inputTokensAbove && tier.inputTokensAbove > matchedThreshold) {
      matchedThreshold = tier.inputTokensAbove;
      selected = tier;
    }
  }
  return selected;
}

/**
 * Format integer micros as USD: two decimals at or above one cent, enough
 * precision below one cent that a positive cost is never `$0.00`, `$0.00` for zero.
 */
export function formatUsdMicros(usdMicros: number): string {
  const sign = usdMicros < 0 ? '-' : '';
  const abs = Math.abs(usdMicros);
  if (abs === 0) return '$0.00';

  const dollars = Math.floor(abs / USD_MICROS_PER_DOLLAR);
  const fraction = abs % USD_MICROS_PER_DOLLAR;

  if (abs >= USD_MICROS_PER_CENT) {
    const centsWithCarry = Math.round(fraction / USD_MICROS_PER_CENT);
    const totalCents = dollars * 100 + centsWithCarry;
    const whole = Math.floor(totalCents / 100);
    const cents = totalCents % 100;
    return `${sign}$${whole}.${String(cents).padStart(2, '0')}`;
  }

  const microsText = String(fraction).padStart(MICRO_FRACTION_DIGITS, '0').replace(/0+$/, '');
  return `${sign}$0.${microsText || '0'}`;
}

function costRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/** A usable charge: a finite, non-negative number or numeric string; anything else is unusable. */
function usableCost(value: unknown): number | string | undefined {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : undefined;
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? value : undefined;
}

/**
 * The charge a provider usage object reports, in provider units (USD for
 * OpenRouter). Reads the snake_case wire fields and camelCase SDK forms.
 *
 * OpenRouter reports `cost` as what it charged the account's credits and
 * `cost_details.upstream_inference_cost` as what the upstream provider charged.
 * Without bring-your-own-key they describe the same request, so adding them
 * would double count. With `is_byok: true` OpenRouter bills only its BYOK fee
 * (often `cost: 0`) and the upstream charge goes to the user's own key, so the
 * request costs the sum. A BYOK frame without a usable upstream figure returns
 * undefined so the request is estimated or unpriced rather than an exact
 * fee-only charge. Negative or non-finite values are unusable.
 */
export function reportedUsageCost(usage: unknown): number | string | undefined {
  const record = costRecord(usage);
  if (!record) return undefined;
  const cost = usableCost(record.cost);
  const details = costRecord(record.cost_details) ?? costRecord(record.costDetails);
  const upstream = usableCost(details?.upstream_inference_cost ?? details?.upstreamInferenceCost);
  if ((record.is_byok ?? record.isByok) === true) {
    if (upstream === undefined || (record.cost != null && cost === undefined)) return undefined;
    return Number(cost ?? 0) + Number(upstream);
  }
  return cost ?? upstream;
}
