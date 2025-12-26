import React from 'react';

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
  if (!isOpen) return null;

  const titleId = 'unsaved-changes-title';
  const descriptionId = 'unsaved-changes-description';
  const previewId = 'unsaved-changes-preview';

  return (
    <div
      className="fixed inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
      role="presentation"
    >
      <div
        className="bg-white dark:bg-zinc-900 rounded-xl shadow-xl max-w-md w-full mx-4 border border-zinc-200 dark:border-zinc-800"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={`${descriptionId} ${previewId}`}
        tabIndex={-1}
      >
        {/* Header */}
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800">
          <h3 id={titleId} className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
            Unsaved Changes
          </h3>
        </div>

        {/* Content */}
        <div className="p-4">
          <p id={descriptionId} className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
            You have unsaved changes to &ldquo;{promptName}&rdquo;. What would you like to do?
          </p>

          {/* Preview of changes */}
          <div
            className="bg-zinc-50 dark:bg-zinc-900/50 rounded-lg p-3 max-h-32 overflow-y-auto mb-4 border border-zinc-200 dark:border-zinc-800"
            id={previewId}
            aria-live="polite"
          >
            <div className="text-xs text-zinc-500 dark:text-zinc-500 mb-1">Preview:</div>
            <div className="text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap">
              {inlineContent.length > 200 ? `${inlineContent.substring(0, 200)}...` : inlineContent}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 flex justify-end space-x-2 flex-wrap gap-y-2">
          <button
            onClick={onCancel}
            type="button"
            className="px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 transition-colors"
          >
            Cancel
          </button>

          <button
            onClick={onDiscard}
            type="button"
            className="px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-900/50 transition-colors"
          >
            Discard
          </button>

          <button
            onClick={onSaveAsNew}
            type="button"
            className="px-3 py-2 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 transition-colors"
          >
            Save as New
          </button>

          <button
            onClick={onSave}
            type="button"
            className="px-3 py-2 text-sm bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 rounded-lg transition-colors"
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
