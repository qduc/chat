import React from 'react';
import { Modal } from './Modal';

interface ImagePreviewOverlayProps {
  src: string;
  onClose: () => void;
}

/** Full-size preview of a chat image (already resolved to a displayable src). */
export function ImagePreviewOverlay({ src, onClose }: ImagePreviewOverlayProps) {
  return (
    <Modal
      open
      onClose={onClose}
      title="Image preview"
      size="full"
      closeLabel="Close image preview"
      bodyClassName="flex items-center justify-center p-4"
    >
      <img
        src={src}
        alt="Enlarged chat message attachment"
        className="max-h-full max-w-full rounded-card object-contain"
      />
    </Modal>
  );
}
