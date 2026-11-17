import React from 'react';
import { DetailsSection } from './DetailsSection';
import { formatTokenCount, formatUsd } from '../../lib/detailsFormat';
import {
  formatCostLabel,
  formatUsageSummaryLine,
  type ContextMeter,
  type UsageSummary,
} from '../../lib/usageSummary';

interface UsageSectionProps {
  summary: UsageSummary;
  meter: ContextMeter | null;
  open: boolean;
  onToggle: () => void;
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-fg-subtle">{label}</span>
      <span className="text-sm text-fg">{formatTokenCount(value)}</span>
    </div>
  );
}

/** Token totals, context use and cost for the branch being viewed. */
export function UsageSection({ summary, meter, open, onToggle }: UsageSectionProps) {
  const cost = formatCostLabel(summary);
  return (
    <DetailsSection
      title="Usage"
      open={open}
      onToggle={onToggle}
      summary={formatUsageSummaryLine(summary, meter)}
    >
      <div className="flex flex-col gap-3 px-1 pt-1 pb-2 text-xs">
        {meter ? (
          <div className="flex flex-col gap-1">
            <div className="flex justify-between gap-2">
              <span className="text-fg-subtle">Context</span>
              <span className="text-fg">
                {formatTokenCount(meter.used)} / {formatTokenCount(meter.window)}
              </span>
            </div>
            <div
              role="meter"
              aria-label="Context used"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={meter.percent}
              aria-valuetext={`${meter.percent}% of the context window`}
              className="h-1 overflow-hidden rounded-full bg-emphasis"
            >
              <div className="h-full bg-fg-muted" style={{ width: `${meter.percent}%` }} />
            </div>
          </div>
        ) : null}
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Input" value={summary.input} />
          <Stat label="Cached" value={summary.cached} />
          <Stat label="Output" value={summary.output} />
          {summary.reasoning > 0 ? <Stat label="Reasoning" value={summary.reasoning} /> : null}
        </div>
        {cost ? (
          <div className="flex justify-between gap-2">
            <span className="text-fg-subtle">Estimated cost</span>
            <span className="text-right text-fg">
              {cost}
              {summary.cacheSavingsUsd > 0 ? (
                <span className="text-success">
                  {' '}
                  · saved {formatUsd(summary.cacheSavingsUsd)} by caching
                </span>
              ) : null}
            </span>
          </div>
        ) : null}
      </div>
    </DetailsSection>
  );
}
