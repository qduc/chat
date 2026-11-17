/**
 * Pure helpers behind the chat details panel: usage totals, cost labels,
 * context meter, sources, files, chat info and formatting.
 */
import type { ChatMessage } from '../lib/types';
import {
  aggregateUsage,
  computeContextMeter,
  formatCostLabel,
  formatUsageSummaryLine,
} from '../lib/usageSummary';
import { extractSources, parseSearchResultText } from '../lib/conversationSources';
import { extractFiles } from '../lib/conversationFiles';
import { buildChatInfo, formatChatInfoSummary, reasoningEffortLabel } from '../lib/chatInfo';
import {
  formatRelativeTime,
  formatStartedAt,
  formatTokenCount,
  formatUsd,
  hostnameOf,
} from '../lib/detailsFormat';

const assistant = (id: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  role: 'assistant',
  content: '',
  ...extra,
});

describe('aggregateUsage', () => {
  it('returns an empty summary when no assistant message has usage', () => {
    const summary = aggregateUsage([
      { id: 'u', role: 'user', content: 'hi' },
      assistant('a'),
      assistant('b', { usage: {} }),
    ]);
    expect(summary.hasUsage).toBe(false);
    expect(summary.costUsd).toBeNull();
    expect(summary.contextTokens).toBeNull();
    expect(formatCostLabel(summary)).toBeNull();
  });

  it('sums input, cached, output and reasoning tokens over assistant messages', () => {
    const summary = aggregateUsage([
      { id: 'u', role: 'user', content: 'hi', usage: { prompt_tokens: 999 } },
      assistant('a1', {
        usage: { prompt_tokens: 1000, completion_tokens: 200, cache_read_input_tokens: 800 },
      }),
      assistant('a2', {
        usage: { prompt_tokens: 1500, completion_tokens: 300, reasoning_tokens: 120 },
      }),
      assistant('a3', { usage: { prompt_tokens: 10, completion_tokens: 5 }, reasoning_tokens: 7 }),
    ]);
    expect(summary).toMatchObject({
      hasUsage: true,
      input: 2510,
      cached: 800,
      output: 505,
      reasoning: 127,
      // last assistant message with usage: 10 + 5
      contextTokens: 15,
    });
  });

  it('sums provider costs and cache savings', () => {
    const summary = aggregateUsage([
      assistant('a1', {
        usage: {
          prompt_tokens: 1,
          cost: { usd: 0.01, source: 'provider', cache_savings_usd: 0.02 },
        },
      }),
      assistant('a2', {
        usage: {
          prompt_tokens: 1,
          cost: { usd: 0.032, source: 'provider', cache_savings_usd: 0.045 },
        },
      }),
    ]);
    expect(summary.costUsd).toBeCloseTo(0.042);
    expect(summary.cacheSavingsUsd).toBeCloseTo(0.065);
    expect(summary.costEstimated).toBe(false);
    expect(summary.costIncomplete).toBe(false);
    expect(formatCostLabel(summary)).toBe('$0.042');
  });

  it('prefixes "Est." when any cost comes from the catalog', () => {
    const summary = aggregateUsage([
      assistant('a1', { usage: { prompt_tokens: 1, cost: { usd: 0.5, source: 'provider' } } }),
      assistant('a2', { usage: { prompt_tokens: 1, cost: { usd: 0.75, source: 'catalog' } } }),
    ]);
    expect(formatCostLabel(summary)).toBe('Est. $1.25');
  });

  it('appends "+" when some messages have usage but no cost', () => {
    const summary = aggregateUsage([
      assistant('a1', { usage: { prompt_tokens: 1, cost: { usd: 0.02, source: 'catalog' } } }),
      assistant('a2', { usage: { prompt_tokens: 1 } }),
    ]);
    expect(summary.costIncomplete).toBe(true);
    expect(formatCostLabel(summary)).toBe('Est. $0.020+');
  });

  it('ignores malformed cost values', () => {
    const summary = aggregateUsage([
      assistant('a1', {
        usage: { prompt_tokens: 1, cost: { usd: Number.NaN, source: 'provider' } },
      }),
    ]);
    expect(summary.costUsd).toBeNull();
  });
});

describe('computeContextMeter', () => {
  it('computes a rounded, clamped percentage', () => {
    expect(computeContextMeter(38200, 200000)).toEqual({
      used: 38200,
      window: 200000,
      percent: 19,
    });
    expect(computeContextMeter(250000, 200000)?.percent).toBe(100);
  });

  it('returns null without a context window or usage', () => {
    expect(computeContextMeter(1000, null)).toBeNull();
    expect(computeContextMeter(1000, 0)).toBeNull();
    expect(computeContextMeter(null, 200000)).toBeNull();
    expect(computeContextMeter(0, 200000)).toBeNull();
  });
});

describe('formatUsageSummaryLine', () => {
  it('joins context and cost', () => {
    const summary = aggregateUsage([
      assistant('a', {
        usage: {
          prompt_tokens: 30000,
          completion_tokens: 8200,
          cost: { usd: 0.042, source: 'provider' },
        },
      }),
    ]);
    const meter = computeContextMeter(summary.contextTokens, 200000);
    expect(formatUsageSummaryLine(summary, meter)).toBe('38k / 200k · $0.042');
  });

  it('falls back to a token total without a context window', () => {
    const summary = aggregateUsage([
      assistant('a', { usage: { prompt_tokens: 1200, completion_tokens: 300 } }),
    ]);
    expect(formatUsageSummaryLine(summary, null)).toBe('2k tokens');
  });
});

describe('formatting', () => {
  it('formats token counts', () => {
    expect(formatTokenCount(950)).toBe('950');
    expect(formatTokenCount(6800)).toBe('6.8k');
    expect(formatTokenCount(24000)).toBe('24.0k');
    expect(formatTokenCount(38200)).toBe('38.2k');
    expect(formatTokenCount(200000)).toBe('200k');
    expect(formatTokenCount(38200, { compact: true })).toBe('38k');
    expect(formatTokenCount(1_000_000)).toBe('1M');
    expect(formatTokenCount(1_250_000)).toBe('1.3M');
  });

  it('formats dollars', () => {
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(0.0004)).toBe('<$0.001');
    expect(formatUsd(0.042)).toBe('$0.042');
    expect(formatUsd(3.456)).toBe('$3.46');
  });

  it('formats the start time relative to today', () => {
    const now = new Date(2026, 10, 17, 15, 0);
    expect(formatStartedAt(new Date(2026, 10, 17, 10, 42).toISOString(), now)).toMatch(/^Today, /);
    expect(formatStartedAt(new Date(2026, 10, 16, 9, 5).toISOString(), now)).toMatch(
      /^Yesterday, /
    );
    expect(formatStartedAt(new Date(2025, 2, 3, 9, 5).toISOString(), now)).toMatch(/2025/);
    expect(formatStartedAt('not a date', now)).toBe('');
    expect(formatStartedAt(null, now)).toBe('');
  });

  it('formats relative times', () => {
    const now = new Date('2026-11-17T12:00:00Z');
    expect(formatRelativeTime('2026-11-17T11:59:30Z', now)).toBe('just now');
    expect(formatRelativeTime('2026-11-14T12:00:00Z', now)).toBe('3 days ago');
    expect(formatRelativeTime('2026-11-10T12:00:00Z', now)).toBe('last week');
    expect(formatRelativeTime('', now)).toBe('');
  });

  it('extracts hostnames', () => {
    expect(hostnameOf('https://www.example.com/a')).toBe('example.com');
    expect(hostnameOf('nope')).toBe('');
  });
});

describe('parseSearchResultText', () => {
  it('pairs numbered titles with their URL lines', () => {
    const text = [
      'Answer: Use debounce.',
      '',
      'Images:',
      '1. https://img.example.com/a.png',
      '',
      'Search Results:',
      '1. Debounce explained',
      '   Content: Wait for a pause.',
      '   URL: https://developer.mozilla.org/debounce',
      '   Relevance Score: 0.9',
      '2. Synchronizing with effects',
      '   Highlights:',
      '     1. nested highlight line',
      '   URL: https://react.dev/learn/effects',
    ].join('\n');
    expect(parseSearchResultText(text)).toEqual([
      { title: 'Debounce explained', url: 'https://developer.mozilla.org/debounce' },
      { title: 'Synchronizing with effects', url: 'https://react.dev/learn/effects' },
    ]);
  });

  it('drops a title that is just the URL', () => {
    expect(parseSearchResultText('1. https://a.com/x\n   URL: https://a.com/x')).toEqual([
      { title: null, url: 'https://a.com/x' },
    ]);
  });
});

describe('extractSources', () => {
  const search = (id: string, name: string, output: unknown, status = 'success') => ({
    call: { id, type: 'function', function: { name, arguments: '{"query":"q"}' } },
    out: { tool_call_id: id, output, status },
  });

  it('collects search results and fetched pages, deduped by URL', () => {
    const s1 = search(
      'c1',
      'web_search',
      '1. MDN debounce\n   URL: https://developer.mozilla.org/debounce\n2. React\n   URL: https://react.dev/'
    );
    const s2 = search(
      'c2',
      'web_search_exa',
      'Search Results:\n\n1. https://react.dev/\n   URL: https://react.dev/\n'
    );
    const fetchCall = {
      id: 'c3',
      type: 'function',
      function: { name: 'web_fetch', arguments: '{"url":"https://css-tricks.com/debounce"}' },
    };
    const fetchOut = {
      tool_call_id: 'c3',
      output: JSON.stringify({
        url: 'https://css-tricks.com/debounce',
        title: 'Debouncing and throttling',
        markdown: '# hi',
      }),
      status: 'success',
    };
    const messages: ChatMessage[] = [
      { id: 'u', role: 'user', content: 'search' },
      assistant('a1', {
        tool_calls: [s1.call, s2.call],
        tool_outputs: [s1.out, s2.out],
      }),
      assistant('a2', { tool_calls: [fetchCall], tool_outputs: [fetchOut] }),
    ];

    expect(extractSources(messages)).toEqual([
      {
        url: 'https://developer.mozilla.org/debounce',
        title: 'MDN debounce',
        hostname: 'developer.mozilla.org',
      },
      { url: 'https://react.dev/', title: 'React', hostname: 'react.dev' },
      {
        url: 'https://css-tricks.com/debounce',
        title: 'Debouncing and throttling',
        hostname: 'css-tricks.com',
      },
    ]);
  });

  it('uses the fetch argument URL when the result object has none, and skips errors', () => {
    const messages: ChatMessage[] = [
      assistant('a', {
        tool_calls: [
          {
            id: 'f1',
            function: { name: 'web_fetch', arguments: '{"url":"https://a.com/page"}' },
          },
          {
            id: 'f2',
            function: { name: 'web_fetch', arguments: '{"url":"https://b.com/broken"}' },
          },
          {
            id: 'f3',
            function: { name: 'web_fetch', arguments: '{"url":"https://c.com/failed"}' },
          },
          { id: 'f4', function: { name: 'get_time', arguments: '{}' } },
        ],
        tool_outputs: [
          { tool_call_id: 'f1', output: { title: 'Untitled', markdown: '' } },
          { tool_call_id: 'f2', output: 'Error: timeout' },
          { tool_call_id: 'f3', output: { url: 'https://c.com/failed' }, status: 'error' },
          { tool_call_id: 'f4', output: 'https://not-a-source.com' },
        ],
      }),
    ];
    expect(extractSources(messages)).toEqual([
      { url: 'https://a.com/page', title: null, hostname: 'a.com' },
    ]);
  });

  it('ignores non-http URLs', () => {
    const s = search('c', 'web_search', '1. Bad\n   URL: javascript:alert(1)');
    expect(
      extractSources([assistant('a', { tool_calls: [s.call], tool_outputs: [s.out] })])
    ).toEqual([]);
  });
});

describe('extractFiles', () => {
  it('collects images and file blocks with their message ids', () => {
    const messages: ChatMessage[] = [
      {
        id: 'u1',
        role: 'user',
        content: [
          { type: 'text', text: 'File: useSearch.ts\n```ts\nexport {}\n```\nLook at this' },
          { type: 'image_url', image_url: { url: '/api/v1/images/abc' } },
        ],
      },
      assistant('a1', {
        content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } }],
      }),
      { id: 't', role: 'tool', content: 'File: ignored.ts\n```ts\nx\n```' },
    ];
    expect(extractFiles(messages)).toEqual([
      {
        kind: 'file',
        key: 'u1:file:0',
        messageId: 'u1',
        name: 'useSearch.ts',
        language: 'ts',
        content: 'export {}\n',
      },
      { kind: 'image', key: 'u1:image:0', messageId: 'u1', url: '/api/v1/images/abc' },
      { kind: 'image', key: 'a1:image:0', messageId: 'a1', url: 'data:image/png;base64,AAA' },
    ]);
  });

  it('returns nothing for plain text conversations', () => {
    expect(extractFiles([{ id: 'u', role: 'user', content: 'hello' }])).toEqual([]);
  });
});

describe('buildChatInfo', () => {
  it('describes the current settings', () => {
    const info = buildChatInfo({
      model: 'anthropic::claude-sonnet',
      providerId: null,
      modelGroups: [{ id: 'anthropic', label: 'Anthropic', options: [] }],
      reasoningEffort: 'xhigh',
      useTools: true,
      enabledTools: ['web_search', 'web_fetch'],
      customRequestParams: [{ id: 'p1', label: 'Low temp', params: {} }],
      customRequestParamsId: ['p1'],
      shouldStream: false,
      startedAt: '2026-11-17T10:42:00Z',
    });
    expect(info).toEqual({
      modelId: 'claude-sonnet',
      providerId: 'anthropic',
      providerName: 'Anthropic',
      reasoningLabel: 'X-High',
      tools: ['web_search', 'web_fetch'],
      paramsLabel: 'Low temp',
      streaming: false,
      startedAt: '2026-11-17T10:42:00Z',
    });
    expect(formatChatInfoSummary(info)).toBe('claude-sonnet · 2 tools');
  });

  it('lists no tools when tools are off and defaults params', () => {
    const info = buildChatInfo({
      model: 'gpt',
      providerId: 'openai',
      modelGroups: [],
      reasoningEffort: undefined,
      useTools: false,
      enabledTools: ['web_search'],
      customRequestParams: [],
      customRequestParamsId: null,
      shouldStream: true,
      startedAt: null,
    });
    expect(info.tools).toEqual([]);
    expect(info.paramsLabel).toBe('Default');
    expect(info.providerName).toBeNull();
    expect(formatChatInfoSummary(info)).toBe('gpt');
    expect(reasoningEffortLabel('unset')).toBe('Default');
  });
});
