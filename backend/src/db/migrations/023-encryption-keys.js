export default {
  version: 23,
  up: `
    -- Envelope encryption support
    -- Per-user DEK (data encryption key) is stored encrypted with the master KEK.
    ALTER TABLE users ADD COLUMN encrypted_dek TEXT NULL;
    ALTER TABLE users ADD COLUMN dek_created_at DATETIME NULL;
    ALTER TABLE users ADD COLUMN dek_version INTEGER DEFAULT 1;
  `,
  down: `
    ALTER TABLE users DROP COLUMN encrypted_dek;
    ALTER TABLE users DROP COLUMN dek_created_at;
    ALTER TABLE users DROP COLUMN dek_version;
  `,
};
