/**
 * Token usage and cost aggregation for one conversation branch.
 * Pure functions: callers pass the messages of the branch being viewed.
 */
import type { ChatMessage, MessageUsage } from './types';
import { formatTokenCount, formatUsd } from './detailsFormat';

export interface UsageSummary {
  /** True when at least one assistant message reported usage. */
  hasUsage: boolean;
  input: number;
  cached: number;
  output: number;
  reasoning: number;
  /** prompt + completion tokens of the latest assistant message with usage. */
  contextTokens: number | null;
  /** Sum of `usage.cost.usd`, or null when no message reported a cost. */
  costUsd: number | null;
  /** Some cost came from catalog prices rather than the provider. */
  costEstimated: boolean;
  /** Some assistant messages have usage but no cost, so the total is a lower bound. */
  costIncomplete: boolean;
  cacheSavingsUsd: number;
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function hasTokenFields(usage: MessageUsage | undefined): usage is MessageUsage {
  if (!usage || typeof usage !== 'object') return false;
  return [
    usage.prompt_tokens,
    usage.completion_tokens,
    usage.total_tokens,
    usage.cache_read_input_tokens,
    usage.reasoning_tokens,
  ].some((v) => typeof v === 'number' && Number.isFinite(v));
}

export function aggregateUsage(messages: ChatMessage[]): UsageSummary {
  const summary: UsageSummary = {
    hasUsage: false,
    input: 0,
    cached: 0,
    output: 0,
    reasoning: 0,
    contextTokens: null,
    costUsd: null,
    costEstimated: false,
    costIncomplete: false,
    cacheSavingsUsd: 0,
  };
  let missingCost = 0;

  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    const usage = message.usage;
    if (!hasTokenFields(usage)) continue;

    summary.hasUsage = true;
    summary.input += num(usage.prompt_tokens);
    summary.cached += num(usage.cache_read_input_tokens);
    summary.output += num(usage.completion_tokens);
    summary.reasoning += num(usage.reasoning_tokens ?? message.reasoning_tokens);

    const context = num(usage.prompt_tokens) + num(usage.completion_tokens);
    if (context > 0) summary.contextTokens = context;

    const cost = usage.cost;
    if (cost && typeof cost.usd === 'number' && Number.isFinite(cost.usd)) {
      summary.costUsd = (summary.costUsd ?? 0) + cost.usd;
      if (cost.source === 'catalog') summary.costEstimated = true;
      summary.cacheSavingsUsd += num(cost.cache_savings_usd);
    } else {
      missingCost++;
    }
  }

  summary.costIncomplete = summary.costUsd !== null && missingCost > 0;
  return summary;
}

/** "$0.042", "Est. $0.042", "$0.042+", or null when there is no cost data. */
export function formatCostLabel(summary: UsageSummary): string | null {
  if (summary.costUsd === null) return null;
  const prefix = summary.costEstimated ? 'Est. ' : '';
  const suffix = summary.costIncomplete ? '+' : '';
  return `${prefix}${formatUsd(summary.costUsd)}${suffix}`;
}

export interface ContextMeter {
  used: number;
  window: number;
  /** 0–100, rounded. */
  percent: number;
}

export function computeContextMeter(
  used: number | null | undefined,
  contextWindow: number | null | undefined
): ContextMeter | null {
  if (typeof used !== 'number' || !Number.isFinite(used) || used <= 0) return null;
  if (typeof contextWindow !== 'number' || !Number.isFinite(contextWindow) || contextWindow <= 0)
    return null;
  const percent = Math.min(100, Math.max(0, Math.round((used / contextWindow) * 100)));
  return { used, window: contextWindow, percent };
}

/** One-line summary for the collapsed Usage header, e.g. "38k / 200k · $0.04". */
export function formatUsageSummaryLine(summary: UsageSummary, meter: ContextMeter | null): string {
  const parts: string[] = [];
  if (meter) {
    parts.push(
      `${formatTokenCount(meter.used, { compact: true })} / ${formatTokenCount(meter.window, {
        compact: true,
      })}`
    );
  } else if (summary.hasUsage) {
    parts.push(`${formatTokenCount(summary.input + summary.output, { compact: true })} tokens`);
  }
  const cost = formatCostLabel(summary);
  if (cost) parts.push(cost);
  return parts.join(' · ');
}
