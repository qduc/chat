import { describe, expect, test } from '@jest/globals';
import {
  computeModelCost,
  formatUsdMicros,
  parseUsdMicros,
  reportedUsageCost,
  selectPriceTier,
} from '../../src/lib/modelCatalog/modelCost.ts';
import type { PricingLookupResult } from '../../src/lib/modelCatalog/modelCost.ts';
import { pricingTargetForProvider } from '../../src/lib/modelCatalog/providerTarget.ts';
import type { PricingTarget } from '../../src/lib/modelCatalog/providerTarget.ts';
import { computeUsageCost, toBillableUsage, toClientUsage } from '../../src/lib/modelCatalog/usageCost.ts';

const ANTHROPIC: PricingTarget = { catalogProvider: 'anthropic', catalogPriced: true };
const OPENAI: PricingTarget = { catalogProvider: 'openai', catalogPriced: true };
const LOCAL: PricingTarget = { catalogProvider: null, catalogPriced: false };

// claude-sonnet-4-5 (anthropic): input 3, output 15, cache read 0.3, cache write 3.75 per MTok.
const cachedRequest = {
  prompt_tokens: 10_000, // full prompt: 3000 uncached + 6000 cache reads + 1000 cache writes
  cache_read_input_tokens: 6_000,
  cache_creation_input_tokens: 1_000,
  completion_tokens: 500,
};

describe('toBillableUsage', () => {
  test('moves cache writes out of prompt_tokens for the cost math', () => {
    expect(toBillableUsage(cachedRequest)).toEqual({
      prompt_tokens: 9_000,
      completion_tokens: 500,
      cache_read_tokens: 6_000,
      cache_creation_tokens: 1_000,
    });
  });

  test('writes larger than the prompt leave the prompt unknown (ambiguous)', () => {
    expect(toBillableUsage({ prompt_tokens: 10, cache_creation_input_tokens: 20, completion_tokens: 1 })).toEqual({
      completion_tokens: 1,
      cache_creation_tokens: 20,
    });
  });
});

describe('computeUsageCost', () => {
  test('catalog estimate with cache reads/writes and cache savings', () => {
    // 3000*3 + 6000*0.3 + 1000*3.75 + 500*15 = 9000 + 1800 + 3750 + 7500 micros
    // savings: 6000 * (3 - 0.3) = 16200 micros
    expect(computeUsageCost([cachedRequest], 'claude-sonnet-4-5', ANTHROPIC)).toEqual({
      usd: 0.02205,
      source: 'catalog',
      cache_savings_usd: 0.0162,
    });
  });

  test('dated model ids resolve by dash-bounded prefix', () => {
    expect(computeUsageCost([cachedRequest], 'claude-sonnet-4-5-20250929', ANTHROPIC)?.usd).toBe(0.02205);
  });

  test('a provider-reported charge wins over the catalog estimate', () => {
    expect(computeUsageCost([{ ...cachedRequest, provider_cost_usd: 0.5 }], 'claude-sonnet-4-5', ANTHROPIC)).toEqual({
      usd: 0.5,
      source: 'provider',
      cache_savings_usd: 0.0162,
    });
  });

  test('a provider-reported charge prices even unknown models; a reported $0 is kept', () => {
    expect(computeUsageCost([{ prompt_tokens: 1, completion_tokens: 1, provider_cost_usd: 0.0001 }], 'nope-xyz')).toEqual({
      usd: 0.0001,
      source: 'provider',
    });
    expect(computeUsageCost([{ provider_cost_usd: 0 }], 'nope-xyz')).toEqual({ usd: 0, source: 'provider' });
  });

  test('no cache savings without cache reads', () => {
    expect(computeUsageCost([{ prompt_tokens: 1000, completion_tokens: 100 }], 'claude-sonnet-4-5', ANTHROPIC)).toEqual({
      usd: 0.0045,
      source: 'catalog',
    });
  });

  test('unpriced usage is omitted, never reported as $0', () => {
    expect(computeUsageCost([{ prompt_tokens: 10, completion_tokens: 5 }], 'definitely-not-a-model-xyz')).toBeUndefined();
    expect(computeUsageCost([{ prompt_tokens: 10 }], 'claude-sonnet-4-5', ANTHROPIC)).toBeUndefined();
    expect(computeUsageCost([], 'claude-sonnet-4-5', ANTHROPIC)).toBeUndefined();
    expect(computeUsageCost([{ prompt_tokens: 10, completion_tokens: 5 }], null)).toBeUndefined();
    expect(
      computeUsageCost([{ prompt_tokens: 10, cache_read_input_tokens: 20, completion_tokens: 5 }], 'claude-sonnet-4-5', ANTHROPIC),
    ).toBeUndefined();
  });

  test('local servers are never catalog-priced', () => {
    expect(computeUsageCost([{ prompt_tokens: 1000, completion_tokens: 100 }], 'gpt-4.1', LOCAL)).toBeUndefined();
    expect(computeUsageCost([{ prompt_tokens: 1000, completion_tokens: 100, provider_cost_usd: 0.01 }], 'gpt-4.1', LOCAL)).toEqual({
      usd: 0.01,
      source: 'provider',
    });
  });

  test('pricing tiers apply per request on the full input', () => {
    // gpt-5.4: base 2.5/15, above 272k input: 5/22.5
    expect(computeUsageCost([{ prompt_tokens: 1_000, completion_tokens: 1_000 }], 'gpt-5.4', OPENAI)?.usd).toBe(0.0175);
    expect(computeUsageCost([{ prompt_tokens: 300_000, completion_tokens: 1_000 }], 'gpt-5.4', OPENAI)?.usd).toBe(1.5225);
  });

  test('a message spanning several requests sums them; mixed sources report catalog', () => {
    const cost = computeUsageCost(
      [
        { prompt_tokens: 1000, completion_tokens: 100 },
        { prompt_tokens: 1000, completion_tokens: 100, provider_cost_usd: 0.01 },
      ],
      'claude-sonnet-4-5',
      ANTHROPIC,
    );
    expect(cost).toEqual({ usd: 0.0145, source: 'catalog' });
  });

  test('one unpriced request leaves the whole message unpriced', () => {
    expect(
      computeUsageCost([{ prompt_tokens: 1000, completion_tokens: 100 }, { prompt_tokens: 1000 }], 'claude-sonnet-4-5', ANTHROPIC),
    ).toBeUndefined();
  });

  test('later model candidates are tried when the first does not price', () => {
    expect(
      computeUsageCost([{ prompt_tokens: 1000, completion_tokens: 100 }], ['my-alias-xyz', 'claude-sonnet-4-5'], ANTHROPIC)?.usd,
    ).toBe(0.0045);
  });

  test('gateways fall back to the model id across catalog providers', () => {
    const gateway = pricingTargetForProvider({ id: 'my-gw', provider_type: 'openai', base_url: 'https://llm.example.com' });
    expect(computeUsageCost([{ prompt_tokens: 1000, completion_tokens: 100 }], 'claude-sonnet-4-5', gateway)?.usd).toBe(0.0045);
  });
});

describe('toClientUsage', () => {
  test('adds cost and drops the internal provider_cost_usd field', () => {
    const usage = toClientUsage(
      { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100, provider_cost_usd: 0.002, model: 'x' },
      'claude-sonnet-4-5',
      ANTHROPIC,
    );
    expect(usage).toEqual({
      prompt_tokens: 1000,
      completion_tokens: 100,
      total_tokens: 1100,
      model: 'x',
      cost: { usd: 0.002, source: 'provider' },
    });
  });

  test('leaves cost off when unpriced', () => {
    expect(toClientUsage({ prompt_tokens: 1, completion_tokens: 1 }, 'nope-xyz')).toEqual({ prompt_tokens: 1, completion_tokens: 1 });
  });
});

describe('pricingTargetForProvider', () => {
  test.each([
    [{ provider_type: 'openai', base_url: 'https://openrouter.ai/api' }, 'openrouter', true],
    [{ provider_type: 'openai', base_url: 'https://api.openai.com/v1' }, 'openai', true],
    [{ provider_type: 'openai-responses', base_url: 'https://api.openai.com' }, 'openai', true],
    [{ provider_type: 'anthropic', base_url: null }, 'anthropic', true],
    [{ provider_type: 'anthropic', base_url: 'https://api.anthropic.com' }, 'anthropic', true],
    [{ provider_type: 'openai', base_url: 'https://api.moonshot.ai/v1' }, 'moonshotai', true],
    [{ id: 'openrouter', provider_type: 'openai', base_url: 'https://proxy.example.com' }, 'openrouter', true],
    [{ provider_type: 'gemini', base_url: null }, null, true],
    [{ provider_type: 'openai', base_url: 'https://llm.example.com' }, null, true],
    [{ provider_type: 'openai', base_url: 'http://localhost:1234' }, null, false],
    [{ provider_type: 'openai', base_url: 'http://192.168.1.5:8080' }, null, false],
    [{ provider_type: 'llama-cpp', base_url: 'https://gpu.example.com' }, null, false],
  ])('%j -> %s (priced %s)', (provider, catalogProvider, catalogPriced) => {
    expect(pricingTargetForProvider(provider)).toEqual({ catalogProvider, catalogPriced });
  });

  test('missing provider uses the model id alone', () => {
    expect(pricingTargetForProvider(null)).toEqual({ catalogProvider: null, catalogPriced: true });
  });
});

describe('cost math (agent-core) as wired here', () => {
  const price: PricingLookupResult = {
    found: true,
    price: {
      inputPerMTok: 1,
      outputPerMTok: 2,
      cacheReadPerMTok: 0.1,
      tiers: [{ inputTokensAbove: 100, inputPerMTok: 10, outputPerMTok: 20, cacheReadPerMTok: 1 }],
    },
  };
  const base = { requestId: 'r', provider: 'p', model: 'm', serviceTier: 'standard' as const, outcome: 'completed' as const };

  test('selectPriceTier matches computeModelCost tier selection', () => {
    expect(selectPriceTier(price.found ? price.price : (undefined as never), 100).inputPerMTok).toBe(1);
    expect(selectPriceTier(price.found ? price.price : (undefined as never), 101).inputPerMTok).toBe(10);
    const above = computeModelCost({ ...base, usage: { prompt_tokens: 101, completion_tokens: 0 }, getPrice: () => price });
    expect(above.usdMicros).toBe(1010);
  });

  test('provider charge precedence and typed unpriced reasons', () => {
    expect(computeModelCost({ ...base, providerUsd: '0.0000015', getPrice: () => price })).toMatchObject({
      usdMicros: 2,
      source: 'provider',
    });
    expect(computeModelCost({ ...base, getPrice: () => price }).unpricedReason).toBe('missing_usage');
    expect(computeModelCost({ ...base, usage: { prompt_tokens: 1 }, getPrice: () => price }).unpricedReason).toBe(
      'ambiguous_usage',
    );
  });

  test('parseUsdMicros parses decimals exactly', () => {
    expect(parseUsdMicros('0.1234565')).toBe(123457);
    expect(parseUsdMicros(0.000001)).toBe(1);
    expect(parseUsdMicros('abc')).toBeUndefined();
  });

  test('formatUsdMicros never shows a positive cost as $0.00', () => {
    expect(formatUsdMicros(0)).toBe('$0.00');
    expect(formatUsdMicros(1234)).toBe('$0.001234');
    expect(formatUsdMicros(1_235_000)).toBe('$1.24');
  });
});

describe('reportedUsageCost', () => {
  test('reads OpenRouter cost, falling back to the upstream figure', () => {
    expect(reportedUsageCost({ cost: 0.0012 })).toBe(0.0012);
    expect(reportedUsageCost({ cost_details: { upstream_inference_cost: '0.002' } })).toBe('0.002');
    expect(reportedUsageCost({ cost: 0.001, cost_details: { upstream_inference_cost: 0.00095 } })).toBe(0.001);
  });

  test('BYOK adds the upstream charge to the fee, or reports nothing without it', () => {
    expect(reportedUsageCost({ is_byok: true, cost: 0, cost_details: { upstream_inference_cost: 0.003 } })).toBe(0.003);
    expect(reportedUsageCost({ is_byok: true, cost: 0 })).toBeUndefined();
  });

  test('ignores unusable values', () => {
    expect(reportedUsageCost({ cost: -1 })).toBeUndefined();
    expect(reportedUsageCost({ cost: { usd: 1 } })).toBeUndefined();
    expect(reportedUsageCost(null)).toBeUndefined();
  });
});
