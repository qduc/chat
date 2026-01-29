export default {
  version: 31,
  up: `
    -- Migrate providers with api.openai.com URL to 'openai-responses'
    UPDATE providers
    SET provider_type = 'openai-responses',
        updated_at = datetime('now')
    WHERE provider_type = 'openai'
      AND base_url IS NOT NULL
      AND LOWER(base_url) LIKE '%api.openai.com%';

    -- Migrate all other 'openai' providers to 'openai-completions'
    UPDATE providers
    SET provider_type = 'openai-completions',
        updated_at = datetime('now')
    WHERE provider_type = 'openai';
  `,
  down: `
    -- Revert both types back to 'openai'
    UPDATE providers
    SET provider_type = 'openai',
        updated_at = datetime('now')
    WHERE provider_type IN ('openai-responses', 'openai-completions');
  `
};
