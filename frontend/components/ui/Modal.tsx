'use client';
import React from 'react';
import { Dialog, DialogContent, type DialogSize } from './Dialog';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  size?: DialogSize;
  footer?: React.ReactNode;
  closeLabel?: string;
  bodyClassName?: string;
}

/** Convenience wrapper over `Dialog` for the common open/onClose + title pattern. */
export function Modal({
  open,
  onClose,
  title,
  children,
  size = 'md',
  footer,
  closeLabel,
  bodyClassName,
}: ModalProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        title={title}
        size={size}
        footer={footer}
        closeLabel={closeLabel}
        bodyClassName={bodyClassName}
      >
        {children}
      </DialogContent>
    </Dialog>
  );
}

export default Modal;
