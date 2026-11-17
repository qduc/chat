import { processNonStreamingData, processStreamChunk } from '../lib/api/streaming-handler';
import { cleanSourceTitle, extractSources } from '../lib/conversationSources';
import type { ChatMessage } from '../lib/types';
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SourcesSection } from '../components/details/SourcesSection';

describe('usage cost from the stream', () => {
  const cost = { usd: 0.000167, source: 'catalog' as const };

  it('keeps cost on a streamed usage frame', () => {
    const events: any[] = [];
    processStreamChunk(
      { usage: { prompt_tokens: 546, completion_tokens: 20, cost }, model: 'gemini' },
      undefined,
      (event) => events.push(event)
    );
    const usage = events.find((event) => event.type === 'usage');
    expect(usage.value.cost).toEqual(cost);
  });

  it('keeps cost on a non-streaming response', () => {
    const result = processNonStreamingData({
      choices: [{ message: { role: 'assistant', content: 'hi' } }],
      usage: { prompt_tokens: 10, completion_tokens: 2, cost },
    });
    expect(result.usage?.cost).toEqual(cost);
  });

  it('ignores a malformed cost', () => {
    const events: any[] = [];
    processStreamChunk(
      { usage: { prompt_tokens: 1, completion_tokens: 1, cost: { usd: 'free' } } },
      undefined,
      (event) => events.push(event)
    );
    expect(events.find((event) => event.type === 'usage').value.cost).toBeUndefined();
  });
});

describe('cleanSourceTitle', () => {
  it('reduces a scraped citation line to readable text', () => {
    const raw =
      '[↑](https://en.wikipedia.org/wiki/Example.com#cite_ref-12)["Example Domain"](https://example.com/). _example.com_. 2026-10-02.';
    expect(cleanSourceTitle(raw)).toBe('Example Domain. example.com. 2026-10-02.');
  });

  it('keeps ordinary titles unchanged', () => {
    expect(cleanSourceTitle('IANA-managed Reserved Domains')).toBe('IANA-managed Reserved Domains');
    expect(cleanSourceTitle('snake_case naming')).toBe('snake_case naming');
  });

  it('returns null for empty or URL-only titles', () => {
    expect(cleanSourceTitle('  ')).toBeNull();
    expect(cleanSourceTitle('[https://a.example](https://a.example)')).toBeNull();
    expect(cleanSourceTitle(null)).toBeNull();
  });

  it('is applied when extracting sources', () => {
    const messages = [
      {
        id: 'a1',
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 't1', type: 'function', function: { name: 'web_fetch', arguments: '{}' } },
        ],
        tool_outputs: [
          {
            tool_call_id: 't1',
            name: 'web_fetch',
            output: { url: 'https://example.com', title: '**Example** [Domain](https://x.y)' },
          },
        ],
      },
    ] as unknown as ChatMessage[];
    expect(extractSources(messages)[0].title).toBe('Example Domain');
  });
});

describe('SourcesSection', () => {
  const sources = Array.from({ length: 8 }, (_, i) => ({
    url: `https://site${i}.example/page`,
    title: `Page ${i}`,
    hostname: `site${i}.example`,
  }));

  it('shows the first five and expands to all', async () => {
    render(<SourcesSection sources={sources} open onToggle={() => {}} />);
    expect(screen.getAllByRole('link')).toHaveLength(5);
    const more = screen.getByRole('button', { name: 'Show all 8' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(more);
    expect(screen.getAllByRole('link')).toHaveLength(8);
    expect(screen.getByRole('button', { name: 'Show fewer' })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
  });

  it('has no toggle when everything fits', () => {
    render(<SourcesSection sources={sources.slice(0, 5)} open onToggle={() => {}} />);
    expect(screen.queryByRole('button', { name: /Show all/ })).not.toBeInTheDocument();
  });
});
