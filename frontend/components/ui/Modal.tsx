"use client";
import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  maxWidthClassName?: string;
}

export function Modal({ open, onClose, title, children, maxWidthClassName = "max-w-lg" }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      aria-modal
      role="dialog"
      className="fixed inset-0 z-[10000] flex items-center justify-center"
    >
      <div
        className="absolute inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={`relative w-full ${maxWidthClassName} mx-2 sm:mx-4 max-h-[90vh] overflow-hidden rounded-xl bg-white dark:bg-neutral-900 border border-slate-200/70 dark:border-neutral-800 shadow-2xl`}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200/70 dark:border-neutral-800">
          <h2 className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="p-1 rounded-md hover:bg-slate-100 dark:hover:bg-neutral-800 text-slate-600 dark:text-slate-300"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-3 sm:p-4 overflow-y-auto max-h-[calc(90vh-4rem)]">
          {children}
        </div>
      </div>
    </div>
  );
}

export default Modal;
