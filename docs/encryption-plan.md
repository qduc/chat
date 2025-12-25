# Envelope Encryption Implementation Plan

## Overview

Implement envelope encryption for sensitive data (API keys + messages) using AES-256-GCM with a two-tier key hierarchy:
- **Master Key (KEK)**: Environment variable, never stored in DB
- **Per-User Data Encryption Key (DEK)**: Encrypted with KEK, stored in users table

## Data to Encrypt

| Table | Column | Type |
|-------|--------|------|
| `providers` | `api_key` | API keys for LLM providers |
| `user_settings` | `value` | Tool API keys (Tavily, Exa, SearXNG) |
| `messages` | `content` | Message text content |
| `messages` | `content_json` | Structured message content |

## File Structure

```
backend/src/
  lib/
    crypto/
      index.js          # Main exports
      constants.js      # Algorithm config, error codes
      kek.js            # Master key management
      dek.js            # Per-user DEK operations
      envelope.js       # encrypt/decrypt data API
      cache.js          # In-memory DEK cache (5 min TTL)
      errors.js         # EncryptionError class
  db/
    encryption.js       # encryptForUser/decryptForUser helpers
    migrations/
      023-encryption-keys.js  # Add encrypted_dek to users table
  scripts/
    migrate-encrypt-data.js   # One-time migration for existing data
```

## Encrypted Data Format

```
$ENC$v1$<nonce_base64>$<ciphertext_base64>$<authTag_base64>
```

Prefix allows automatic detection of encrypted vs plaintext data during migration.

## Implementation Phases

### Phase 1: Core Crypto Module

**Files to create:**
- `/backend/src/lib/crypto/constants.js`
- `/backend/src/lib/crypto/errors.js`
- `/backend/src/lib/crypto/kek.js`
- `/backend/src/lib/crypto/dek.js`
- `/backend/src/lib/crypto/envelope.js`
- `/backend/src/lib/crypto/cache.js`
- `/backend/src/lib/crypto/index.js`

**Key functions:**
```javascript
// kek.js
getKek()           // Get master key from env (ENCRYPTION_MASTER_KEY)
isKekConfigured()  // Check if encryption is enabled

// dek.js
generateDek()      // Create random 32-byte DEK
encryptDek(dek)    // Wrap DEK with KEK
decryptDek(enc)    // Unwrap DEK with KEK

// envelope.js
encryptData(plaintext, dek)  // AES-256-GCM encrypt
decryptData(ciphertext, dek) // AES-256-GCM decrypt
isEncrypted(value)           // Check $ENC$ prefix
```

### Phase 2: Database Migration

**File:** `/backend/src/db/migrations/023-encryption-keys.js`

```sql
ALTER TABLE users ADD COLUMN encrypted_dek TEXT NULL;
ALTER TABLE users ADD COLUMN dek_created_at DATETIME NULL;
ALTER TABLE users ADD COLUMN dek_version INTEGER DEFAULT 1;
```

### Phase 3: DB Encryption Helper

**File:** `/backend/src/db/encryption.js`

```javascript
ensureUserDek(userId)         // Get or create user's DEK
encryptForUser(userId, data)  // Encrypt with user's DEK
decryptForUser(userId, data)  // Decrypt with user's DEK
```

Graceful degradation: If KEK not configured, stores plaintext with warning log.

### Phase 4: Provider API Key Encryption

**File to modify:** `/backend/src/db/providers.js`

Integration points:
- `createProvider()` - Encrypt `api_key` before INSERT
- `updateProvider()` - Encrypt `api_key` before UPDATE
- `getProviderByIdWithApiKey()` - Decrypt `api_key` after SELECT
- `listProviders()` - Decrypt `api_key` in returned list

### Phase 5: User Settings Encryption

**File to modify:** `/backend/src/db/userSettings.js`

Sensitive keys to encrypt:
- `tavily_api_key`
- `exa_api_key`
- `searxng_api_key`

Integration points:
- `upsertUserSetting()` - Encrypt sensitive values
- `getUserSetting()` - Decrypt sensitive values
- `getAllUserSettings()` - Decrypt all sensitive values

### Phase 6: Message Content Encryption (Optional)

**File to modify:** `/backend/src/db/messages.js`

Integration points:
- `insertUserMessage()` - Encrypt `content`, `content_json`
- `insertAssistantFinal()` - Encrypt `content`, `content_json`
- `getMessagesPage()` - Decrypt content fields
- `getLastMessage()` - Decrypt content fields

**Note:** Requires userId to be passed through message operations. Check `simplifiedPersistence.js` for userId availability.

### Phase 7: Data Migration Script

**File:** `/backend/scripts/migrate-encrypt-data.js`

Features:
- Batch processing (100 records at a time)
- Idempotent (skips already encrypted data via `$ENC$` prefix check)
- Separate flags: `--providers`, `--settings`, `--messages`
- Progress logging

Usage:
```bash
ENCRYPTION_MASTER_KEY=... node scripts/migrate-encrypt-data.js --providers --settings
ENCRYPTION_MASTER_KEY=... node scripts/migrate-encrypt-data.js --messages  # Optional
```

### Phase 8: Environment Configuration

**File to modify:** `/backend/src/env.js`

Add:
```javascript
encryption: {
  masterKey: process.env.ENCRYPTION_MASTER_KEY || null,
  enabled: !!process.env.ENCRYPTION_MASTER_KEY,
  encryptMessages: bool(process.env.ENCRYPT_MESSAGE_CONTENT, false),
}
```

**File to update:** `/backend/.env.example`
```bash
# Encryption (generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
ENCRYPTION_MASTER_KEY=
ENCRYPT_MESSAGE_CONTENT=false
```

## Critical Files to Modify

1. `/backend/src/db/providers.js` - API key storage (lines 75-108, 110-158, 54-73)
2. `/backend/src/db/userSettings.js` - Tool settings storage
3. `/backend/src/db/messages.js` - Message content storage
4. `/backend/src/db/users.js` - Add DEK retrieval helper
5. `/backend/src/env.js` - Environment config

## Error Handling

| Scenario | Behavior |
|----------|----------|
| KEK missing | Log warning, store plaintext (graceful degradation) |
| DEK missing | Auto-generate new DEK for user |
| DEK corrupted | Log error, return HTTP 500 |
| Decryption failed | Log error, return null/placeholder |

## Security Notes

1. **Never log**: KEK, DEK, or decrypted sensitive data
2. **Cache DEKs**: 5-minute TTL in memory to reduce DB hits
3. **Invalidate cache**: On user logout or password change
4. **Key rotation**: Future enhancement - increment `dek_version`, re-encrypt

## Testing Checklist

- [ ] Encrypt/decrypt roundtrip works
- [ ] Graceful degradation when KEK not set
- [ ] New users get DEK on first sensitive write
- [ ] Existing plaintext data still readable
- [ ] Migration script encrypts existing data
- [ ] API endpoints work with encrypted data
- [ ] Performance acceptable (DEK caching effective)
