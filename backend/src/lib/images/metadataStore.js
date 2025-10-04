import { config } from '../../env.js';
import {
  createImageRecord,
  getImageRecordById,
  getImageRecordForUser,
  deleteImageRecord,
} from '../../db/images.js';

const inMemoryStore = new Map();

function normalizeRecord(record) {
  if (!record) return null;

  const userId = record.userId || record.user_id;
  const storageFilename = record.storageFilename || record.storage_filename;
  const originalName = record.originalName ?? record.original_name ?? null;
  const mimeType = record.mimeType ?? record.mime_type ?? null;
  const size = typeof record.size === 'number' ? record.size : Number(record.size) || 0;
  const createdAt = record.createdAt || record.created_at || new Date().toISOString();

  return {
    id: record.id,
    userId,
    storageFilename,
    originalName,
    mimeType,
    size,
    createdAt,
  };
}

function useInMemoryStore() {
  return !config.persistence.enabled;
}

export function storeImageMetadata(record) {
  const normalized = normalizeRecord(record);

  if (!normalized || !normalized.id || !normalized.userId || !normalized.storageFilename) {
    throw new Error('Invalid image metadata payload');
  }

  if (useInMemoryStore()) {
    inMemoryStore.set(normalized.id, normalized);
    return;
  }

  createImageRecord(normalized);
}

export function getImageMetadata(id) {
  if (!id) return null;

  if (useInMemoryStore()) {
    return inMemoryStore.get(id) || null;
  }

  return getImageRecordById(id);
}

export function getImageMetadataForUser(id, userId) {
  if (!id || !userId) return null;

  if (useInMemoryStore()) {
    const record = inMemoryStore.get(id);
    return record && record.userId === userId ? record : null;
  }

  return getImageRecordForUser({ id, userId });
}

export function deleteImageMetadata(id) {
  if (!id) return;

  if (useInMemoryStore()) {
    inMemoryStore.delete(id);
    return;
  }

  deleteImageRecord(id);
}
