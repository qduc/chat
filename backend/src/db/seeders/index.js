import envProviderSeeder from './000-env-provider.js';
import openAIProviderSeeder from './001-openai-provider.js';
import { logger } from '../../logger.js';

/**
 * Runs all database seeders in order
 * Seeders are executed in the order they are defined
 */
export function runSeeders(db, options = {}) {
  if (!db) {
    logger.warn('[seeders] Database not available, skipping seeders');
    return;
  }

  // List of seeders to run in order
  const seeders = [
    { name: '000-env-provider', fn: envProviderSeeder },
    { name: '001-openai-provider', fn: openAIProviderSeeder },
  ];

  try {
    logger.info(`[seeders] Found ${seeders.length} seeder(s)`);

    for (const { name, fn } of seeders) {
      try {
        if (typeof fn === 'function') {
          logger.info(`[seeders] Running ${name}...`);
          fn(db, options);
        } else {
          logger.warn(`[seeders] Skipping ${name} - not a function`);
        }
      } catch (error) {
        logger.error(`[seeders] Failed to run ${name}:`, error.message);
      }
    }

    logger.info('[seeders] Seeding completed');
  } catch (error) {
    logger.error('[seeders] Failed to run seeders:', error.message);
  }
}
