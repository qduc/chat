import envProviderSeeder from './000-env-provider.js';
import openAIProviderSeeder from './001-openai-provider.js';

/**
 * Runs all database seeders in order
 * Seeders are executed in the order they are defined
 */
export function runSeeders(db, options = {}) {
  if (!db) {
    console.warn('[seeders] Database not available, skipping seeders');
    return;
  }

  // List of seeders to run in order
  const seeders = [
    { name: '000-env-provider', fn: envProviderSeeder },
    { name: '001-openai-provider', fn: openAIProviderSeeder },
  ];

  try {
    console.log(`[seeders] Found ${seeders.length} seeder(s)`);

    for (const { name, fn } of seeders) {
      try {
        if (typeof fn === 'function') {
          console.log(`[seeders] Running ${name}...`);
          fn(db, options);
        } else {
          console.warn(`[seeders] Skipping ${name} - not a function`);
        }
      } catch (error) {
        console.error(`[seeders] Failed to run ${name}:`, error.message);
      }
    }

    console.log('[seeders] Seeding completed');
  } catch (error) {
    console.error('[seeders] Failed to run seeders:', error.message);
  }
}
