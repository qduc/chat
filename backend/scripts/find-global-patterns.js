#!/usr/bin/env node

/**
 * Find all locations where global provider patterns exist
 * Helps identify code that needs cleanup in Phase 3
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const searchPatterns = [
  'user_id IS NULL',
  'user_id=NULL',
  "user_id = @userId OR user_id IS NULL",
  'userId = null',
  'userId || null',
  'req.user?.id || null',
];

const searchDirs = [
  'src/db',
  'src/routes',
  'src/lib',
  'src/middleware',
];

console.log('🔍 Searching for global provider patterns...\n');
console.log('=' .repeat(70));

let totalMatches = 0;

for (const pattern of searchPatterns) {
  console.log(`\n📌 Pattern: "${pattern}"`);
  console.log('-'.repeat(70));

  for (const dir of searchDirs) {
    const fullPath = path.join(process.cwd(), dir);

    if (!fs.existsSync(fullPath)) {
      continue;
    }

    try {
      const results = execSync(
        `grep -rn "${pattern}" ${fullPath} --include="*.js" || true`,
        { encoding: 'utf-8' }
      ).trim();

      if (results) {
        const lines = results.split('\n').filter(l => l.trim());
        totalMatches += lines.length;

        lines.forEach(line => {
          // Parse the grep output: filename:linenum:content
          const match = line.match(/^([^:]+):(\d+):(.+)$/);
          if (match) {
            const [, file, lineNum, content] = match;
            const relPath = path.relative(process.cwd(), file);
            console.log(`  ${relPath}:${lineNum}`);
            console.log(`    ${content.trim()}`);
          }
        });
      }
    } catch {
      // grep returns exit code 1 when no matches found, which is fine
    }
  }
}

console.log('\n' + '='.repeat(70));
console.log(`\n📊 Total matches found: ${totalMatches}\n`);

if (totalMatches > 0) {
  console.log('💡 These locations need to be updated in Phase 3');
  console.log('   to remove global provider logic.\n');
} else {
  console.log('✅ No global provider patterns found!\n');
}
