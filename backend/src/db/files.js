import { getDb } from './client.js';

export function createFileRecord({ id, userId, storageFilename, originalName, mimeType, size, content }) {
  const db = getDb();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO files (id, user_id, storage_filename, original_name, mime_type, size, content, created_at)
     VALUES (@id, @userId, @storageFilename, @originalName, @mimeType, @size, @content, @createdAt)`
  ).run({
    id,
    userId,
    storageFilename,
    originalName,
    mimeType,
    size,
    content: content || null,
    createdAt: now,
  });
}

export function getFileRecordById(id) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, user_id, storage_filename, original_name, mime_type, size, content, created_at
       FROM files WHERE id = @id`
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
    content: row.content,
    createdAt: row.created_at,
  };
}

export function getFileRecordForUser({ id, userId }) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, user_id, storage_filename, original_name, mime_type, size, content, created_at
       FROM files WHERE id = @id AND user_id = @userId`
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
    content: row.content,
    createdAt: row.created_at,
  };
}

export function deleteFileRecord(id) {
  const db = getDb();
  db.prepare('DELETE FROM files WHERE id = @id').run({ id });
}
