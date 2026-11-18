#!/usr/bin/env node
/**
 * Verifies WCAG 2.2 AA contrast for the semantic tokens in app/tokens.css,
 * in both light and dark themes. Exits non-zero on any failure.
 *
 *   node scripts/check-contrast.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.join(here, '../app/tokens.css'), 'utf8');

function parseBlock(selectorRegex) {
  const match = css.match(selectorRegex);
  if (!match) throw new Error(`Block not found: ${selectorRegex}`);
  const vars = {};
  for (const m of match[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  return vars;
}

const light = parseBlock(/:root\s*\{([\s\S]*?)\n\}/);
const dark = { ...light, ...parseBlock(/:root\.dark\s*\{([\s\S]*?)\n\}/) };

function resolve(vars, name, depth = 0) {
  const value = vars[name];
  if (value === undefined) throw new Error(`Unknown token ${name}`);
  const ref = value.match(/^var\((--[\w-]+)\)$/);
  if (ref) return resolve(vars, ref[1], depth + 1);
  if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`${name} is not a 6-digit hex: ${value}`);
  return value;
}

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const BACKGROUNDS = ['--canvas', '--canvas-subtle', '--surface', '--muted', '--emphasis'];
const rules = [
  // [foreground, backgrounds, minimum, description]
  ['--fg', BACKGROUNDS, 4.5, 'body text'],
  ['--fg-muted', BACKGROUNDS, 4.5, 'secondary text'],
  ['--fg-subtle', BACKGROUNDS, 4.5, 'tertiary text / placeholders'],
  ['--accent', BACKGROUNDS, 4.5, 'links and accent text'],
  ['--danger', BACKGROUNDS, 4.5, 'error text'],
  ['--success', BACKGROUNDS, 4.5, 'success text'],
  ['--warning', BACKGROUNDS, 4.5, 'warning text'],
  ['--line-strong', BACKGROUNDS, 3, 'control boundaries'],
  // Soft field border: deliberately below 3:1, but must stay visible at rest.
  ['--line-control', ['--canvas', '--canvas-subtle', '--surface'], 1.4, 'resting field border'],
  ['--focus', BACKGROUNDS, 3, 'focus indicator'],
  ['--on-primary', ['--primary', '--primary-hover'], 4.5, 'primary button label'],
  ['--on-accent', ['--accent', '--accent-hover'], 4.5, 'text on accent fill'],
  ['--on-danger', ['--danger', '--danger-hover'], 4.5, 'danger button label'],
  ['--primary', ['--canvas', '--surface', '--canvas-subtle'], 3, 'primary button boundary'],
  ['--fg', ['--accent-subtle'], 4.5, 'text on selection'],
  ['--accent', ['--accent-subtle'], 4.5, 'accent text on selection'],
  ['--danger', ['--danger-subtle'], 4.5, 'error callout'],
  ['--success', ['--success-subtle'], 4.5, 'success callout'],
  ['--warning', ['--warning-subtle'], 4.5, 'warning callout'],
  [
    '--fg',
    ['--danger-subtle', '--success-subtle', '--warning-subtle'],
    4.5,
    'body text in callouts',
  ],
  ...[
    '--syntax-fg',
    '--syntax-comment',
    '--syntax-keyword',
    '--syntax-string',
    '--syntax-number',
    '--syntax-title',
    '--syntax-type',
    '--syntax-tag',
    '--syntax-attr',
  ].map((t) => [t, ['--muted', '--surface', '--canvas'], 4.5, 'code syntax']),
];

let failures = 0;
for (const [themeName, vars] of [
  ['light', light],
  ['dark', dark],
]) {
  let worst = Infinity;
  for (const [fg, bgs, min, desc] of rules) {
    for (const bg of bgs) {
      const r = ratio(resolve(vars, fg), resolve(vars, bg));
      worst = Math.min(worst, r / min);
      if (r < min) {
        failures++;
        console.error(`FAIL [${themeName}] ${fg} on ${bg}: ${r.toFixed(2)} < ${min} (${desc})`);
      }
    }
  }
  const checks = rules.reduce((n, [, bgs]) => n + bgs.length, 0);
  console.log(
    `${themeName}: ${checks} pairs checked, tightest margin ${worst.toFixed(2)}x of required`
  );
}

if (failures) {
  console.error(`\n${failures} contrast failure(s).`);
  process.exit(1);
}
console.log('All token pairs meet WCAG 2.2 AA.');
