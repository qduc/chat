import { describe, test, expect, beforeAll, beforeEach } from '@jest/globals';
import { safeTestSetup } from '../test_support/databaseSafety.js';
import { config } from '../src/env.js';
import { getDb, resetDbCache } from '../src/db/index.js';
import { createUser } from '../src/db/users.js';
import { createProvider, getProviderByIdWithApiKey } from '../src/db/providers.js';
import { upsertUserSetting, getUserSetting } from '../src/db/userSettings.js';

const TEST_KEK_HEX = '0123456789abcdef'.repeat(4); // 32 bytes in hex

beforeAll(() => {
  safeTestSetup();
});

beforeEach(() => {
  // Ensure we use an in-memory DB for each test
  config.persistence.enabled = true;
  config.persistence.dbUrl = 'file::memory:';
  resetDbCache();

  const db = getDb();
  db.exec('DELETE FROM messages; DELETE FROM conversations; DELETE FROM providers; DELETE FROM user_settings; DELETE FROM sessions; DELETE FROM users;');
});

describe('Envelope encryption (providers + user_settings)', () => {
  test('encrypts providers.api_key at rest when ENCRYPTION_MASTER_KEY is configured', () => {
    process.env.ENCRYPTION_MASTER_KEY = TEST_KEK_HEX;

    const user = createUser({ email: 'enc-provider@test.com', passwordHash: 'pw', displayName: 'Enc' });

    const created = createProvider({
      name: `Enc OpenAI ${user.id}`,
      provider_type: 'openai',
      api_key: 'sk-test-secret',
      base_url: 'https://api.openai.com',
      enabled: true,
      is_default: false,
      extra_headers: {},
      metadata: {},
      user_id: user.id,
    });

    const db = getDb();
    const raw = db.prepare('SELECT api_key FROM providers WHERE id = ?').get(created.id);
    expect(raw.api_key).toBeTruthy();
    expect(raw.api_key).not.toBe('sk-test-secret');
    expect(String(raw.api_key).startsWith('$ENC$')).toBe(true);

    const fetched = getProviderByIdWithApiKey(created.id, user.id);
    expect(fetched.api_key).toBe('sk-test-secret');
  });

  test('encrypts user_settings.value for sensitive keys when ENCRYPTION_MASTER_KEY is configured', () => {
    process.env.ENCRYPTION_MASTER_KEY = TEST_KEK_HEX;

    const user = createUser({ email: 'enc-settings@test.com', passwordHash: 'pw', displayName: 'Enc' });

    const row = upsertUserSetting(user.id, 'tavily_api_key', 'tvly-secret');
    expect(row.value).toBe('tvly-secret');

    const db = getDb();
    const raw = db
      .prepare('SELECT value FROM user_settings WHERE user_id = ? AND name = ?')
      .get(user.id, 'tavily_api_key');

    expect(raw.value).toBeTruthy();
    expect(raw.value).not.toBe('tvly-secret');
    expect(String(raw.value).startsWith('$ENC$')).toBe(true);

    const fetched = getUserSetting(user.id, 'tavily_api_key');
    expect(fetched.value).toBe('tvly-secret');
  });

  test('gracefully stores plaintext when ENCRYPTION_MASTER_KEY is missing', () => {
    delete process.env.ENCRYPTION_MASTER_KEY;

    const user = createUser({ email: 'no-kek@test.com', passwordHash: 'pw', displayName: 'NoKek' });

    const p = createProvider({
      name: `Plain OpenAI ${user.id}`,
      provider_type: 'openai',
      api_key: 'sk-plain',
      base_url: 'https://api.openai.com',
      enabled: true,
      is_default: false,
      extra_headers: {},
      metadata: {},
      user_id: user.id,
    });

    const db = getDb();
    const rawProvider = db.prepare('SELECT api_key FROM providers WHERE id = ?').get(p.id);
    expect(rawProvider.api_key).toBe('sk-plain');

    const s = upsertUserSetting(user.id, 'tavily_api_key', 'tvly-plain');
    expect(s.value).toBe('tvly-plain');

    const rawSetting = db
      .prepare('SELECT value FROM user_settings WHERE user_id = ? AND name = ?')
      .get(user.id, 'tavily_api_key');
    expect(rawSetting.value).toBe('tvly-plain');
  });
});
