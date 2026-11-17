import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, RotateCcw, X } from 'lucide-react';
import { useSystemPrompts } from '../hooks/useSystemPrompts';
import PromptDropdown from '../app/components/promptManager/PromptDropdown';
import SaveAsModal from '../app/components/promptManager/SaveAsModal';
import UnsavedChangesModal from '../app/components/promptManager/UnsavedChangesModal';
import { Button, IconButton } from './ui/Button';
import { Textarea } from './ui/Input';
import { cn } from '../lib/cn';

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
    }
  }, [conversationActivePromptId, setActivePromptId]);

  // Update selected prompt and content when conversation ID changes
  useEffect(() => {
    if (conversationActivePromptId !== undefined && conversationId) {
      const timer = setTimeout(() => {
        setSelectedPromptId(conversationActivePromptId ?? null);
        if (conversationActivePromptId) {
          setNewPromptContent('');
        } else if (typeof conversationSystemPrompt === 'string') {
          setNewPromptContent(conversationSystemPrompt);
        } else {
          setNewPromptContent('');
        }
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [conversationActivePromptId, conversationSystemPrompt, conversationId]);

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
  const computedWidth = `${collapsed ? collapsedWidth : width}px`;
  // The main save action is "Save" for an editable saved prompt, otherwise "Save As".
  const canSaveInPlace = Boolean(effectiveSelectedPromptId && !isBuiltIn);

  const handleContentChange = (value: string) => {
    if (effectiveSelectedPromptId) {
      handleInlineChange(value);
    } else {
      setNewPromptContent(value);
      if (onEffectivePromptChange) {
        onEffectivePromptChange(value);
      }
    }
  };

  return (
    <>
      <aside
        aria-label="System prompts"
        style={{
          width: computedWidth,
          minWidth: computedWidth,
          flexShrink: 0,
          transition: isResizing ? 'none' : 'width 0.3s ease-in-out',
          willChange: isResizing ? 'width' : undefined,
        }}
        className={cn(
          'relative z-30 flex h-full flex-col border-l border-line bg-canvas-subtle',
          collapsed ? 'items-center gap-2 px-2 py-3' : 'gap-4 p-3'
        )}
      >
        {collapsed ? (
          // Expand button - Desktop only
          <IconButton
            label="Expand sidebar"
            title="Expand sidebar"
            onClick={onToggleCollapse}
            className="hidden md:inline-flex"
          >
            <ChevronLeft />
          </IconButton>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 pl-1">
              <h2 className="text-sm font-medium text-fg">System Prompts</h2>
              {/* Collapse button - Desktop only */}
              <IconButton
                label="Collapse sidebar"
                title="Collapse sidebar"
                size="sm"
                onClick={onToggleCollapse}
                className="hidden md:inline-flex"
              >
                <ChevronRight />
              </IconButton>
            </div>

            {loading && !prompts ? (
              <p className="flex-1 px-4 py-8 text-center text-sm text-fg-muted">
                Loading prompts...
              </p>
            ) : (
              <>
                {(error || prompts?.error) && (
                  <div
                    className="rounded-control bg-warning-subtle px-3 py-2 text-sm text-warning"
                    role="status"
                    aria-live="polite"
                  >
                    {error || prompts?.error}
                  </div>
                )}

                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <PromptDropdown
                        builtIns={prompts?.built_ins || []}
                        customPrompts={prompts?.custom || []}
                        selectedPromptId={effectiveSelectedPromptId}
                        hasUnsavedChanges={hasUnsavedChanges}
                        onSelectPrompt={handleSelectPrompt}
                        onClearSelection={handleClearSelection}
                      />
                    </div>
                    <IconButton
                      label="Clear prompt selection"
                      title="Clear selection"
                      onClick={handleClearSelection}
                      disabled={!effectiveSelectedPromptId && !currentContent}
                    >
                      <X />
                    </IconButton>
                  </div>
                  <p className="pl-1 text-xs text-fg-subtle">
                    {effectiveSelectedPromptId
                      ? 'Active prompt will be used for new messages'
                      : 'No active prompt selected'}
                  </p>
                </div>

                <div className="flex min-h-0 flex-1 flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor="prompt-content" className="pl-1 text-sm text-fg-muted">
                      Content
                    </label>
                    <IconButton
                      label="Revert changes"
                      title="Revert changes"
                      size="sm"
                      onClick={handleClearContent}
                    >
                      <RotateCcw />
                    </IconButton>
                  </div>
                  <Textarea
                    id="prompt-content"
                    aria-label="Prompt content"
                    value={currentContent}
                    onChange={(e) => handleContentChange(e.target.value)}
                    className="scrollbar-thin min-h-0 flex-1 resize-none"
                    placeholder={
                      effectiveSelectedPromptId
                        ? isBuiltIn
                          ? 'This is a built-in prompt. Your edits will be temporary and used only for the current session.'
                          : 'Edit your prompt content...'
                        : 'Enter new prompt content...'
                    }
                  />

                  {hasChanges && (
                    <p className="flex items-center gap-2 pl-1 text-xs text-fg-muted">
                      <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-accent" />
                      {effectiveSelectedPromptId
                        ? 'Unsaved changes will be used for new conversations.'
                        : "Click 'Save As' to create a new prompt with this content."}
                    </p>
                  )}
                </div>

                <div className="flex justify-end gap-2">
                  {canSaveInPlace && (
                    <Button
                      variant="ghost"
                      onClick={handleDeletePrompt}
                      className="mr-auto text-danger hover:text-danger"
                    >
                      Delete
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    onClick={handleShowSaveAs}
                    disabled={!currentContent.trim()}
                  >
                    Save As
                  </Button>
                  {canSaveInPlace && (
                    <Button variant="secondary" onClick={handleSavePrompt} disabled={!hasChanges}>
                      Save
                    </Button>
                  )}
                </div>
              </>
            )}
          </>
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
