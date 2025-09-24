import { config } from '../../env.js';

export default function seedProviderFromEnv(db) {
  try {
    const countRow = db
      .prepare("SELECT COUNT(1) AS c FROM providers WHERE deleted_at IS NULL")
      .get();
    const existing = countRow?.c || 0;
    if (existing > 0) return;

    const providerType = (config.provider || 'openai').toLowerCase();
    const baseUrl = config?.providerConfig?.baseUrl || config?.openaiBaseUrl || null;
    const apiKey = config?.providerConfig?.apiKey || config?.openaiApiKey || null;
    const headersObj = config?.providerConfig?.headers || {};

    if (!apiKey && !baseUrl) return;

    const now = new Date().toISOString();
    const name =
      config?.providerConfig?.name ||
      (providerType === 'openai' ? 'OpenAI' : providerType);
    const id = providerType;
    const extraHeaders = JSON.stringify(headersObj || {});
    const metadata = JSON.stringify({ default_model: config?.defaultModel || null });

    db.prepare(`
      INSERT INTO providers (
        id, name, provider_type, api_key, base_url,
        is_default, enabled, extra_headers, metadata,
        created_at, updated_at
      ) VALUES (
        @id, @name, @provider_type, @api_key, @base_url,
        1, 1, @extra_headers, @metadata,
        @now, @now
      )
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name,
        provider_type=excluded.provider_type,
        api_key=COALESCE(excluded.api_key, providers.api_key),
        base_url=COALESCE(excluded.base_url, providers.base_url),
        extra_headers=excluded.extra_headers,
        metadata=excluded.metadata,
        is_default=1,
        enabled=1,
        updated_at=excluded.updated_at
    `).run({
      id,
      name,
      provider_type: providerType,
      api_key: apiKey,
      base_url: baseUrl,
      extra_headers: extraHeaders,
      metadata,
      now,
    });

    db.prepare(`UPDATE providers SET is_default = CASE WHEN id=@id THEN 1 ELSE 0 END`).run({ id });
  } catch (err) {
    console.warn('[seeder] Env provider seeding skipped:', err?.message || String(err));
  }
}
