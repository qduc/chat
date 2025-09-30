import React, { useState, useEffect, useRef, useCallback } from 'react';

interface SaveAsModalProps {
  isOpen: boolean;
  initialName: string;
  content: string;
  existingNames: string[];
  onSave: (name: string) => Promise<boolean>;
  onCancel: () => void;
}

export default function SaveAsModal({
  isOpen,
  initialName,
  content,
  existingNames,
  onSave,
  onCancel
}: SaveAsModalProps) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Generate unique name by adding (1), (2), etc.
  const generateUniqueName = useCallback((baseName: string): string => {
    if (!existingNames.includes(baseName)) {
      return baseName;
    }

    let counter = 1;
    let uniqueName = `${baseName} (${counter})`;
    while (existingNames.includes(uniqueName)) {
      counter++;
      uniqueName = `${baseName} (${counter})`;
    }
    return uniqueName;
  }, [existingNames]);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      const uniqueName = generateUniqueName(initialName);
      setName(uniqueName);
      setError('');
      setSaving(false);
      // Focus input after modal renders
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 100);
    }
  }, [isOpen, initialName, generateUniqueName]);

  // Validate name
  const validateName = (nameValue: string): string => {
    if (!nameValue.trim()) {
      return 'Name is required';
    }
    if (nameValue.length > 255) {
      return 'Name must be 255 characters or less';
    }
    if (existingNames.includes(nameValue.trim())) {
      return 'A prompt with this name already exists';
    }
    return '';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedName = name.trim();
    const validationError = validateName(trimmedName);

    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError('');

    try {
      const success = await onSave(trimmedName);
      if (success) {
        // Modal will close via onCancel being called by parent
      } else {
        setError('Failed to save prompt. Please try again.');
      }
    } catch (err) {
      setError('An error occurred while saving. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value;
    setName(newName);

    // Clear error when user types
    if (error) {
      setError('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && !saving) {
      onCancel();
    }
  };

  if (!isOpen) return null;

  const isValid = name.trim() && !validateName(name.trim());
  const titleId = 'save-as-title';
  const descriptionId = 'save-as-description';
  const errorId = 'save-as-error';

  return (
    <div
      className="fixed inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
      role="presentation"
      onKeyDown={handleKeyDown}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        {/* Header */}
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <h3 id={titleId} className="text-lg font-medium text-gray-900 dark:text-gray-100">
            Save as New Prompt
          </h3>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit}>
          <div className="p-4">
            <p id={descriptionId} className="text-sm text-gray-700 dark:text-gray-300 mb-4">
              Create a new prompt with the current content.
            </p>

            {/* Name input */}
            <div className="mb-4">
              <label htmlFor="prompt-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Prompt Name
              </label>
              <input
                ref={inputRef}
                id="prompt-name"
                type="text"
                value={name}
                onChange={handleNameChange}
                className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  error
                    ? 'border-red-300 dark:border-red-600 bg-red-50 dark:bg-red-900/20'
                    : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700'
                } text-gray-900 dark:text-gray-100`}
                placeholder="Enter prompt name"
                maxLength={255}
                disabled={saving}
                aria-invalid={!!error}
                aria-describedby={error ? errorId : undefined}
              />

              {/* Character count */}
              <div className="mt-1 text-xs text-gray-500 dark:text-gray-400 text-right">
                {name.length}/255 characters
              </div>

              {/* Error message */}
              {error && (
                <div id={errorId} className="mt-2 text-sm text-red-600 dark:text-red-400" role="alert">
                  {error}
                </div>
              )}
            </div>

            {/* Content preview */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Content Preview
              </label>
              <div className="bg-gray-50 dark:bg-gray-900 rounded p-3 max-h-32 overflow-y-auto border border-gray-200 dark:border-gray-600">
                <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                  {content.length > 200
                    ? `${content.substring(0, 200)}...`
                    : content || '(Empty content)'
                  }
                </div>
              </div>
              <div className="mt-1 text-xs text-gray-500 dark:text-gray-400 text-right">
                {content.length} characters total
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-end space-x-3">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded border border-gray-300 dark:border-gray-600 disabled:opacity-50"
              disabled={saving}
            >
              Cancel
            </button>

            <button
              type="submit"
              className="px-4 py-2 text-sm bg-blue-500 text-white hover:bg-blue-600 rounded disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={!isValid || saving}
            >
              {saving ? 'Creating...' : 'Create Prompt'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}