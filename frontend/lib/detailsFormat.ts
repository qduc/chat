/**
 * Formatting helpers for the chat details panel. Pure functions, no React.
 */

/**
 * Token counts: `950`, `6.8k`, `38.2k`, `200k`, `1.2M`.
 * `compact` drops the decimal for thousands (`38k`), for one-line summaries.
 */
export function formatTokenCount(value: number, { compact = false } = {}): string {
  if (!Number.isFinite(value)) return '0';
  const n = Math.max(0, Math.round(value));
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1000;
    if (compact || k >= 100) return `${Math.round(k)}k`;
    return `${k.toFixed(1)}k`;
  }
  const m = n / 1_000_000;
  const fixed = m >= 100 ? String(Math.round(m)) : m.toFixed(1).replace(/\.0$/, '');
  return `${fixed}M`;
}

/** US dollars: `$1.25`, `$0.042`, `<$0.001`, `$0.00`. */
export function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '$0.00';
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.001) return `$${value.toFixed(3)}`;
  return '<$0.001';
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** "Today, 10:42", "Yesterday, 09:05", "Mar 3, 10:42", "Mar 3, 2025, 10:42". */
export function formatStartedAt(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const time = date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
  if (sameDay(date, now)) return `Today, ${time}`;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, yesterday)) return `Yesterday, ${time}`;

  const day = date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
  return `${day}, ${time}`;
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

/** "just now", "5 minutes ago", "yesterday", "last week", "3 months ago". */
export function formatRelativeTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return 'just now';

  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [unit, size] of RELATIVE_UNITS) {
    if (abs >= size) {
      return rtf.format(Math.trunc(seconds / size), unit);
    }
  }
  return 'just now';
}

/** Hostname without a leading `www.`; empty string for unparseable URLs. */
export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
