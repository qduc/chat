#!/usr/bin/env node
/**
 * Design-system lint: fails when component code bypasses the tokens.
 *
 *   node scripts/check-design-tokens.mjs            # check everything
 *   node scripts/check-design-tokens.mjs <paths...> # check specific files/dirs
 *
 * Rules (see docs/ui-migration-plan.md):
 *  - no raw colors (hex, rgb(), hsl()) outside app/tokens.css
 *  - no Tailwind palette colors (zinc-500, blue-600, white, black, ...): use semantic tokens
 *  - no `dark:` variants: tokens switch themes
 *  - spacing (padding/margin/gap/space/inset) on the 4px scale: 0, px, 1, 2, 3, 4, 6, 8
 *  - font weights 400/500 only; type scale xs/sm/base/lg/xl
 *  - radii: rounded-control, rounded-card, rounded-full, rounded-none
 *  - no shadows except shadow-popover; no blur; no gradients
 *  - no arbitrary values (`w-[500px]`, `z-[9999]`); CSS-variable shorthand `w-(--x)` is fine
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_TARGETS = ['app', 'components', 'contexts'];
const TOKEN_FILE = path.join(root, 'app/tokens.css');

const PALETTE =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black';
const COLOR_UTIL =
  'bg|text|border(?:-[trblxy])?|ring|ring-offset|outline|fill|stroke|from|via|to|divide|placeholder|decoration|shadow|accent|caret';
const SPACING_UTIL =
  '-?(?:p|px|py|pt|pr|pb|pl|ps|pe|m|mx|my|mt|mr|mb|ml|ms|me|gap|gap-x|gap-y|space-x|space-y|inset|inset-x|inset-y|top|right|bottom|left)';
const ALLOWED_SPACING = new Set(['0', 'px', '1', '2', '3', '4', '6', '8', 'auto', 'full']);

const rules = [
  {
    id: 'raw-color',
    test: (cls, line) => /#[0-9a-fA-F]{3,8}\b(?![\w-])|\b(?:rgb|rgba|hsl|hsla|oklch)\(/.test(line),
    message: 'raw color value; use a token from app/tokens.css',
    scope: 'line',
  },
  {
    id: 'palette-color',
    re: new RegExp(`^(?:${COLOR_UTIL})-(?:${PALETTE})(?:-\\d{2,3})?(?:\\/\\d+)?$`),
    message:
      'Tailwind palette color; use a semantic token (bg-surface, text-fg-muted, border-line, ...)',
  },
  { id: 'dark-variant', re: /^dark:/, message: '`dark:` variant; tokens already switch per theme' },
  {
    id: 'font-weight',
    re: /^font-(?:thin|extralight|light|semibold|bold|extrabold|black)$/,
    message: 'only font-normal (400) and font-medium (500) are allowed',
  },
  {
    id: 'type-scale',
    re: /^text-(?:2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)$/,
    message: 'outside the type scale (xs, sm, base, lg, xl)',
  },
  {
    id: 'radius',
    re: /^rounded(?:-(?:[trbl]|tl|tr|bl|br|s|e|ss|se|es|ee))?(?:-(?:xs|sm|md|lg|xl|2xl|3xl))?$/,
    message: 'use rounded-control, rounded-card, or rounded-full',
  },
  {
    id: 'shadow',
    re: /^(?:shadow|shadow-(?:2xs|xs|sm|md|lg|xl|2xl|inner)|drop-shadow(?:-\w+)?)$/,
    message: 'surfaces are flat; floating layers use shadow-popover',
  },
  { id: 'blur', re: /^(?:backdrop-)?blur(?:-\w+)?$/, message: 'no blur or glass effects' },
  { id: 'gradient', re: /^bg-(?:linear|gradient|radial|conic)(?:-|$)/, message: 'no gradients' },
  {
    id: 'spacing',
    test: (cls) => {
      const m = cls.match(new RegExp(`^${SPACING_UTIL}-([\\w.]+)$`));
      return m ? !ALLOWED_SPACING.has(m[1]) : false;
    },
    message: 'off the 4px spacing scale (use 1, 2, 3, 4, 6, 8)',
  },
  {
    id: 'arbitrary-value',
    // transition-[...] property lists are allowed: they are not color or spacing.
    re: /^(?!transition-\[)(?:[\w-]+:)*-?[a-z][\w-]*-\[[^\]]+\]$/,
    message: 'arbitrary value; add a token or use the scale',
  },
];

// Narrow, documented exceptions: [file suffix, rule id, reason]
const EXCEPTIONS = [
  [
    'components/ui/Toggle.tsx',
    'spacing',
    '2px thumb inset and 10px touch hit-area extension on the switch',
  ],
];

function walk(target) {
  const abs = path.resolve(root, target);
  if (!statSync(abs, { throwIfNoEntry: false })) return [];
  if (statSync(abs).isFile()) return [abs];
  return readdirSync(abs).flatMap((name) =>
    name === 'node_modules' || name.startsWith('.') ? [] : walk(path.join(abs, name))
  );
}

function classTokens(line) {
  // Pull class-like tokens from string literals on the line.
  const out = [];
  for (const m of line.matchAll(/(["'`])((?:(?!\1).)*)\1/g)) {
    for (const tok of m[2].split(/\s+/)) {
      if (!tok || tok.includes('${')) continue;
      // strip variant prefixes like hover:, md:, data-checked:, [&_svg]:
      const base = tok
        .replace(/^(?:!?(?:\[[^\]]*\]|[\w-]+(?:\[[^\]]*\])?):)+/, '')
        .replace(/^!/, '');
      out.push({ raw: tok, base });
    }
  }
  return out;
}

const targets = process.argv.slice(2);
const files = (targets.length ? targets : DEFAULT_TARGETS)
  .flatMap(walk)
  .filter((f) => /\.(tsx|ts|css)$/.test(f) && f !== TOKEN_FILE && !f.includes('__tests__'));

let total = 0;
const byRule = {};
for (const file of files) {
  const rel = path.relative(root, file);
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; // comments
    const findings = new Set();
    for (const rule of rules) {
      if (EXCEPTIONS.some(([f, id]) => rel.endsWith(f) && id === rule.id)) continue;
      if (rule.scope === 'line') {
        if (rule.test(null, line)) findings.add(`${rule.id}: ${rule.message}`);
        continue;
      }
      if (file.endsWith('.css')) continue;
      for (const { raw, base } of classTokens(line)) {
        const hit = rule.re
          ? rule.re.test(rule.id === 'dark-variant' ? raw : base)
          : rule.test(base);
        if (hit) findings.add(`${rule.id}: \`${raw}\` ${rule.message}`);
      }
    }
    for (const f of findings) {
      total++;
      const id = f.split(':')[0];
      byRule[id] = (byRule[id] || 0) + 1;
      console.log(`${rel}:${i + 1}  ${f}`);
    }
  });
}

if (total) {
  console.log(`\n${total} design-token violation(s) in ${files.length} files:`);
  for (const [id, n] of Object.entries(byRule).sort((a, b) => b[1] - a[1]))
    console.log(`  ${id}: ${n}`);
  process.exit(1);
}
console.log(`Design tokens: ${files.length} files clean.`);
