import { describe, expect, test } from '@jest/globals';
import {
  CATALOG_PROVIDER_IDS,
  findModelMatches,
  getCatalogModel,
  lookupCatalogModel,
  lookupModel,
} from '../../src/lib/modelCatalog/catalog.ts';
import type { ModelCatalogData } from '../../src/lib/modelCatalog/catalog.ts';
import { getModelInfo, getModelPricing } from '../../src/lib/modelCatalog/pricing.ts';

const catalog: ModelCatalogData = {
  openai: {
    'gpt-4': { contextWindow: 8192, inputPricePerMTok: 30, outputPricePerMTok: 60 },
    'gpt-4o': { contextWindow: 128000, inputPricePerMTok: 2.5, outputPricePerMTok: 10 },
    'gpt-4o-mini': { contextWindow: 128000 },
  },
  anthropic: {
    'claude-sonnet-4-6': { contextWindow: 200000, inputPricePerMTok: 3, outputPricePerMTok: 15 },
  },
  openrouter: {
    'deepseek/deepseek-v4-flash': { contextWindow: 64000, inputPricePerMTok: 0.1, outputPricePerMTok: 0.2 },
    'anthropic/claude-sonnet-4-6': { contextWindow: 1000000, inputPricePerMTok: 3, outputPricePerMTok: 15 },
  },
};

describe('catalog lookup rules', () => {
  test('exact match is case- and whitespace-insensitive', () => {
    expect(lookupModel(catalog, ' OpenAI ', 'GPT-4o')?.contextWindow).toBe(128000);
  });

  test('dash-bounded prefix resolves dated aliases, never a longer sibling', () => {
    expect(lookupModel(catalog, 'anthropic', 'claude-sonnet-4-6-20251120')?.contextWindow).toBe(200000);
    // `gpt-4` must not match `gpt-4o`, and `gpt-4o-2024-08-06` picks the longest prefix.
    expect(lookupModel(catalog, 'openai', 'gpt-4o-2024-08-06')?.inputPricePerMTok).toBe(2.5);
    expect(lookupModel(catalog, 'openai', 'gpt-4o-mini-2024')?.contextWindow).toBe(128000);
    expect(lookupModel(catalog, 'openai', 'gpt-4.5')).toBeUndefined();
  });

  test('vendor prefix is stripped on either side', () => {
    expect(lookupModel(catalog, 'openrouter', 'deepseek-v4-flash')?.contextWindow).toBe(64000);
    expect(lookupModel(catalog, 'anthropic', 'anthropic/claude-sonnet-4-6')?.contextWindow).toBe(200000);
  });

  test('unknown provider misses in the provider-scoped lookup', () => {
    expect(lookupModel(catalog, 'nope', 'gpt-4o')).toBeUndefined();
    expect(lookupModel(catalog, '__proto__', 'gpt-4o')).toBeUndefined();
  });

  test('cross-provider matches are ordered by match quality', () => {
    const matches = findModelMatches(catalog, 'claude-sonnet-4-6');
    expect(matches.map((m) => m.providerId)).toEqual(['anthropic', 'openrouter']);
    const vendored = findModelMatches(catalog, 'anthropic/claude-sonnet-4-6');
    expect(vendored[0]?.providerId).toBe('openrouter');
  });

  test('provider is a preference; a miss falls back to the model id alone', () => {
    expect(lookupCatalogModel(catalog, 'openrouter', 'claude-sonnet-4-6')?.contextWindow).toBe(1000000);
    expect(lookupCatalogModel(catalog, 'anthropic', 'claude-sonnet-4-6')?.contextWindow).toBe(200000);
    expect(lookupCatalogModel(catalog, 'my-gateway', 'deepseek-v4-flash')?.contextWindow).toBe(64000);
    expect(lookupCatalogModel(catalog, null, 'unknown-model')).toBeUndefined();
  });
});

describe('vendored catalog', () => {
  test('carries the expected providers', () => {
    expect(CATALOG_PROVIDER_IDS).toEqual(expect.arrayContaining(['openai', 'anthropic', 'openrouter']));
  });

  test('getCatalogModel resolves real entries and memoizes', () => {
    const a = getCatalogModel('anthropic', 'claude-sonnet-4-5-20250929');
    expect(a?.contextWindow).toBe(200000);
    expect(getCatalogModel('anthropic', 'claude-sonnet-4-5-20250929')).toBe(a);
    expect(getCatalogModel('openrouter', 'anthropic/claude-sonnet-4.5')?.contextWindow).toBe(1000000);
    expect(getCatalogModel(null, 'definitely-not-a-model-xyz')).toBeUndefined();
    expect(getCatalogModel(null, '')).toBeUndefined();
  });

  test('getModelPricing returns standard rates and flags borrowed ones', () => {
    const own = getModelPricing('openai', 'gpt-4.1');
    expect(own).toEqual({
      found: true,
      price: { inputPerMTok: 2, outputPerMTok: 8, cacheReadPerMTok: 0.5, cacheWritePerMTok: 0 },
    });
    const borrowed = getModelPricing('some-gateway', 'gpt-4.1');
    expect(borrowed.found && borrowed.pricedFromProvider).toBeTruthy();
    expect(getModelPricing('openai', 'gpt-4.1', 'batch')).toEqual({ found: false, reason: 'unknown_tier' });
    expect(getModelPricing(null, 'definitely-not-a-model-xyz')).toEqual({ found: false, reason: 'unknown_model' });
  });

  test('getModelInfo shapes metadata and returns nulls for unknown models', () => {
    expect(getModelInfo('anthropic', 'claude-sonnet-4-5')).toEqual({
      model: 'claude-sonnet-4-5',
      context_window: 200000,
      max_output_tokens: 64000,
      pricing: { input_per_mtok: 3, output_per_mtok: 15, cache_read_per_mtok: 0.3, cache_write_per_mtok: 3.75 },
    });
    expect(getModelInfo(null, 'definitely-not-a-model-xyz')).toEqual({
      model: 'definitely-not-a-model-xyz',
      context_window: null,
      max_output_tokens: null,
      pricing: null,
    });
  });
});
