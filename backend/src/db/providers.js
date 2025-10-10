import { getDb } from './client.js';
import { logger } from '../logger.js';

function safeJsonParse(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

export function listProviders(userId) {
  if (!userId) {
    throw new Error('userId is required');
  }

  const db = getDb();
  const query = `
    SELECT id, name, provider_type, base_url, is_default, enabled, extra_headers, metadata, created_at, updated_at, user_id
    FROM providers
    WHERE deleted_at IS NULL AND user_id = @userId
    ORDER BY is_default DESC, updated_at DESC
  `;

  const rows = db.prepare(query).all({ userId });
  return rows.map((r) => ({
    ...r,
    extra_headers: safeJsonParse(r.extra_headers, {}),
    metadata: safeJsonParse(r.metadata, {}),
  }));
}

export function getProviderById(id, userId) {
  if (!userId) {
    throw new Error('userId is required');
  }

  const db = getDb();
  const query = `
    SELECT id, name, provider_type, base_url, is_default, enabled, extra_headers, metadata, created_at, updated_at, user_id
    FROM providers
    WHERE id=@id AND deleted_at IS NULL AND user_id = @userId
  `;

  const row = db.prepare(query).get({ id, userId });
  if (!row) return null;
  return {
    ...row,
    extra_headers: safeJsonParse(row.extra_headers, {}),
    metadata: safeJsonParse(row.metadata, {}),
  };
}

export function getProviderByIdWithApiKey(id, userId) {
  if (!userId) {
    throw new Error('userId is required');
  }

  const db = getDb();
  const query = `
    SELECT id, name, provider_type, api_key, base_url, is_default, enabled, extra_headers, metadata, created_at, updated_at, user_id
    FROM providers
    WHERE id=@id AND deleted_at IS NULL AND user_id = @userId
  `;

  const row = db.prepare(query).get({ id, userId });
  if (!row) return null;
  return {
    ...row,
    extra_headers: safeJsonParse(row.extra_headers, {}),
    metadata: safeJsonParse(row.metadata, {}),
  };
}

export function createProvider({
  id,
  name,
  provider_type,
  api_key = null,
  base_url = null,
  enabled = true,
  is_default = false,
  extra_headers = {},
  metadata = {},
  user_id = null, // New parameter for user scoping
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const pid = id || name || provider_type;
  db.prepare(
    `INSERT INTO providers (id, name, provider_type, api_key, base_url, enabled, is_default, extra_headers, metadata, user_id, created_at, updated_at)
     VALUES (@id, @name, @provider_type, @api_key, @base_url, @enabled, @is_default, @extra_headers, @metadata, @user_id, @now, @now)`
  ).run({
    id: pid,
    name,
    provider_type,
    api_key,
    base_url,
    enabled: enabled ? 1 : 0,
    is_default: is_default ? 1 : 0,
    extra_headers: JSON.stringify(extra_headers || {}),
    metadata: JSON.stringify(metadata || {}),
    user_id,
    now,
  });
  if (is_default) setDefaultProvider(pid, user_id);
  return getProviderById(pid, user_id);
}

export function updateProvider(id, { name, provider_type, api_key, base_url, enabled, is_default, extra_headers, metadata }, userId) {
  if (!userId) {
    throw new Error('userId is required');
  }

  const db = getDb();
  const now = new Date().toISOString();

  // Check if the provider exists and user owns it
  const current = db.prepare(`SELECT * FROM providers WHERE id=@id AND deleted_at IS NULL AND user_id=@userId`).get({ id, userId });

  if (!current) return null; // Provider not found or no permission

  const values = {
    id,
    name: name ?? current.name,
    provider_type: provider_type ?? current.provider_type,
    api_key: api_key ?? current.api_key,
    base_url: base_url ?? current.base_url,
    enabled: enabled === undefined ? current.enabled : (enabled ? 1 : 0),
    is_default: is_default === undefined ? current.is_default : (is_default ? 1 : 0),
    extra_headers: JSON.stringify(extra_headers ?? safeJsonParse(current.extra_headers, {})),
    metadata: JSON.stringify(metadata ?? safeJsonParse(current.metadata, {})),
    userId,
    now,
  };

  const info = db.prepare(
    `UPDATE providers SET
       name=@name,
       provider_type=@provider_type,
       api_key=@api_key,
       base_url=@base_url,
       enabled=@enabled,
       is_default=@is_default,
       extra_headers=@extra_headers,
       metadata=@metadata,
       updated_at=@now
     WHERE id=@id AND user_id=@userId AND deleted_at IS NULL`
  ).run(values);

  // If no rows were updated, return null (provider not found or no permission)
  if (info.changes === 0) {
    return null;
  }

  if (values.is_default) setDefaultProvider(id, userId);
  return getProviderById(id, userId);
}

export function setDefaultProvider(id, userId) {
  if (!userId) {
    throw new Error('userId is required');
  }

  const db = getDb();
  const tx = db.transaction((pid, uid) => {
    // Clear default for user's providers
    db.prepare(`UPDATE providers SET is_default=0 WHERE user_id=@uid AND deleted_at IS NULL`).run({ uid });
    // Set new default
    db.prepare(`UPDATE providers SET is_default=1, enabled=1, updated_at=@now WHERE id=@pid AND user_id=@uid AND deleted_at IS NULL`).run({
      pid,
      uid,
      now: new Date().toISOString()
    });
  });
  tx(id, userId);
  return getProviderById(id, userId);
}

export function deleteProvider(id, userId) {
  if (!userId) {
    throw new Error('userId is required');
  }

  const db = getDb();
  const now = new Date().toISOString();

  const info = db.prepare(
    `UPDATE providers SET deleted_at=@now, updated_at=@now WHERE id=@id AND user_id=@userId AND deleted_at IS NULL`
  ).run({ id, userId, now });

  return info.changes > 0;
}

/**
 * Check if a user can access a specific provider
 * Users can only access their own providers
 */
export function canAccessProvider(id, userId) {
  if (!userId) {
    throw new Error('userId is required');
  }

  const db = getDb();
  const row = db.prepare(
    `SELECT 1 FROM providers WHERE id=@id AND deleted_at IS NULL AND user_id=@userId`
  ).get({ id, userId });

  return !!row;
}

/**
 * Get the default provider for a user
 */
export function getDefaultProvider(userId) {
  if (!userId) {
    throw new Error('userId is required');
  }

  const db = getDb();

  // Find user's default provider
  const userDefault = db.prepare(`
    SELECT id, name, provider_type, base_url, is_default, enabled, extra_headers, metadata, created_at, updated_at, user_id
    FROM providers
    WHERE user_id=@userId AND is_default=1 AND enabled=1 AND deleted_at IS NULL
  `).get({ userId });

  if (userDefault) {
    return {
      ...userDefault,
      extra_headers: safeJsonParse(userDefault.extra_headers, {}),
      metadata: safeJsonParse(userDefault.metadata, {}),
    };
  }

  return null;
}

/**
 * Create default providers for a new user
 * Adds OpenAI, OpenRouter, LMStudio, and Llama.cpp local server providers
 * All providers start disabled with empty API keys
 * @param {string} userId - The ID of the user to create providers for
 */
export function createDefaultProviders(userId) {
  if (!userId) {
    throw new Error('userId is required to create default providers');
  }

  const defaultProviders = [
    {
      id: `${userId}-openai`,
      name: `OpenAI`,
      provider_type: 'openai',
      base_url: 'https://api.openai.com',
      api_key: null,
      enabled: false,
      is_default: false,
      extra_headers: {},
      metadata: { description: 'Personal OpenAI API configuration' },
      user_id: userId
    },
    {
      id: `${userId}-openrouter`,
      name: `OpenRouter`,
      provider_type: 'openai', // Uses OpenAI-compatible API
      base_url: 'https://openrouter.ai/api',
      api_key: null,
      enabled: false,
      is_default: false,
      extra_headers: {},
      metadata: { description: 'OpenRouter unified API for multiple models' },
      user_id: userId
    },
    {
      id: `${userId}-lmstudio`,
      name: `LM Studio`,
      provider_type: 'openai', // Uses OpenAI-compatible API
      base_url: 'http://localhost:1234',
      api_key: null,
      enabled: false,
      is_default: false,
      extra_headers: {},
      metadata: { description: 'Local LM Studio server' },
      user_id: userId
    },
    {
      id: `${userId}-llamacpp`,
      name: `Llama.cpp`,
      provider_type: 'openai', // Uses OpenAI-compatible API
      base_url: 'http://localhost:8080',
      api_key: null,
      enabled: false,
      is_default: false,
      extra_headers: {},
      metadata: { description: 'Local llama.cpp server' },
      user_id: userId
    }
  ];

  const createdProviders = [];

  for (const providerConfig of defaultProviders) {
    try {
      const provider = createProvider(providerConfig);
      createdProviders.push(provider);
    } catch (error) {
      logger.warn(`Failed to create default provider ${providerConfig.name} for user ${userId}:`, error.message);
      // Continue with other providers even if one fails
    }
  }

  return createdProviders;
}
