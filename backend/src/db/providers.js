import { getDb } from './client.js';

function safeJsonParse(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

export function listProviders(userId = null) {
  const db = getDb();
  let query;
  let params = {};

  if (userId) {
    // For authenticated users: show their providers + global providers (user_id IS NULL)
    // User providers take precedence over global ones with same name/type
    query = `
      SELECT id, name, provider_type, base_url, is_default, enabled, extra_headers, metadata, created_at, updated_at, user_id,
             CASE WHEN user_id = @userId THEN 1 ELSE 0 END as is_user_provider
      FROM providers
      WHERE deleted_at IS NULL AND (user_id = @userId OR user_id IS NULL)
      ORDER BY is_user_provider DESC, is_default DESC, updated_at DESC
    `;
    params.userId = userId;
  } else {
    // For anonymous users: only show global providers
    query = `
      SELECT id, name, provider_type, base_url, is_default, enabled, extra_headers, metadata, created_at, updated_at, user_id,
             0 as is_user_provider
      FROM providers
      WHERE deleted_at IS NULL AND user_id IS NULL
      ORDER BY is_default DESC, updated_at DESC
    `;
  }

  const rows = db.prepare(query).all(params);
  return rows.map((r) => ({
    ...r,
    extra_headers: safeJsonParse(r.extra_headers, {}),
    metadata: safeJsonParse(r.metadata, {}),
    is_user_provider: Boolean(r.is_user_provider),
  }));
}

export function getProviderById(id, userId = null) {
  const db = getDb();
  let query;
  let params = { id };

  if (userId) {
    // For authenticated users: can access their own providers or global providers
    query = `
      SELECT id, name, provider_type, base_url, is_default, enabled, extra_headers, metadata, created_at, updated_at, user_id
      FROM providers
      WHERE id=@id AND deleted_at IS NULL AND (user_id = @userId OR user_id IS NULL)
    `;
    params.userId = userId;
  } else {
    // For anonymous users: only global providers
    query = `
      SELECT id, name, provider_type, base_url, is_default, enabled, extra_headers, metadata, created_at, updated_at, user_id
      FROM providers
      WHERE id=@id AND deleted_at IS NULL AND user_id IS NULL
    `;
  }

  const row = db.prepare(query).get(params);
  if (!row) return null;
  return {
    ...row,
    extra_headers: safeJsonParse(row.extra_headers, {}),
    metadata: safeJsonParse(row.metadata, {}),
  };
}

export function getProviderByIdWithApiKey(id, userId = null) {
  const db = getDb();
  let query;
  let params = { id };

  if (userId) {
    // For authenticated users: can access their own providers or global providers
    query = `
      SELECT id, name, provider_type, api_key, base_url, is_default, enabled, extra_headers, metadata, created_at, updated_at, user_id
      FROM providers
      WHERE id=@id AND deleted_at IS NULL AND (user_id = @userId OR user_id IS NULL)
    `;
    params.userId = userId;
  } else {
    // For anonymous users: only global providers
    query = `
      SELECT id, name, provider_type, api_key, base_url, is_default, enabled, extra_headers, metadata, created_at, updated_at, user_id
      FROM providers
      WHERE id=@id AND deleted_at IS NULL AND user_id IS NULL
    `;
  }

  const row = db.prepare(query).get(params);
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

export function updateProvider(id, { name, provider_type, api_key, base_url, enabled, is_default, extra_headers, metadata }, userId = null) {
  const db = getDb();
  const now = new Date().toISOString();

  // First check if the provider exists and user has permission to update it
  let current;
  if (userId) {
    // User can only update their own providers
    current = db.prepare(`SELECT * FROM providers WHERE id=@id AND deleted_at IS NULL AND user_id=@userId`).get({ id, userId });
  } else {
    // Anonymous users can only update global providers
    current = db.prepare(`SELECT * FROM providers WHERE id=@id AND deleted_at IS NULL AND user_id IS NULL`).get({ id });
  }

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
    now,
  };
  db.prepare(
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
     WHERE id=@id`
  ).run(values);
  if (values.is_default) setDefaultProvider(id, userId);
  return getProviderById(id, userId);
}

export function setDefaultProvider(id, userId = null) {
  const db = getDb();
  const tx = db.transaction((pid, uid) => {
    if (uid) {
      // For user providers: only clear default for user's providers
      db.prepare(`UPDATE providers SET is_default=0 WHERE user_id=@uid AND deleted_at IS NULL`).run({ uid });
      db.prepare(`UPDATE providers SET is_default=1, enabled=1, updated_at=@now WHERE id=@pid AND user_id=@uid AND deleted_at IS NULL`).run({
        pid,
        uid,
        now: new Date().toISOString()
      });
    } else {
      // For global providers: only clear default for global providers
      db.prepare(`UPDATE providers SET is_default=0 WHERE user_id IS NULL AND deleted_at IS NULL`).run();
      db.prepare(`UPDATE providers SET is_default=1, enabled=1, updated_at=@now WHERE id=@pid AND user_id IS NULL AND deleted_at IS NULL`).run({
        pid,
        now: new Date().toISOString()
      });
    }
  });
  tx(id, userId);
  return getProviderById(id, userId);
}

export function deleteProvider(id, userId = null) {
  const db = getDb();
  const now = new Date().toISOString();

  let query, params;
  if (userId) {
    // User can only delete their own providers
    query = `UPDATE providers SET deleted_at=@now, updated_at=@now WHERE id=@id AND user_id=@userId AND deleted_at IS NULL`;
    params = { id, userId, now };
  } else {
    // Anonymous users can only delete global providers
    query = `UPDATE providers SET deleted_at=@now, updated_at=@now WHERE id=@id AND user_id IS NULL AND deleted_at IS NULL`;
    params = { id, now };
  }

  const info = db.prepare(query).run(params);
  return info.changes > 0;
}

/**
 * Check if a user can access a specific provider
 * Users can access their own providers or global providers
 */
export function canAccessProvider(id, userId = null) {
  const db = getDb();
  let query, params;

  if (userId) {
    query = `SELECT 1 FROM providers WHERE id=@id AND deleted_at IS NULL AND (user_id=@userId OR user_id IS NULL)`;
    params = { id, userId };
  } else {
    query = `SELECT 1 FROM providers WHERE id=@id AND deleted_at IS NULL AND user_id IS NULL`;
    params = { id };
  }

  const row = db.prepare(query).get(params);
  return !!row;
}

/**
 * Get the effective default provider for a user
 * Prioritizes user's default provider over global default
 */
export function getDefaultProvider(userId = null) {
  const db = getDb();

  if (userId) {
    // First try to find user's default provider
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

    // Fall back to global default provider
    const globalDefault = db.prepare(`
      SELECT id, name, provider_type, base_url, is_default, enabled, extra_headers, metadata, created_at, updated_at, user_id
      FROM providers
      WHERE user_id IS NULL AND is_default=1 AND enabled=1 AND deleted_at IS NULL
    `).get();

    if (globalDefault) {
      return {
        ...globalDefault,
        extra_headers: safeJsonParse(globalDefault.extra_headers, {}),
        metadata: safeJsonParse(globalDefault.metadata, {}),
      };
    }
  } else {
    // For anonymous users, only use global default
    const globalDefault = db.prepare(`
      SELECT id, name, provider_type, base_url, is_default, enabled, extra_headers, metadata, created_at, updated_at, user_id
      FROM providers
      WHERE user_id IS NULL AND is_default=1 AND enabled=1 AND deleted_at IS NULL
    `).get();

    if (globalDefault) {
      return {
        ...globalDefault,
        extra_headers: safeJsonParse(globalDefault.extra_headers, {}),
        metadata: safeJsonParse(globalDefault.metadata, {}),
      };
    }
  }

  return null;
}
