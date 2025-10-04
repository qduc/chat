#!/usr/bin/env node

import { getDb } from '../src/db/client.js';

const db = getDb();

// Check for global providers
const globalProviders = db.prepare(`
  SELECT id, name, provider_type, base_url, is_default, enabled, user_id
  FROM providers
  WHERE user_id IS NULL AND deleted_at IS NULL
`).all();

console.log('=== Global Providers (user_id IS NULL) ===');
console.log(`Found: ${globalProviders.length} providers\n`);

if (globalProviders.length > 0) {
  globalProviders.forEach(p => {
    console.log(`ID: ${p.id}`);
    console.log(`  Name: ${p.name}`);
    console.log(`  Type: ${p.provider_type}`);
    console.log(`  Base URL: ${p.base_url}`);
    console.log(`  Default: ${p.is_default ? 'Yes' : 'No'}`);
    console.log(`  Enabled: ${p.enabled ? 'Yes' : 'No'}`);
    console.log('');
  });
}

// Check for active users
const activeUsers = db.prepare(`
  SELECT DISTINCT u.id, u.email, u.display_name,
    (SELECT COUNT(*) FROM conversations WHERE user_id = u.id AND deleted_at IS NULL) as conv_count,
    (SELECT COUNT(*) FROM providers WHERE user_id = u.id AND deleted_at IS NULL) as provider_count
  FROM users u
  WHERE u.deleted_at IS NULL
`).all();

console.log('=== Active Users ===');
console.log(`Found: ${activeUsers.length} users\n`);

if (activeUsers.length > 0) {
  activeUsers.forEach(u => {
    console.log(`ID: ${u.id}`);
    console.log(`  Email: ${u.email}`);
    console.log(`  Display Name: ${u.display_name || '(none)'}`);
    console.log(`  Conversations: ${u.conv_count}`);
    console.log(`  Providers: ${u.provider_count}`);
    console.log('');
  });
}

db.close();
