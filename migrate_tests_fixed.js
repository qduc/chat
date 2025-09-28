#!/usr/bin/env node

/**
 * Fixed batch migration script to convert test files to use the snapshot database system.
 * Uses git checkpoints for safety and rollback capability.
 */

import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';

const TESTS_DIR = './backend/__tests__';
const BACKUP_BRANCH = 'snapshot-migration-backup';

// Colors for console output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function execCommand(cmd, description) {
  log(`Executing: ${cmd}`, colors.blue);
  try {
    const output = execSync(cmd, { encoding: 'utf8', cwd: process.cwd() });
    if (output.trim()) {
      log(output.trim());
    }
    return { success: true, output };
  } catch (error) {
    log(`❌ ${description} failed: ${error.message}`, colors.red);
    return { success: false, error: error.message };
  }
}

// File categorization based on verification results
const migrationPlan = {
  // Files that need full migration from scratch
  fullMigration: [
    'auth_users.test.js'
  ],

  // Files that are partially migrated but need cleanup
  partialMigration: [
    'auth_middleware.test.js',
    'conversations.test.js',
    'db.test.js',
    'iterative_orchestration.test.js',
    'providers.test.js'
  ],

  // Files already properly migrated (skip)
  alreadyMigrated: [
    'conversations_edit.test.js',
    'providers_user_scoping.test.js'
  ]
};

/**
 * Check if file needs migration by analyzing its content
 */
async function analyzeFile(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');

    const hasUseSnapshotDatabase = content.includes('useSnapshotDatabase');
    const hasManualDbSetup = content.includes('getDb()') && content.includes('beforeEach');
    const hasResetDbCache = content.includes('resetDbCache');
    const hasManualCleanup = content.includes('DELETE FROM') || content.includes('db.exec');
    const hasProcessEnvDbUrl = content.includes('process.env.DB_URL');
    const hasSystemPromptsHelper = content.includes('helpers/systemPromptsTestUtils');

    return {
      hasUseSnapshotDatabase,
      hasManualDbSetup,
      hasResetDbCache,
      hasManualCleanup,
      hasProcessEnvDbUrl,
      hasSystemPromptsHelper,
      needsFullMigration: !hasUseSnapshotDatabase && (hasManualDbSetup || hasResetDbCache || hasProcessEnvDbUrl),
      needsPartialMigration: hasUseSnapshotDatabase && (hasManualDbSetup || hasManualCleanup),
      isSystemPrompts: hasSystemPromptsHelper,
      isAlreadyMigrated: hasUseSnapshotDatabase && !hasManualDbSetup && !hasManualCleanup
    };
  } catch (error) {
    log(`❌ Failed to analyze ${filePath}: ${error.message}`, colors.red);
    return null;
  }
}

/**
 * Apply full migration transformation
 */
async function applyFullMigration(filePath, content) {
  let newContent = content;

  // Add useSnapshotDatabase import if missing
  if (!content.includes('useSnapshotDatabase')) {
    const importMatch = content.match(/(import.*from.*['"][^'"]*['"];?\n)+/);
    if (importMatch) {
      const lastImport = importMatch[0];
      const importToAdd = `import { useSnapshotDatabase } from '../test_support/useSnapshotDatabase.js';\n`;
      newContent = newContent.replace(lastImport, lastImport + importToAdd);
    }
  }

  // Add useSnapshotDatabase call after imports
  if (!content.includes('useSnapshotDatabase(')) {
    // Find appropriate tables based on imports and content
    let tables = ['sessions', 'users']; // default
    if (content.includes('conversations')) tables.push('conversations');
    if (content.includes('messages')) tables.push('messages');
    if (content.includes('providers')) tables.push('providers');
    if (content.includes('system_prompts')) tables.push('system_prompts');

    const useSnapshotCode = `
useSnapshotDatabase({
  cleanupTables: [${tables.map(t => `'${t}'`).join(', ')}],
});
`;

    // Insert after imports, before first describe/beforeAll
    const insertPoint = newContent.search(/(describe|beforeAll|beforeEach)\s*\(/);
    if (insertPoint > -1) {
      newContent = newContent.slice(0, insertPoint) + useSnapshotCode + '\n' + newContent.slice(insertPoint);
    }
  }

  // Remove manual database setup patterns
  // Remove process.env.DB_URL assignments
  newContent = newContent.replace(/process\.env\.DB_URL\s*=\s*['"][^'"]*['"];?\n?/g, '');

  // Remove manual beforeEach database setup
  newContent = newContent.replace(/beforeEach\(\(\) => \{[\s\S]*?resetDbCache\(\);[\s\S]*?\}\);?\n?/g, '');

  // Remove db.exec DELETE statements in beforeEach
  newContent = newContent.replace(/beforeEach\(\(\) => \{[\s\S]*?db\.exec\([^)]*DELETE[^)]*\);[\s\S]*?\}\);?\n?/g, '');

  // Remove afterEach db.close()
  newContent = newContent.replace(/afterEach\(\(\) => \{[\s\S]*?db\.close\(\);[\s\S]*?\}\);?\n?/g, '');

  return newContent;
}

/**
 * Apply partial migration cleanup
 */
async function applyPartialMigration(filePath, content) {
  let newContent = content;

  // Remove manual DB initialization from beforeEach but keep test-specific setup
  const beforeEachPattern = /beforeEach\(\(\) => \{([\s\S]*?)\}\);/g;
  const matches = [...newContent.matchAll(beforeEachPattern)];

  for (const match of matches) {
    const beforeEachBody = match[1];

    // Remove common patterns but keep test-specific setup
    let cleanedBody = beforeEachBody
      .replace(/\s*config\.persistence\.enabled = true;/g, '')
      .replace(/\s*config\.persistence\.dbUrl = ['"]file::memory:['"];/g, '')
      .replace(/\s*db = getDb\(\);/g, '')
      .replace(/\s*resetDbCache\(\);/g, '')
      .replace(/\s*db\.exec\([^)]*DELETE[^)]*\);/g, '');

    // If body is mostly empty after cleanup, remove the entire beforeEach
    if (cleanedBody.trim().length < 50 && !cleanedBody.includes('mock')) {
      newContent = newContent.replace(match[0], '');
    } else {
      newContent = newContent.replace(match[0], `beforeEach(() => {${cleanedBody}});`);
    }
  }

  return newContent;
}

/**
 * Migrate a single file
 */
async function migrateFile(fileName, migrationType) {
  const filePath = path.join(TESTS_DIR, fileName);
  log(`\n🔄 Migrating ${fileName} (${migrationType})...`, colors.yellow);

  try {
    const originalContent = await fs.readFile(filePath, 'utf8');
    const analysis = await analyzeFile(filePath);

    if (!analysis) {
      log(`❌ Could not analyze ${fileName}`, colors.red);
      return false;
    }

    let newContent = originalContent;

    if (migrationType === 'full') {
      newContent = await applyFullMigration(filePath, originalContent);
    } else if (migrationType === 'partial') {
      newContent = await applyPartialMigration(filePath, originalContent);
    }

    // Only write if content changed
    if (newContent !== originalContent) {
      await fs.writeFile(filePath, newContent);
      log(`✅ ${fileName} migrated successfully`, colors.green);
    } else {
      log(`ℹ️  ${fileName} no changes needed`, colors.blue);
    }

    return true;
  } catch (error) {
    log(`❌ Failed to migrate ${fileName}: ${error.message}`, colors.red);
    return false;
  }
}

/**
 * Run tests to verify migrations
 */
async function runTestsForFiles(files) {
  log(`\n🧪 Running tests for ${files.length} files...`, colors.blue);

  for (const file of files) {
    const testFile = path.join('__tests__', file);
    // Fixed: Use --testPathPatterns instead of --testPathPattern and correct Docker path
    const cmd = `./dev.sh exec backend npm test -- --testPathPatterns="${testFile}" --verbose`;
    const result = execCommand(cmd, `Test for ${file}`);

    if (!result.success) {
      log(`❌ Tests failed for ${file}`, colors.red);
      return false;
    }
  }

  log(`✅ All tests passed!`, colors.green);
  return true;
}

/**
 * Create git checkpoint
 */
function createCheckpoint(message) {
  log(`\n📝 Creating git checkpoint: ${message}`, colors.blue);

  const addResult = execCommand('git add .', 'Git add');
  if (!addResult.success) return false;

  const commitResult = execCommand(`git commit -m "${message}"`, 'Git commit');
  return commitResult.success;
}

/**
 * Rollback to previous commit
 */
function rollback() {
  log(`\n🔄 Rolling back changes...`, colors.yellow);
  const result = execCommand('git reset --hard HEAD~1', 'Git rollback');
  return result.success;
}

/**
 * Main migration process
 */
async function main() {
  log(`${colors.bold}🚀 Starting batch test migration to snapshot database system${colors.reset}\n`);

  // Safety: create backup branch
  log(`🔒 Creating safety backup branch...`, colors.blue);
  execCommand(`git checkout -b ${BACKUP_BRANCH}`, 'Create backup branch');
  execCommand('git checkout -', 'Return to original branch');

  // Migration batches with checkpoints
  const batches = [
    { name: 'Full Migration', files: migrationPlan.fullMigration, type: 'full' },
    { name: 'Partial Migration', files: migrationPlan.partialMigration, type: 'partial' }
  ];

  for (const batch of batches) {
    if (batch.files.length === 0) {
      log(`⏭️  Skipping ${batch.name} - no files to process`, colors.yellow);
      continue;
    }

    log(`\n${colors.bold}📦 Processing batch: ${batch.name} (${batch.files.length} files)${colors.reset}`, colors.blue);

    let allSucceeded = true;

    // Migrate files in batch
    for (const file of batch.files) {
      const success = await migrateFile(file, batch.type);
      if (!success) {
        allSucceeded = false;
        break;
      }
    }

    if (!allSucceeded) {
      log(`❌ Batch ${batch.name} failed during migration`, colors.red);
      rollback();
      continue;
    }

    // Test migrated files
    const testsPass = await runTestsForFiles(batch.files);
    if (!testsPass) {
      log(`❌ Batch ${batch.name} failed tests`, colors.red);
      rollback();
      continue;
    }

    // Create checkpoint
    const checkpointSuccess = createCheckpoint(`feat: migrate ${batch.name.toLowerCase()} tests to snapshot database system`);
    if (!checkpointSuccess) {
      log(`❌ Failed to create checkpoint for ${batch.name}`, colors.red);
      continue;
    }

    log(`✅ Batch ${batch.name} completed successfully!`, colors.green);
  }

  log(`\n${colors.bold}🎉 Migration process complete!${colors.reset}`, colors.green);
  log(`\n📋 Summary:`);
  log(`- Backup branch created: ${BACKUP_BRANCH}`);
  log(`- Files migrated with git checkpoints`);
  log(`- Run './dev.sh exec backend npm test' to verify all tests`);
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  log(`❌ Uncaught exception: ${error.message}`, colors.red);
  log(`🔄 Rolling back...`, colors.yellow);
  rollback();
  process.exit(1);
});

process.on('unhandledRejection', (error) => {
  log(`❌ Unhandled rejection: ${error.message}`, colors.red);
  log(`🔄 Rolling back...`, colors.yellow);
  rollback();
  process.exit(1);
});

// Run main function
main().catch((error) => {
  log(`❌ Migration failed: ${error.message}`, colors.red);
  log(`🔄 Rolling back...`, colors.yellow);
  rollback();
  process.exit(1);
});