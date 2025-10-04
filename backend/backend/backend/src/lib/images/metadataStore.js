// In-memory image metadata store for user isolation
const imageMetadata = new Map();

export function storeImageMetadata({ id, userId, storageFilename, originalName, mimeType, size }) {
  imageMetadata.set(id, {
    id,
    userId,
    storageFilename,
    originalName,
    mimeType,
    size,
    createdAt: Date.now(),
  });
}

export function getImageMetadataForUser(imageId, userId) {
  const metadata = imageMetadata.get(imageId);
  if (!metadata) return null;
  if (metadata.userId !== userId) return null;
  return metadata;
}

export function deleteImageMetadata(imageId) {
  imageMetadata.delete(imageId);
}

export function clearAllMetadata() {
  imageMetadata.clear();
}
