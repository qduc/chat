import React from 'react';
import Modal from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';

interface UnsavedChangesModalProps {
  isOpen: boolean;
  promptName: string;
  inlineContent: string;
  onDiscard: () => void;
  onSave: () => void;
  onSaveAsNew: () => void;
  onCancel: () => void;
}

export default function UnsavedChangesModal({
  isOpen,
  promptName,
  inlineContent,
  onDiscard,
  onSave,
  onSaveAsNew,
  onCancel,
}: UnsavedChangesModalProps) {
  return (
    <Modal
      open={isOpen}
      onClose={onCancel}
      title="Unsaved Changes"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="ghost" onClick={onDiscard} className="text-danger hover:text-danger">
            Discard
          </Button>
          <Button variant="secondary" onClick={onSaveAsNew}>
            Save as New
          </Button>
          <Button variant="primary" onClick={onSave}>
            Save Changes
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-fg-muted">
          You have unsaved changes to &ldquo;{promptName}&rdquo;. What would you like to do?
        </p>

        <section
          aria-label="Preview of unsaved changes"
          aria-live="polite"
          className="flex max-h-32 flex-col gap-1 overflow-y-auto rounded-control border border-line bg-canvas-subtle p-3"
        >
          <span className="text-xs text-fg-subtle">Preview:</span>
          <p className="text-sm whitespace-pre-wrap text-fg">
            {inlineContent.length > 200 ? `${inlineContent.substring(0, 200)}...` : inlineContent}
          </p>
        </section>
      </div>
    </Modal>
  );
}
