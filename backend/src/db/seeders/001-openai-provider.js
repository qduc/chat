import { v4 as uuidv4 } from 'uuid';

/**
 * Seeds the first OpenAI provider into the database
 * This seeder creates a default OpenAI provider with standard configuration
 */
export default function seedOpenAIProvider(db) {
  try {
    const providerId = 'openai';

    // Check if this specific provider already exists
    const existingProvider = db
      .prepare("SELECT id FROM providers WHERE id = @id AND deleted_at IS NULL")
      .get({ id: providerId });

    if (existingProvider) {
      console.log('[seeder] OpenAI provider already exists (id: openai), skipping seeding');
      return;
    }

    const now = new Date().toISOString();

    // Use INSERT OR IGNORE for additional safety
    const result = db.prepare(`
      INSERT OR IGNORE INTO providers (
        id,
        name,
        provider_type,
        api_key,
        base_url,
        is_default,
        enabled,
        extra_headers,
        metadata,
        created_at,
        updated_at
      ) VALUES (
        @id,
        @name,
        @provider_type,
        @api_key,
        @base_url,
        @is_default,
        @enabled,
        @extra_headers,
        @metadata,
        @created_at,
        @updated_at
      )
    `).run({
      id: providerId,
      name: 'OpenAI',
      provider_type: 'openai',
      api_key: null, // Will be set via environment or admin interface
      base_url: 'https://api.openai.com/v1',
      is_default: 1,
      enabled: 1,
      extra_headers: JSON.stringify({}),
      metadata: JSON.stringify({
        description: 'Official OpenAI API provider'
      }),
      created_at: now,
      updated_at: now
    });

    if (result.changes > 0) {
      console.log('[seeder] Successfully seeded OpenAI provider');

      // Ensure this provider is set as default if no other default exists
      const defaultProviders = db
        .prepare("SELECT COUNT(1) AS count FROM providers WHERE is_default = 1 AND deleted_at IS NULL")
        .get();

      if (defaultProviders?.count === 0) {
        db.prepare("UPDATE providers SET is_default = 1 WHERE id = @id").run({ id: providerId });
        console.log('[seeder] Set OpenAI provider as default');
      }
    } else {
      console.log('[seeder] OpenAI provider already exists (INSERT OR IGNORE)');
    }
  } catch (error) {
    console.warn('[seeder] Failed to seed OpenAI provider:', error.message);
  }
}