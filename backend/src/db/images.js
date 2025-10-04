import { getDb } from './client.js';

export function createImageRecord({ id, userId, storageFilename, originalName, mimeType, size }) {
  const db = getDb();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO images (id, user_id, storage_filename, original_name, mime_type, size, created_at)
     VALUES (@id, @userId, @storageFilename, @originalName, @mimeType, @size, @createdAt)`
  ).run({
    id,
    userId,
    storageFilename,
    originalName,
    mimeType,
    size,
    createdAt: now,
  });
}

export function getImageRecordById(id) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, user_id, storage_filename, original_name, mime_type, size, created_at
       FROM images WHERE id = @id`
    )
    .get({ id });

  if (!row) return null;

  return {
    id: row.id,
    userId: row.user_id,
    storageFilename: row.storage_filename,
    originalName: row.original_name,
    mimeType: row.mime_type,
    size: row.size,
    createdAt: row.created_at,
  };
}

export function getImageRecordForUser({ id, userId }) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, user_id, storage_filename, original_name, mime_type, size, created_at
       FROM images WHERE id = @id AND user_id = @userId`
    )
    .get({ id, userId });

  if (!row) return null;

  return {
    id: row.id,
    userId: row.user_id,
    storageFilename: row.storage_filename,
    originalName: row.original_name,
    mimeType: row.mime_type,
    size: row.size,
    createdAt: row.created_at,
  };
}

export function deleteImageRecord(id) {
  const db = getDb();
  db.prepare('DELETE FROM images WHERE id = @id').run({ id });
}
