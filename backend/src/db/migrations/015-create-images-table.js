export default {
  version: 15,
  up: `
    CREATE TABLE IF NOT EXISTS images (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      storage_filename TEXT NOT NULL,
      original_name TEXT,
      mime_type TEXT,
      size INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_images_user_id ON images(user_id);
  `,
  down: `
    DROP TABLE IF EXISTS images;
  `,
};
