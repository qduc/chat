export default {
  version: 6,
  up: `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,                    -- UUID
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,           -- bcrypt hash
        display_name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        email_verified BOOLEAN DEFAULT FALSE,
        last_login_at DATETIME,
        deleted_at DATETIME
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_created ON users(created_at);
    `,
  down: `
      DROP INDEX IF EXISTS idx_users_created;
      DROP INDEX IF EXISTS idx_users_email;
      DROP TABLE IF EXISTS users;
    `
};