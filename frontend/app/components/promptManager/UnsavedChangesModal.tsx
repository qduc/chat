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
  onCancel
}: UnsavedChangesModalProps) {
  if (!isOpen) return null;

  const titleId = 'unsaved-changes-title';
  const descriptionId = 'unsaved-changes-description';
  const previewId = 'unsaved-changes-preview';

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" role="presentation">
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
  aria-describedby={`${descriptionId} ${previewId}`}
        tabIndex={-1}
      >
        {/* Header */}
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <h3 id={titleId} className="text-lg font-medium text-gray-900 dark:text-gray-100">
            Unsaved Changes
          </h3>
        </div>

        {/* Content */}
        <div className="p-4">
          <p id={descriptionId} className="text-sm text-gray-700 dark:text-gray-300 mb-4">
            You have unsaved changes to &ldquo;{promptName}&rdquo;. What would you like to do?
          </p>

          {/* Preview of changes */}
          <div
            className="bg-gray-50 dark:bg-gray-900 rounded p-3 max-h-32 overflow-y-auto mb-4"
            id={previewId}
            aria-live="polite"
          >
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Preview:</div>
            <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
              {inlineContent.length > 200
                ? `${inlineContent.substring(0, 200)}...`
                : inlineContent
              }
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-end space-x-2">
          <button
            onClick={onCancel}
            type="button"
            className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded border border-gray-300 dark:border-gray-600"
          >
            Cancel
          </button>

          <button
            onClick={onDiscard}
            type="button"
            className="px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded border border-red-300 dark:border-red-600"
          >
            Discard Changes
          </button>

          <button
            onClick={onSaveAsNew}
            type="button"
            className="px-3 py-2 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded border border-blue-300 dark:border-blue-600"
          >
            Save as New
          </button>

          <button
            onClick={onSave}
            type="button"
            className="px-3 py-2 text-sm bg-green-500 text-white hover:bg-green-600 rounded"
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}