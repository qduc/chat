import React, { useState, useEffect } from 'react';
import { BuiltInPrompt, CustomPrompt } from '../../../hooks/useSystemPrompts';

interface PromptEditorProps {
  prompt: BuiltInPrompt | CustomPrompt | null;
  isEditing: boolean;
  inlineContent?: string;
  onSave: (updates: { name?: string; body?: string }) => Promise<boolean>;
  onCancel: () => void;
  onInlineChange: (content: string) => void;
  onToggleEdit: () => void;
}

export default function PromptEditor({
  prompt,
  isEditing,
  inlineContent,
  onSave,
  onCancel,
  onInlineChange,
  onToggleEdit
}: PromptEditorProps) {
  const [editName, setEditName] = useState('');
  const [editBody, setEditBody] = useState('');
  const [saving, setSaving] = useState(false);

  const isBuiltIn = prompt && 'read_only' in prompt;
  const hasUnsavedChanges = Boolean(inlineContent);
  const displayContent = inlineContent || prompt?.body || '';

  // Reset form when prompt changes
  useEffect(() => {
    if (prompt && isEditing) {
      setEditName(prompt.name);
      setEditBody(prompt.body);
    }
  }, [prompt, isEditing]);

  const handleSave = async () => {
    if (!prompt) return;

    setSaving(true);
    try {
      const updates: { name?: string; body?: string } = {};

      if (editName !== prompt.name) {
        updates.name = editName;
      }

      if (editBody !== prompt.body) {
        updates.body = editBody;
      }

      const success = await onSave(updates);
      if (success && !isBuiltIn) {
        // Exit edit mode after successful save - handled by parent
        onCancel();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditName(prompt?.name || '');
    setEditBody(prompt?.body || '');
    onCancel();
  };

  if (!prompt) {
    return (
      <div className="p-4 text-center text-gray-500 dark:text-gray-400">
        Select a prompt to view or edit
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex-1 min-w-0">
          {isEditing && !isBuiltIn ? (
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full text-lg font-medium bg-transparent border border-gray-300 dark:border-gray-600 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
              placeholder="Prompt name"
            />
          ) : (
            <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 truncate">
              {prompt.name}
              {hasUnsavedChanges && <span className="text-orange-500 ml-2">*</span>}
            </h3>
          )}

          {('description' in prompt) && prompt.description && !isEditing && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {prompt.description}
            </p>
          )}
        </div>

        <div className="flex items-center space-x-2 ml-4">
          {!isBuiltIn && (
            <>
              {!isEditing ? (
                <button
                  onClick={onToggleEdit}
                  className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  Edit
                </button>
              ) : (
                <>
                  <button
                    onClick={handleCancel}
                    className="px-3 py-1 text-sm bg-gray-500 text-white rounded hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-500"
                    disabled={saving}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    className="px-3 py-1 text-sm bg-green-500 text-white rounded hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50"
                    disabled={saving || (!editName.trim() || !editBody.trim())}
                  >
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col min-h-0">
        {isEditing && !isBuiltIn ? (
          <textarea
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
            className="flex-1 p-4 border-0 resize-none focus:outline-none bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            placeholder="Enter your prompt content..."
          />
        ) : (
          <>
            <textarea
              value={displayContent}
              onChange={(e) => onInlineChange(e.target.value)}
              className="flex-1 p-4 border-0 resize-none focus:outline-none bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              placeholder={isBuiltIn ? "This is a built-in prompt. Your edits will be temporary and used only for the current session." : "Edit your prompt content..."}
              readOnly={false}
            />

            {hasUnsavedChanges && (
              <div className="p-3 bg-orange-50 dark:bg-orange-900/20 border-t border-orange-200 dark:border-orange-700">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-orange-700 dark:text-orange-300">
                    You have unsaved changes that will be used for new conversations.
                  </span>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => onInlineChange('')}
                      className="px-2 py-1 text-xs bg-gray-500 text-white rounded hover:bg-gray-600"
                    >
                      Discard
                    </button>
                    {!isBuiltIn && (
                      <button
                        onClick={() => onSave({ body: inlineContent })}
                        className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
                      >
                        Save Permanently
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Info footer */}
      <div className="p-3 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
          <div className="flex items-center space-x-4">
            {isBuiltIn ? (
              <span>Built-in prompt (read-only)</span>
            ) : (
              <>
                {'usage_count' in prompt && (
                  <span>Used {prompt.usage_count} times</span>
                )}
                <span>Created {new Date(prompt.created_at).toLocaleDateString()}</span>
                {'updated_at' in prompt && prompt.updated_at !== prompt.created_at && (
                  <span>Updated {new Date(prompt.updated_at).toLocaleDateString()}</span>
                )}
              </>
            )}
          </div>
          <div>
            {displayContent.length} characters
          </div>
        </div>
      </div>
    </div>
  );
}