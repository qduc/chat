#!/usr/bin/env node
import path from 'path';
import { fileURLToPath } from 'url';

// Ensure we run with backend package context
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Prefer the project's installed fetch if available
try {
  const nf = await import('node:fetch');
  if (nf && globalThis.fetch === undefined) globalThis.fetch = nf.fetch;
} catch {
  try {
    const nf = await import('node-fetch');
    if (nf && globalThis.fetch === undefined) globalThis.fetch = nf.default;
  } catch {
    // Ignore; Node 18+ should provide global fetch
  }
}

// Import the tool
const toolPath = path.join(__dirname, '..', 'src', 'lib', 'tools', 'webFetch.js');
let webFetchTool;
try {
  webFetchTool = (await import(toolPath)).webFetchTool;
} catch (err) {
  console.error('Failed to import webFetch tool from', toolPath);
  console.error(err);
  process.exit(2);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v === undefined) {
        // flag or next arg is value
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) {
          args[k] = next;
          i++;
        } else {
          args[k] = true;
        }
      } else {
        args[k] = v;
      }
    } else if (a.startsWith('-')) {
      const k = a.slice(1);
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) {
        args[k] = next; i++;
      } else {
        args[k] = true;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

async function main() {
  const argv = process.argv.slice(2);
  const p = parseArgs(argv);

  if (p._.length === 0 || p.h || p.help) {
    console.log('Usage: node backend/scripts/runWebFetchTool.mjs <url> [--max-chars=10000] [--heading="Heading"] [--start=n --end=m]');
    process.exit(0);
  }

  const url = p._[0];
  const params = {};
  if (p['max-chars'] || p.max_chars) params.max_chars = Number(p['max-chars'] || p.max_chars);
  if (p.heading) params.heading = p.heading;
  if ((p.start && p.end) || (p['heading-range'])) {
    if (p['heading-range']) {
      try { params.heading_range = JSON.parse(p['heading-range']); } catch { /* ignore */ }
    } else {
      params.heading_range = { start: Number(p.start), end: Number(p.end) };
    }
  }

  // If continuation token provided, don't include url
  if (p.continuation_token) params.continuation_token = p.continuation_token;
  else params.url = url;

  // Validate using tool's validate function if available
  try {
    const validated = webFetchTool.validate ? webFetchTool.validate(params) : params;
    // Call handler
    const result = await webFetchTool.handler(validated);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('Error:', err && err.message ? err.message : String(err));
    console.error(err);
    process.exit(1);
  }
}

main();
