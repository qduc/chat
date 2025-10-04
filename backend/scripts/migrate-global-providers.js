#!/usr/bin/env node

/**
 * Phase 2: Migrate Global Providers to User-Specific Providers
 *
 * This migration script:
 * 1. Identifies all global providers (user_id IS NULL)
 * 2. For each active user, copies global providers to their user scope
 * 3. Preserves API keys, settings, metadata, enabled/default states
 * 4. Soft-deletes global providers after migration
 * 5. Logs detailed migration results
 */

import { getDb } from '../src/db/client.js';
import fs from 'fs';

const DRY_RUN = process.argv.includes('--dry-run');

function logSection(title) {
  console.log('\n' + '='.repeat(60));
  console.log(title);
  console.log('='.repeat(60) + '\n');
}

function logInfo(message) {
  console.log(`ℹ️  ${message}`);
}

function logSuccess(message) {
  console.log(`✅ ${message}`);
}

function logWarning(message) {
  console.warn(`⚠️  ${message}`);
}

function logError(message) {
  console.error(`❌ ${message}`);
}

function main() {
  logSection('Phase 2: Global Providers Migration');

  if (DRY_RUN) {
    logWarning('DRY RUN MODE - No changes will be made to the database');
  }

  const db = getDb();

  try {
    // Step 1: Identify global providers
    logSection('Step 1: Identifying Global Providers');
    const globalProviders = db.prepare(`
      SELECT id, name, provider_type, api_key, base_url, is_default, enabled,
             extra_headers, metadata, created_at, updated_at
      FROM providers
      WHERE user_id IS NULL AND deleted_at IS NULL
    `).all();

    logInfo(`Found ${globalProviders.length} global providers:`);
    globalProviders.forEach(p => {
      console.log(`  - ${p.id} (${p.name}) - Default: ${p.is_default ? 'Yes' : 'No'}, Enabled: ${p.enabled ? 'Yes' : 'No'}`);
    });

    if (globalProviders.length === 0) {
      logSuccess('No global providers found. Migration not needed.');
      db.close();
      return;
    }

    // Step 2: Identify active users
    logSection('Step 2: Identifying Active Users');
    const activeUsers = db.prepare(`
      SELECT DISTINCT u.id, u.email, u.display_name,
        (SELECT COUNT(*) FROM conversations WHERE user_id = u.id AND deleted_at IS NULL) as conv_count
      FROM users u
      WHERE u.deleted_at IS NULL
    `).all();

    logInfo(`Found ${activeUsers.length} active users:`);
    activeUsers.forEach(u => {
      console.log(`  - ${u.id} (${u.email}) - ${u.conv_count} conversations`);
    });

    if (activeUsers.length === 0) {
      logWarning('No active users found. Skipping migration but will soft-delete global providers.');
    }

    // Step 3: Copy global providers to each user
    logSection('Step 3: Copying Global Providers to User Scope');

    let totalCopied = 0;
    let totalSkipped = 0;
    let totalErrors = 0;
    const migrationLog = [];

    for (const user of activeUsers) {
      logInfo(`Processing user: ${user.email} (${user.id})`);

      // Check what providers user already has
      const existingUserProviders = db.prepare(`
        SELECT id, name, provider_type
        FROM providers
        WHERE user_id = ? AND deleted_at IS NULL
      `).all(user.id);

      const existingProviderTypes = new Set(existingUserProviders.map(p => `${p.provider_type}-${p.name}`));

      for (const globalProvider of globalProviders) {
        const userProviderId = `${user.id}-${globalProvider.id}`;
        const providerKey = `${globalProvider.provider_type}-${globalProvider.name}`;

        // Skip if user already has a provider with same type and name
        if (existingProviderTypes.has(providerKey)) {
          logWarning(`  Skipping ${globalProvider.name} - user already has this provider`);
          totalSkipped++;
          migrationLog.push({
            userId: user.id,
            userEmail: user.email,
            providerId: globalProvider.id,
            providerName: globalProvider.name,
            action: 'skipped',
            reason: 'User already has provider with same type and name'
          });
          continue;
        }

        // Check if this specific provider copy already exists
        const existingCopy = db.prepare(`
          SELECT id FROM providers WHERE id = ? AND deleted_at IS NULL
        `).get(userProviderId);

        if (existingCopy) {
          logWarning(`  Skipping ${globalProvider.name} - provider copy already exists (${userProviderId})`);
          totalSkipped++;
          migrationLog.push({
            userId: user.id,
            userEmail: user.email,
            providerId: globalProvider.id,
            providerName: globalProvider.name,
            action: 'skipped',
            reason: 'Provider copy already exists'
          });
          continue;
        }

        try {
          if (!DRY_RUN) {
            const now = new Date().toISOString();

            db.prepare(`
              INSERT INTO providers (
                id, name, provider_type, api_key, base_url, is_default, enabled,
                extra_headers, metadata, user_id, created_at, updated_at
              ) VALUES (
                @id, @name, @provider_type, @api_key, @base_url, @is_default, @enabled,
                @extra_headers, @metadata, @user_id, @created_at, @updated_at
              )
            `).run({
              id: userProviderId,
              name: `${globalProvider.name} (Personal)`,
              provider_type: globalProvider.provider_type,
              api_key: globalProvider.api_key,
              base_url: globalProvider.base_url,
              is_default: globalProvider.is_default,
              enabled: globalProvider.enabled,
              extra_headers: globalProvider.extra_headers,
              metadata: globalProvider.metadata,
              user_id: user.id,
              created_at: now,
              updated_at: now
            });
          }

          logSuccess(`  ✓ Copied ${globalProvider.name} → ${userProviderId}`);
          totalCopied++;
          migrationLog.push({
            userId: user.id,
            userEmail: user.email,
            providerId: globalProvider.id,
            providerName: globalProvider.name,
            newProviderId: userProviderId,
            action: 'copied',
            reason: null
          });
        } catch (error) {
          logError(`  ✗ Failed to copy ${globalProvider.name}: ${error.message}`);
          totalErrors++;
          migrationLog.push({
            userId: user.id,
            userEmail: user.email,
            providerId: globalProvider.id,
            providerName: globalProvider.name,
            action: 'error',
            reason: error.message
          });
        }
      }
    }

    // Step 4: Soft-delete global providers
    logSection('Step 4: Soft-Deleting Global Providers');

    if (!DRY_RUN) {
      const now = new Date().toISOString();
      const result = db.prepare(`
        UPDATE providers
        SET deleted_at = ?, updated_at = ?
        WHERE user_id IS NULL AND deleted_at IS NULL
      `).run(now, now);

      logSuccess(`Soft-deleted ${result.changes} global providers`);
    } else {
      logInfo(`Would soft-delete ${globalProviders.length} global providers`);
    }

    // Step 5: Verification
    logSection('Step 5: Verification');

    // Check that no active global providers remain
    const remainingGlobalProviders = db.prepare(`
      SELECT COUNT(*) as count
      FROM providers
      WHERE user_id IS NULL AND deleted_at IS NULL
    `).get();

    if (!DRY_RUN && remainingGlobalProviders.count > 0) {
      logError(`Found ${remainingGlobalProviders.count} active global providers remaining!`);
    } else if (!DRY_RUN) {
      logSuccess('No active global providers remaining');
    }

    // Check that all users have at least one provider
    const usersWithoutProviders = db.prepare(`
      SELECT u.id, u.email
      FROM users u
      WHERE u.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM providers p
          WHERE p.user_id = u.id AND p.deleted_at IS NULL
        )
    `).all();

    if (usersWithoutProviders.length > 0) {
      logError(`Found ${usersWithoutProviders.length} users without providers:`);
      usersWithoutProviders.forEach(u => {
        console.log(`  - ${u.email} (${u.id})`);
      });
    } else {
      logSuccess('All users have at least one provider');
    }

    // Step 6: Summary
    logSection('Migration Summary');
    console.log(`Global Providers Found: ${globalProviders.length}`);
    console.log(`Active Users Found: ${activeUsers.length}`);
    console.log(`Providers Copied: ${totalCopied}`);
    console.log(`Providers Skipped: ${totalSkipped}`);
    console.log(`Errors: ${totalErrors}`);

    if (DRY_RUN) {
      logWarning('\nThis was a DRY RUN - no changes were made');
      logInfo('Run without --dry-run to apply changes');
    } else {
      logSuccess('\nMigration completed successfully!');
    }

    // Save detailed log
    if (!DRY_RUN) {
      const logPath = `./logs/migration-global-providers-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      fs.writeFileSync(logPath, JSON.stringify({
        timestamp: new Date().toISOString(),
        globalProvidersCount: globalProviders.length,
        activeUsersCount: activeUsers.length,
        totalCopied,
        totalSkipped,
        totalErrors,
        details: migrationLog
      }, null, 2));
      logInfo(`Detailed log saved to: ${logPath}`);
    }

  } catch (error) {
    logError(`Migration failed: ${error.message}`);
    console.error(error);
    process.exit(1);
  } finally {
    db.close();
  }
}

main();
