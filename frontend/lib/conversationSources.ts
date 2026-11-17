/**
 * Web sources fetched or returned by the web tools in a conversation.
 *
 * Data comes from assistant messages:
 *  - `tool_calls[].function.name` / `.arguments` identify the tool and its input
 *  - `tool_outputs[]` (matched by `tool_call_id`) hold the results
 *
 * Search tools (web_search, web_search_exa, web_search_firecrawl, web_search_searxng)
 * return plain text where each result is a numbered title line followed by an
 * indented `URL: <url>` line. web_fetch returns `{ url, title, markdown, ... }`
 * (as an object or JSON text); its `url` argument is the fallback.
 */
import type { ChatMessage } from './types';
import { hostnameOf } from './detailsFormat';

export interface ConversationSource {
  url: string;
  title: string | null;
  hostname: string;
}

type ToolOutput = NonNullable<ChatMessage['tool_outputs']>[number];

const SEARCH_TOOL = /^web_search(?:_[a-z0-9]+)?$/;
const FETCH_TOOL = 'web_fetch';

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed.startsWith('{')) return null;
    try {
      const parsed = JSON.parse(trimmed);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Parse the text a search tool returns into `{ title, url }` pairs.
 * Title lines start at column 0 (`1. Title`); nested numbered lines (highlights)
 * are indented and ignored.
 */
export function parseSearchResultText(text: string): Array<{ title: string | null; url: string }> {
  const results: Array<{ title: string | null; url: string }> = [];
  let title: string | null = null;

  for (const line of text.split(/\r?\n/)) {
    const titleMatch = line.match(/^\d+\.\s+(.+)$/);
    if (titleMatch) {
      title = titleMatch[1].trim();
      continue;
    }
    // Section headers ("Search Results:", "Images:") reset the current title.
    if (/^\S.*:\s*$/.test(line)) {
      title = null;
      continue;
    }
    const urlMatch = line.match(/^\s+URL:\s*(\S+)/);
    if (urlMatch && isHttpUrl(urlMatch[1])) {
      const resolvedTitle = title && title !== urlMatch[1] ? title : null;
      results.push({ title: resolvedTitle, url: urlMatch[1] });
      title = null;
    }
  }
  return results;
}

function outputText(output: unknown): string {
  if (typeof output === 'string') return output;
  if (output && typeof output === 'object') {
    const record = output as Record<string, unknown>;
    if (typeof record.text === 'string') return record.text;
    if (typeof record.content === 'string') return record.content;
  }
  return '';
}

function toolName(call: any): string {
  return typeof call?.function?.name === 'string' ? call.function.name : '';
}

function outputsFor(call: any, outputs: ToolOutput[]): ToolOutput[] {
  const id = call?.id;
  return outputs.filter((out) => {
    if (out.tool_call_id && id) return out.tool_call_id === id;
    return Boolean(out.name) && out.name === toolName(call);
  });
}

/**
 * Search tools sometimes return scraped markdown as a "title" (for example a
 * Wikipedia citation line). Reduce it to readable text: links become their
 * text, emphasis markers and citation arrows go, whitespace collapses.
 * Returns null when nothing readable is left.
 */
export function cleanSourceTitle(raw: string | null): string | null {
  if (!raw) return null;
  const text = raw
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[↑^]/g, '')
    .replace(/(^|\s)[_*]+|[_*]+(?=\s|[.,;:]|$)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .trim();
  // A leftover unpaired quote (from a stripped link) reads as noise; drop them all.
  const cleaned = (text.match(/["“”]/g)?.length ?? 0) % 2 === 1 ? text.replace(/["“”]/g, '') : text;
  if (!cleaned || /^https?:\/\/\S+$/.test(cleaned)) return null;
  return cleaned;
}

/** All web sources in the given messages, deduplicated by URL, in first-seen order. */
export function extractSources(messages: ChatMessage[]): ConversationSource[] {
  const byUrl = new Map<string, ConversationSource>();

  const add = (url: string, rawTitle: string | null) => {
    const title = cleanSourceTitle(rawTitle);
    const existing = byUrl.get(url);
    if (existing) {
      if (!existing.title && title) existing.title = title;
      return;
    }
    byUrl.set(url, { url, title, hostname: hostnameOf(url) });
  };

  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    const outputs = Array.isArray(message.tool_outputs) ? message.tool_outputs : [];

    for (const call of calls) {
      const name = toolName(call);
      const isSearch = SEARCH_TOOL.test(name);
      const isFetch = name === FETCH_TOOL;
      if (!isSearch && !isFetch) continue;

      const matched = outputsFor(call, outputs).filter((out) => out.status !== 'error');

      if (isSearch) {
        for (const out of matched) {
          for (const result of parseSearchResultText(outputText(out.output))) {
            add(result.url, result.title);
          }
        }
        continue;
      }

      // web_fetch: count a page only once a structured result came back
      // (error text is not a fetched page).
      const args = parseJsonObject(call?.function?.arguments);
      for (const out of matched) {
        const result = parseJsonObject(out.output);
        if (!result) continue;
        const url = isHttpUrl(result.url) ? result.url : isHttpUrl(args?.url) ? args.url : null;
        if (!url) continue;
        const rawTitle = typeof result.title === 'string' ? result.title.trim() : '';
        add(url, rawTitle && rawTitle !== 'Untitled' ? rawTitle : null);
      }
    }
  }

  return Array.from(byUrl.values());
}
