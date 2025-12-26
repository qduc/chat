import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, RotateCcw, X } from 'lucide-react';
import { useSystemPrompts } from '../hooks/useSystemPrompts';
import PromptDropdown from '../app/components/promptManager/PromptDropdown';
import SaveAsModal from '../app/components/promptManager/SaveAsModal';
import UnsavedChangesModal from '../app/components/promptManager/UnsavedChangesModal';

interface RightSidebarProps {
  userId?: string;
  conversationId?: string;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onEffectivePromptChange?: (content: string) => void;
  onActivePromptIdChange?: (promptId: string | null | undefined) => void;
  // Active system prompt ID from loaded conversation
  conversationActivePromptId?: string | null | undefined;
  conversationSystemPrompt?: string | null;
  width?: number;
  collapsedWidth?: number;
  isResizing?: boolean;
}

export function RightSidebar({
  userId,
  conversationId,
  collapsed = false,
  onToggleCollapse,
  onEffectivePromptChange,
  onActivePromptIdChange,
  conversationActivePromptId,
  conversationSystemPrompt,
  width = 320,
  collapsedWidth = 64,
  isResizing = false,
}: RightSidebarProps) {
  const {
    prompts,
    loading,
    error,
    activePromptId,
    setActivePromptId,
    hasUnsavedChanges,
    fetchPrompts,
    createPrompt,
    updatePrompt,
    deletePrompt,
    duplicatePrompt,
    selectPrompt,
    clearPrompt,
    setInlineEdit,
    clearInlineEdit,
    saveInlineEdit,
    discardInlineEdit,
    getPromptById,
    getEffectivePromptContent,
    inlineEdits,
  } = useSystemPrompts(userId);

  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
  const [showUnsavedModal, setShowUnsavedModal] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [showSaveAsModal, setShowSaveAsModal] = useState(false);
  const [saveAsInitialName, setSaveAsInitialName] = useState('');
  const [newPromptContent, setNewPromptContent] = useState('');
  // Prefer the conversation-provided active prompt ID when the parent supplies it.
  // If the parent didn't provide a conversationActivePromptId (undefined), fall
  // back to the previous behavior: when a conversation exists use the hook's
  // activePromptId, otherwise use the locally-selected promptId for new chats.
  const effectiveSelectedPromptId =
    conversationActivePromptId !== undefined
      ? conversationActivePromptId
      : conversationId
        ? activePromptId
        : selectedPromptId;

  // Notify parent of effective prompt content changes
  useEffect(() => {
    if (!onEffectivePromptChange) return;

    // If there's an effective selected prompt (which may come from the
    // conversation prop or local selection), use its effective content.
    if (effectiveSelectedPromptId) {
      const content = getEffectivePromptContent(effectiveSelectedPromptId);
      onEffectivePromptChange(content);
      return;
    }

    // Otherwise, fall back to any explicit conversation system prompt text.
    if (typeof conversationSystemPrompt === 'string' && conversationSystemPrompt.length > 0) {
      onEffectivePromptChange(conversationSystemPrompt);
      return;
    }

    onEffectivePromptChange('');
  }, [
    effectiveSelectedPromptId,
    inlineEdits,
    onEffectivePromptChange,
    getEffectivePromptContent,
    conversationSystemPrompt,
  ]);

  // Update active prompt ID when conversation changes
  useEffect(() => {
    if (conversationActivePromptId !== undefined) {
      setActivePromptId(conversationActivePromptId);
      if (conversationId) {
        setSelectedPromptId(conversationActivePromptId ?? null);
        if (conversationActivePromptId) {
          setNewPromptContent('');
        } else if (typeof conversationSystemPrompt === 'string') {
          setNewPromptContent(conversationSystemPrompt);
        } else {
          setNewPromptContent('');
        }
      }
    }
  }, [conversationActivePromptId, conversationSystemPrompt, conversationId, setActivePromptId]);

  const handleSelectPrompt = async (promptId: string) => {
    if (!conversationId) {
      // For new chats without conversation ID, just update local state
      // The prompt will be applied when the first message is sent
      setSelectedPromptId(promptId);
      setNewPromptContent(''); // Clear new prompt content

      // Trigger effective prompt change for new chats
      if (onEffectivePromptChange) {
        const content = getEffectivePromptContent(promptId);
        onEffectivePromptChange(content);
      }

      // Set the active prompt ID for new chats
      if (onActivePromptIdChange) {
        onActivePromptIdChange(promptId);
      }
      return;
    }

    setSelectedPromptId(promptId);
    setNewPromptContent(''); // Clear new prompt content

    // Immediately update the active prompt ID to fix dropdown binding
    // The backend call was successful, so we can update the local state
    setActivePromptId(promptId);

    // Notify parent component of the change
    if (onActivePromptIdChange) {
      onActivePromptIdChange(promptId);
    }
  };

  const handleClearSelection = async () => {
    if (!conversationId) {
      // For new chats without conversation ID, just update local state
      setSelectedPromptId(null);
      setNewPromptContent(''); // Clear new prompt content

      // Clear effective prompt for new chats
      if (onEffectivePromptChange) {
        onEffectivePromptChange('');
      }

      // Clear the active prompt ID for new chats
      if (onActivePromptIdChange) {
        onActivePromptIdChange(null);
      }
      return;
    }

    setSelectedPromptId(null);
    setNewPromptContent(''); // Clear new prompt content

    // Immediately update the active prompt ID to fix dropdown binding
    setActivePromptId(null);

    // Explicitly clear the effective prompt to prevent stale content from being used
    if (onEffectivePromptChange) {
      onEffectivePromptChange('');
    }

    // Clear the active prompt ID
    if (onActivePromptIdChange) {
      onActivePromptIdChange(null);
    }
  };

  const handleSavePrompt = async () => {
    if (!effectiveSelectedPromptId) return false;

    const success = await saveInlineEdit(effectiveSelectedPromptId);
    return success;
  };

  const handleSaveAsPrompt = async (name: string) => {
    const content = effectiveSelectedPromptId
      ? getEffectivePromptContent(effectiveSelectedPromptId)
      : newPromptContent;

    if (!content.trim()) return false;

    const newPrompt = await createPrompt({
      name,
      body: content,
    });

    if (newPrompt) {
      // Clear any inline edits since we've saved as new
      if (effectiveSelectedPromptId) {
        clearInlineEdit(effectiveSelectedPromptId);
      } else {
        // Clear new prompt content if we were creating from scratch
        setNewPromptContent('');
      }
      // Select the new prompt
      setSelectedPromptId(newPrompt.id);
      let selectionApplied = true;

      if (conversationId) {
        selectionApplied = await selectPrompt(newPrompt.id, conversationId);
      }

      if (selectionApplied && onActivePromptIdChange) {
        onActivePromptIdChange(newPrompt.id);
      }
      return true;
    }
    return false;
  };

  const handleDeletePrompt = async () => {
    if (!effectiveSelectedPromptId) return;

    const prompt = getPromptById(effectiveSelectedPromptId);
    if (!prompt || 'read_only' in prompt) return;

    if (confirm(`Delete "${prompt.name}"?`)) {
      const success = await deletePrompt(effectiveSelectedPromptId);
      if (success) {
        setSelectedPromptId(null);
        if (onEffectivePromptChange) {
          onEffectivePromptChange('');
        }
      }
    }
  };

  const handleInlineChange = (content: string) => {
    if (!effectiveSelectedPromptId) return;

    const prompt = getPromptById(effectiveSelectedPromptId);
    if (!prompt) return;

    // Clear inline edit if content matches original
    if (content === prompt.body) {
      clearInlineEdit(effectiveSelectedPromptId);
    } else {
      setInlineEdit(effectiveSelectedPromptId, content);
    }

    if (onEffectivePromptChange) {
      onEffectivePromptChange(content);
    }
  };

  const handleShowSaveAs = () => {
    const prompt = effectiveSelectedPromptId ? getPromptById(effectiveSelectedPromptId) : null;
    const baseName = prompt ? `${prompt.name} (Copy)` : 'New Prompt';
    setSaveAsInitialName(baseName);
    setShowSaveAsModal(true);
  };

  const handleSaveAsModalSave = async (name: string) => {
    const success = await handleSaveAsPrompt(name);
    if (success) {
      setShowSaveAsModal(false);
    }
    return success;
  };

  const handleSaveAsModalCancel = () => {
    setShowSaveAsModal(false);
  };

  const handleUnsavedDiscard = () => {
    if (effectiveSelectedPromptId) {
      discardInlineEdit(effectiveSelectedPromptId);
    }
    setShowUnsavedModal(false);
    if (pendingAction) {
      pendingAction();
      setPendingAction(null);
    }
  };

  const handleUnsavedSave = async () => {
    if (effectiveSelectedPromptId) {
      const success = await saveInlineEdit(effectiveSelectedPromptId);
      if (success) {
        setShowUnsavedModal(false);
        if (pendingAction) {
          pendingAction();
          setPendingAction(null);
        }
      }
    }
  };

  const handleUnsavedSaveAsNew = async () => {
    if (effectiveSelectedPromptId) {
      const prompt = getPromptById(effectiveSelectedPromptId);
      const inlineContent = inlineEdits[effectiveSelectedPromptId];

      if (prompt && inlineContent) {
        const newPrompt = await createPrompt({
          name: `${prompt.name} (Copy)`,
          body: inlineContent,
        });

        if (newPrompt) {
          discardInlineEdit(effectiveSelectedPromptId);
          setShowUnsavedModal(false);
          if (pendingAction) {
            pendingAction();
            setPendingAction(null);
          }
        }
      }
    }
  };

  const handleUnsavedCancel = () => {
    setShowUnsavedModal(false);
    setPendingAction(null);
  };

  // Clear the textarea content only (frontend only)
  const handleClearContent = () => {
    if (effectiveSelectedPromptId) {
      handleInlineChange('');
    } else {
      setNewPromptContent('');
      if (onEffectivePromptChange) {
        onEffectivePromptChange('');
      }
    }
  };

  const selectedPrompt = effectiveSelectedPromptId
    ? getPromptById(effectiveSelectedPromptId)
    : null;
  const currentContent = effectiveSelectedPromptId
    ? getEffectivePromptContent(effectiveSelectedPromptId)
    : newPromptContent;
  const isBuiltIn = selectedPrompt && 'read_only' in selectedPrompt;
  const baseInlineContent = conversationId ? (conversationSystemPrompt ?? '') : '';
  const hasChanges = effectiveSelectedPromptId
    ? hasUnsavedChanges(effectiveSelectedPromptId)
    : conversationId
      ? newPromptContent !== baseInlineContent
      : newPromptContent.length > 0;
  const existingNames = prompts
    ? [...prompts.built_ins.map((p) => p.name), ...prompts.custom.map((p) => p.name)]
    : [];
  const computedWidth = collapsed ? collapsedWidth : width;

  return (
    <>
      <aside
        style={{
          width: collapsed ? `${collapsedWidth}px` : `${computedWidth}px`,
          minWidth: collapsed ? `${collapsedWidth}px` : `${computedWidth}px`,
          flexShrink: 0,
          transition: isResizing ? 'none' : 'width 0.3s ease-in-out',
          willChange: isResizing ? 'width' : undefined,
        }}
        className={`
          z-30 flex flex-col bg-white dark:bg-zinc-950 border-l border-zinc-200/50 dark:border-zinc-800/50 relative h-full
          ${!collapsed ? 'w-72 sm:w-80 md:w-auto' : 'w-16 md:w-auto'}
        `}
      >
        {collapsed ? (
          // Collapsed state - compact indicator
          <div className="flex flex-col items-center space-y-3 pt-2 p-4">
            {/* Expand button - Desktop only */}
            <button
              className="hidden md:flex w-10 h-10 rounded-lg hover:bg-zinc-200/50 dark:hover:bg-zinc-800 transition-colors items-center justify-center text-zinc-500 dark:text-zinc-400 cursor-pointer"
              onClick={onToggleCollapse}
              title="Expand sidebar"
              aria-label="Expand sidebar"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          </div>
        ) : (
          // Expanded state - full prompt manager UI
          <div className="flex flex-col h-full">
            {/* Header */}
            <div className="p-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                System Prompts
              </h2>
              {/* Collapse button - Desktop only */}
              <button
                className="hidden md:flex p-1.5 rounded-lg hover:bg-zinc-200/50 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 transition-colors items-center justify-center"
                onClick={onToggleCollapse}
                title="Collapse sidebar"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 flex flex-col min-h-0">
              {loading && !prompts ? (
                <div className="p-4 text-center text-gray-500 dark:text-gray-400">
                  Loading prompts...
                </div>
              ) : (
                <>
                  {/* Error display */}
                  {(error || prompts?.error) && (
                    <div className="p-4">
                      <div
                        className="p-2 text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded"
                        role="status"
                        aria-live="polite"
                      >
                        ⚠️ {error || prompts?.error}
                      </div>
                    </div>
                  )}

                  {/* Prompt Dropdown */}
                  <div className="p-4">
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <PromptDropdown
                          builtIns={prompts?.built_ins || []}
                          customPrompts={prompts?.custom || []}
                          selectedPromptId={effectiveSelectedPromptId}
                          hasUnsavedChanges={hasUnsavedChanges}
                          onSelectPrompt={handleSelectPrompt}
                          onClearSelection={handleClearSelection}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handleClearSelection}
                        title="Clear selection"
                        className="p-1 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-800/80 text-zinc-500 dark:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400"
                        aria-label="Clear prompt selection"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Content Textarea */}
                  <div className="flex-1 flex flex-col min-h-0 px-4">
                    <label
                      htmlFor="prompt-content"
                      className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2 flex items-center gap-2"
                    >
                      <span>Content</span>
                      <button
                        type="button"
                        onClick={handleClearContent}
                        title="Revert changes"
                        className="ml-1 p-1 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-800/80 text-zinc-500 dark:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400"
                        aria-label="Revert changes"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    </label>
                    <textarea
                      id="prompt-content"
                      value={currentContent}
                      onChange={(e) => {
                        if (effectiveSelectedPromptId) {
                          handleInlineChange(e.target.value);
                        } else {
                          setNewPromptContent(e.target.value);
                          if (onEffectivePromptChange) {
                            onEffectivePromptChange(e.target.value);
                          }
                        }
                      }}
                      className="flex-1 p-4 rounded-xl resize-none focus:outline-none bg-zinc-50 dark:bg-zinc-900 border border-zinc-200/50 dark:border-zinc-800/50 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-600 scrollbar-thin scrollbar-thumb-zinc-300 dark:scrollbar-thumb-zinc-700 scrollbar-track-transparent"
                      placeholder={
                        effectiveSelectedPromptId
                          ? isBuiltIn
                            ? 'This is a built-in prompt. Your edits will be temporary and used only for the current session.'
                            : 'Edit your prompt content...'
                          : 'Enter new prompt content...'
                      }
                      readOnly={false}
                      aria-label="Prompt content"
                    />

                    {/* Unsaved changes indicator */}
                    {hasChanges && (
                      <div className="mt-2 p-2 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-700 rounded text-sm text-orange-700 dark:text-orange-300">
                        {effectiveSelectedPromptId
                          ? 'Unsaved changes will be used for new conversations.'
                          : "Click 'Save As' to create a new prompt with this content."}
                      </div>
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div className="p-4">
                    <div className="flex justify-end space-x-2">
                      <button
                        onClick={handleShowSaveAs}
                        disabled={!currentContent.trim()}
                        className="px-3 py-2 rounded-lg text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Save As
                      </button>

                      {effectiveSelectedPromptId && !isBuiltIn && (
                        <button
                          onClick={handleSavePrompt}
                          disabled={!hasChanges}
                          className="px-3 py-2 rounded-lg text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Save
                        </button>
                      )}

                      {effectiveSelectedPromptId && !isBuiltIn && (
                        <button
                          onClick={handleDeletePrompt}
                          className="px-3 py-2 rounded-lg text-sm font-medium text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Footer info */}
            <div className="px-4 pb-2 text-xs text-zinc-400 dark:text-zinc-500">
              {effectiveSelectedPromptId ? (
                <span>Active prompt will be used for new messages</span>
              ) : (
                <span>No active prompt selected</span>
              )}
            </div>
          </div>
        )}
      </aside>

      {/* Unsaved Changes Modal */}
      <UnsavedChangesModal
        isOpen={showUnsavedModal}
        promptName={selectedPrompt?.name || ''}
        inlineContent={
          effectiveSelectedPromptId ? inlineEdits[effectiveSelectedPromptId] || '' : ''
        }
        onDiscard={handleUnsavedDiscard}
        onSave={handleUnsavedSave}
        onSaveAsNew={handleUnsavedSaveAsNew}
        onCancel={handleUnsavedCancel}
      />

      {/* Save As Modal */}
      <SaveAsModal
        isOpen={showSaveAsModal}
        initialName={saveAsInitialName}
        content={currentContent}
        existingNames={existingNames}
        onSave={handleSaveAsModalSave}
        onCancel={handleSaveAsModalCancel}
      />
    </>
  );
}
