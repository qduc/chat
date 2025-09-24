import { getDb } from './client.js';

function safeJsonParse(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

export function listProviders() {
  const db = getDb();
  const rows = db.prepare(
    `SELECT id, name, provider_type, base_url, is_default, enabled, extra_headers, metadata, created_at, updated_at
     FROM providers WHERE deleted_at IS NULL ORDER BY is_default DESC, updated_at DESC`
  ).all();
  return rows.map((r) => ({
    ...r,
    extra_headers: safeJsonParse(r.extra_headers, {}),
    metadata: safeJsonParse(r.metadata, {}),
  }));
}

export function getProviderById(id) {
  const db = getDb();
  const row = db.prepare(
    `SELECT id, name, provider_type, base_url, is_default, enabled, extra_headers, metadata, created_at, updated_at
     FROM providers WHERE id=@id AND deleted_at IS NULL`
  ).get({ id });
  if (!row) return null;
  return {
    ...row,
    extra_headers: safeJsonParse(row.extra_headers, {}),
    metadata: safeJsonParse(row.metadata, {}),
  };
}

export function getProviderByIdWithApiKey(id) {
  const db = getDb();
  const row = db.prepare(
    `SELECT id, name, provider_type, api_key, base_url, is_default, enabled, extra_headers, metadata, created_at, updated_at
     FROM providers WHERE id=@id AND deleted_at IS NULL`
  ).get({ id });
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
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const pid = id || name || provider_type;
  db.prepare(
    `INSERT INTO providers (id, name, provider_type, api_key, base_url, enabled, is_default, extra_headers, metadata, created_at, updated_at)
     VALUES (@id, @name, @provider_type, @api_key, @base_url, @enabled, @is_default, @extra_headers, @metadata, @now, @now)`
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
    now,
  });
  if (is_default) setDefaultProvider(pid);
  return getProviderById(pid);
}

export function updateProvider(id, { name, provider_type, api_key, base_url, enabled, is_default, extra_headers, metadata }) {
  const db = getDb();
  const now = new Date().toISOString();
  const current = db.prepare(`SELECT * FROM providers WHERE id=@id AND deleted_at IS NULL`).get({ id });
  if (!current) return null;
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
  if (values.is_default) setDefaultProvider(id);
  return getProviderById(id);
}

export function setDefaultProvider(id) {
  const db = getDb();
  const tx = db.transaction((pid) => {
    db.prepare(`UPDATE providers SET is_default=0 WHERE deleted_at IS NULL`).run();
    db.prepare(`UPDATE providers SET is_default=1, enabled=1, updated_at=@now WHERE id=@id AND deleted_at IS NULL`).run({ id: pid, now: new Date().toISOString() });
  });
  tx(id);
  return getProviderById(id);
}

export function deleteProvider(id) {
  const db = getDb();
  const now = new Date().toISOString();
  const info = db.prepare(`UPDATE providers SET deleted_at=@now, updated_at=@now WHERE id=@id AND deleted_at IS NULL`).run({ id, now });
  return info.changes > 0;
}
