#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function gitVersion() {
  try {
    return execSync('git describe --tags --exact-match', { stdio: 'pipe' }).toString().trim();
  } catch (e) {
    try {
      return execSync('git describe --tags --abbrev=0', { stdio: 'pipe' }).toString().trim();
    } catch (e2) {
      return execSync('git rev-parse --short HEAD', { stdio: 'pipe' }).toString().trim();
    }
  }
}

// Accept optional version override (useful in CI where tag is provided via env/arg)
const arg = process.argv[2];
const raw = arg && arg.length ? arg.trim() : gitVersion();
const version = raw.replace(/^v/, '');

const targets = [
  path.resolve(__dirname, '..', 'package.json'),
  path.resolve(__dirname, '..', 'electron', 'package.json'),
];

targets.forEach((p) => {
  if (!fs.existsSync(p)) return;
  const content = fs.readFileSync(p, 'utf8');
  let pkg;
  try {
    pkg = JSON.parse(content);
  } catch (err) {
    console.error(`failed to parse ${p}:`, err.message);
    process.exit(2);
  }
  if (pkg.version === version) {
    console.log(`no change: ${path.relative(process.cwd(), p)} already at ${version}`);
    return;
  }
  pkg.version = version;
  fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  console.log(`updated ${path.relative(process.cwd(), p)} -> ${version}`);
});

console.log('version sync complete:', version);
