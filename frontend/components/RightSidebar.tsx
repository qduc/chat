import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
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
  onActivePromptIdChange?: (promptId: string | null) => void;
  // Active system prompt ID from loaded conversation
  conversationActivePromptId?: string | null;
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
  isResizing = false
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
    inlineEdits
  } = useSystemPrompts(userId);

  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
  const [showUnsavedModal, setShowUnsavedModal] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [showSaveAsModal, setShowSaveAsModal] = useState(false);
  const [saveAsInitialName, setSaveAsInitialName] = useState('');
  const [newPromptContent, setNewPromptContent] = useState('');
  const effectiveSelectedPromptId = conversationId ? activePromptId : selectedPromptId;

  // Notify parent of effective prompt content changes
  useEffect(() => {
    if (!onEffectivePromptChange) return;

    if (activePromptId) {
      const content = getEffectivePromptContent(activePromptId);
      onEffectivePromptChange(content);
      return;
    }

    if (typeof conversationSystemPrompt === 'string' && conversationSystemPrompt.length > 0) {
      onEffectivePromptChange(conversationSystemPrompt);
      return;
    }

    onEffectivePromptChange('');
  }, [
    activePromptId,
    inlineEdits,
    onEffectivePromptChange,
    getEffectivePromptContent,
    conversationSystemPrompt
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
  }, [
    conversationActivePromptId,
    conversationSystemPrompt,
    conversationId,
    setActivePromptId
  ]);

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

    const success = await selectPrompt(promptId, conversationId);
    if (success) {
      setSelectedPromptId(promptId);
      setNewPromptContent(''); // Clear new prompt content
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

    await clearPrompt(conversationId);
    setSelectedPromptId(null);
    setNewPromptContent(''); // Clear new prompt content

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
    const prompt = effectiveSelectedPromptId ? getPromptById(effectiveSelectedPromptId) : null;
    const content = effectiveSelectedPromptId
      ? getEffectivePromptContent(effectiveSelectedPromptId)
      : newPromptContent;

    if (!content.trim()) return false;

    const newPrompt = await createPrompt({
      name,
      body: content
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
      if (conversationId) {
        await selectPrompt(newPrompt.id, conversationId);
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

  const checkUnsavedChanges = (action: () => void) => {
    if (effectiveSelectedPromptId && hasUnsavedChanges(effectiveSelectedPromptId)) {
      setPendingAction(() => action);
      setShowUnsavedModal(true);
    } else {
      action();
    }
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
          body: inlineContent
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
      handleInlineChange("");
    } else {
      setNewPromptContent("");
      if (onEffectivePromptChange) {
        onEffectivePromptChange("");
      }
    }
  };

  const selectedPrompt = effectiveSelectedPromptId ? getPromptById(effectiveSelectedPromptId) : null;
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
  const existingNames = prompts ? [...prompts.built_ins.map(p => p.name), ...prompts.custom.map(p => p.name)] : [];
  const computedWidth = collapsed ? collapsedWidth : width;

  return (
    <>
      <aside
        style={{
          width: `${computedWidth}px`,
          minWidth: `${computedWidth}px`,
          flexShrink: 0,
          transition: isResizing ? 'none' : 'width 0.3s ease-in-out',
          willChange: isResizing ? 'width' : undefined
        }}
        className={`z-30 flex flex-col bg-white/95 dark:bg-neutral-900/95 relative border-l border-gray-200 dark:border-gray-700`}
      >
        {/* Collapse/Expand Button */}
        <button
          className="absolute -left-3 top-6 z-40 w-6 h-6 rounded-full bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-700 shadow-sm hover:shadow-md transition-all duration-200 flex items-center justify-center text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
          onClick={onToggleCollapse}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronLeft className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </button>

        {collapsed ? (
          // Collapsed state - minimal UI
          <div className="flex flex-col items-center space-y-4 p-4">
            <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-neutral-800 border border-slate-200 dark:border-slate-100 text-slate-700 dark:text-slate-300 flex items-center justify-center">
              <span className="text-xs font-semibold">SP</span>
            </div>
          </div>
        ) : (
          // Expanded state - full prompt manager UI
          <div className="flex flex-col h-full">
            {/* Header */}
            <div className="p-4 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                System Prompts
              </h2>
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
                    <PromptDropdown
                      builtIns={prompts?.built_ins || []}
                      customPrompts={prompts?.custom || []}
                      selectedPromptId={effectiveSelectedPromptId}
                      hasUnsavedChanges={hasUnsavedChanges}
                      onSelectPrompt={handleSelectPrompt}
                      onClearSelection={handleClearSelection}
                    />
                  </div>

                  {/* Content Textarea */}
                  <div className="flex-1 flex flex-col min-h-0 px-4">
                    <label
                      htmlFor="prompt-content"
                      className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-2"
                    >
                      <span>Content</span>
                      <button
                        type="button"
                        onClick={handleClearContent}
                        title="Clear content"
                        className="ml-1 p-1 rounded hover:bg-gray-200 dark:hover:bg-neutral-700/40 text-gray-500 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400"
                        aria-label="Clear content"
                      >
                        <Trash2 className="w-4 h-4" />
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
                      className="flex-1 p-3 border border-gray-300 dark:border-gray-600 rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                      placeholder={effectiveSelectedPromptId
                        ? (isBuiltIn
                          ? "This is a built-in prompt. Your edits will be temporary and used only for the current session."
                          : "Edit your prompt content...")
                        : "Enter new prompt content..."}
                      readOnly={false}
                      aria-label="Prompt content"
                    />

                    {/* Unsaved changes indicator */}
                    {hasChanges && (
                      <div className="mt-2 p-2 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-700 rounded text-sm text-orange-700 dark:text-orange-300">
                        {effectiveSelectedPromptId
                          ? "Unsaved changes will be used for new conversations."
                          : "Click 'Save As' to create a new prompt with this content."}
                      </div>
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div className="p-4 border-t border-gray-200 dark:border-gray-700">
                    <div className="flex justify-end space-x-2">
                      <button
                        onClick={handleShowSaveAs}
                        disabled={!currentContent.trim()}
                        className="px-3 py-2 text-sm bg-gray-500 text-white rounded hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-500 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Save As
                      </button>

                      {effectiveSelectedPromptId && !isBuiltIn && (
                        <button
                          onClick={handleSavePrompt}
                          disabled={!hasChanges}
                          className="px-3 py-2 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Save
                        </button>
                      )}

                      {effectiveSelectedPromptId && !isBuiltIn && (
                        <button
                          onClick={handleDeletePrompt}
                          className="px-3 py-2 text-sm bg-red-500 text-white rounded hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-500"
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
            <div className="p-3 border-t border-gray-200 dark:border-gray-700 text-xs text-slate-500 dark:text-slate-400">
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
        inlineContent={effectiveSelectedPromptId ? inlineEdits[effectiveSelectedPromptId] || '' : ''}
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
