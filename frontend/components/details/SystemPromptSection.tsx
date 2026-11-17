import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Ellipsis, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  useSystemPrompts,
  type BuiltInPrompt,
  type CustomPrompt,
} from '../../hooks/useSystemPrompts';
import SaveAsModal from '../../app/components/promptManager/SaveAsModal';
import UnsavedChangesModal from '../../app/components/promptManager/UnsavedChangesModal';
import { Button, iconButtonClasses } from '../ui/Button';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../ui/Menu';
import { DetailsSection } from './DetailsSection';
import { PromptEditor } from './PromptEditor';
import { PromptRadioList, type PromptRadioItem } from './PromptRadioList';
import { ConfirmDialog } from './ConfirmDialog';

export interface SystemPromptSectionProps {
  open: boolean;
  onToggle: () => void;
  userId?: string;
  conversationId?: string;
  onEffectivePromptChange?: (content: string) => void;
  onActivePromptIdChange?: (promptId: string | null | undefined) => void;
  /** Active system prompt ID from the loaded conversation. */
  conversationActivePromptId?: string | null | undefined;
  conversationSystemPrompt?: string | null;
}

/** Built-ins by `order`, then custom prompts most recently used first. */
export function sortPrompts(builtIns: BuiltInPrompt[], custom: CustomPrompt[]) {
  const sortedBuiltIns = [...builtIns].sort((a, b) => a.order - b.order);
  const sortedCustom = [...custom].sort((a, b) => {
    if (!a.last_used_at && !b.last_used_at) {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    }
    if (!a.last_used_at) return 1;
    if (!b.last_used_at) return -1;
    return new Date(b.last_used_at).getTime() - new Date(a.last_used_at).getTime();
  });
  return { sortedBuiltIns, sortedCustom };
}

/**
 * System prompt picker and inline editor. Always mounted (even while the
 * section or panel is collapsed) because it reports the effective prompt to
 * the chat.
 */
export function SystemPromptSection({
  open,
  onToggle,
  userId,
  conversationId,
  onEffectivePromptChange,
  onActivePromptIdChange,
  conversationActivePromptId,
  conversationSystemPrompt,
}: SystemPromptSectionProps) {
  const {
    prompts,
    loading,
    error,
    activePromptId,
    setActivePromptId,
    hasUnsavedChanges,
    createPrompt,
    deletePrompt,
    duplicatePrompt,
    selectPrompt,
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
  const pendingActionRef = useRef<(() => void) | null>(null);
  const [showSaveAsModal, setShowSaveAsModal] = useState(false);
  const [saveAsInitialName, setSaveAsInitialName] = useState('');
  const [newPromptContent, setNewPromptContent] = useState('');
  // Which prompt is open in the editor; NEW_DRAFT is the "+ New prompt" draft.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CustomPrompt | null>(null);
  const [deleting, setDeleting] = useState(false);

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

    if (effectiveSelectedPromptId) {
      onEffectivePromptChange(getEffectivePromptContent(effectiveSelectedPromptId));
      return;
    }

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

  const handleSelectPrompt = (promptId: string) => {
    setEditingId(null);
    if (!conversationId) {
      // New chats apply the prompt when the first message is sent.
      setSelectedPromptId(promptId);
      setNewPromptContent('');
      onEffectivePromptChange?.(getEffectivePromptContent(promptId));
      onActivePromptIdChange?.(promptId);
      return;
    }

    setSelectedPromptId(promptId);
    setNewPromptContent('');
    setActivePromptId(promptId);
    onActivePromptIdChange?.(promptId);
  };

  const handleClearSelection = () => {
    setEditingId(null);
    setSelectedPromptId(null);
    setNewPromptContent('');
    if (conversationId) {
      setActivePromptId(null);
    }
    // Explicitly clear the effective prompt to prevent stale content from being used
    onEffectivePromptChange?.('');
    onActivePromptIdChange?.(null);
  };

  /** Run a selection change, asking first when the current prompt has unsaved edits. */
  const guardSwitch = (action: () => void) => {
    if (effectiveSelectedPromptId && hasUnsavedChanges(effectiveSelectedPromptId)) {
      pendingActionRef.current = action;
      setShowUnsavedModal(true);
      return;
    }
    action();
  };

  const handleRadioSelect = (id: string | null) => {
    if (id === effectiveSelectedPromptId) return;
    guardSwitch(() => (id ? handleSelectPrompt(id) : handleClearSelection()));
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
    onEffectivePromptChange?.(content);
  };

  const handleNewContentChange = (value: string) => {
    setNewPromptContent(value);
    onEffectivePromptChange?.(value);
  };

  // Text a new-prompt draft falls back to: the conversation's own prompt, or nothing.
  const baseInlineContent = conversationId ? (conversationSystemPrompt ?? '') : '';

  /** Revert restores the saved prompt body (or the draft's base text) and leaves edit mode. */
  const handleRevert = () => {
    if (effectiveSelectedPromptId) {
      const prompt = getPromptById(effectiveSelectedPromptId);
      discardInlineEdit(effectiveSelectedPromptId);
      onEffectivePromptChange?.(prompt?.body ?? '');
    } else {
      setNewPromptContent(baseInlineContent);
      onEffectivePromptChange?.(baseInlineContent);
    }
    setEditingId(null);
  };

  const handleSavePrompt = async () => {
    if (!effectiveSelectedPromptId) return;
    const success = await saveInlineEdit(effectiveSelectedPromptId);
    if (success) setEditingId(null);
  };

  const handleSaveAsPrompt = async (name: string) => {
    const content = effectiveSelectedPromptId
      ? getEffectivePromptContent(effectiveSelectedPromptId)
      : newPromptContent;

    if (!content.trim()) return false;

    const newPrompt = await createPrompt({ name, body: content });
    if (!newPrompt) return false;

    if (effectiveSelectedPromptId) {
      clearInlineEdit(effectiveSelectedPromptId);
    } else {
      setNewPromptContent('');
    }
    setSelectedPromptId(newPrompt.id);
    setEditingId(null);
    let selectionApplied = true;
    if (conversationId) {
      selectionApplied = await selectPrompt(newPrompt.id, conversationId);
    }
    if (selectionApplied) {
      onActivePromptIdChange?.(newPrompt.id);
    }
    return true;
  };

  const handleShowSaveAs = () => {
    const prompt = effectiveSelectedPromptId ? getPromptById(effectiveSelectedPromptId) : null;
    setSaveAsInitialName(prompt ? `${prompt.name} (Copy)` : 'New Prompt');
    setShowSaveAsModal(true);
  };

  const handleSaveAsModalSave = async (name: string) => {
    const success = await handleSaveAsPrompt(name);
    if (success) setShowSaveAsModal(false);
    return success;
  };

  const runPendingAction = () => {
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    action?.();
  };

  const handleUnsavedDiscard = () => {
    if (effectiveSelectedPromptId) discardInlineEdit(effectiveSelectedPromptId);
    setShowUnsavedModal(false);
    runPendingAction();
  };

  const handleUnsavedSave = async () => {
    if (!effectiveSelectedPromptId) return;
    const success = await saveInlineEdit(effectiveSelectedPromptId);
    if (success) {
      setShowUnsavedModal(false);
      runPendingAction();
    }
  };

  const handleUnsavedSaveAsNew = async () => {
    if (!effectiveSelectedPromptId) return;
    const prompt = getPromptById(effectiveSelectedPromptId);
    const inlineContent = inlineEdits[effectiveSelectedPromptId];
    if (!prompt || !inlineContent) return;

    const newPrompt = await createPrompt({ name: `${prompt.name} (Copy)`, body: inlineContent });
    if (newPrompt) {
      discardInlineEdit(effectiveSelectedPromptId);
      setShowUnsavedModal(false);
      runPendingAction();
    }
  };

  const handleUnsavedCancel = () => {
    setShowUnsavedModal(false);
    pendingActionRef.current = null;
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const success = await deletePrompt(deleteTarget.id);
    setDeleting(false);
    if (success && deleteTarget.id === effectiveSelectedPromptId) {
      setSelectedPromptId(null);
      setEditingId(null);
      onEffectivePromptChange?.('');
    }
    setDeleteTarget(null);
  };

  const handleStartNewPrompt = () => {
    guardSwitch(() => {
      if (effectiveSelectedPromptId) handleClearSelection();
      setEditingId(NEW_DRAFT);
    });
  };

  const { sortedBuiltIns, sortedCustom } = useMemo(
    () => sortPrompts(prompts?.built_ins ?? [], prompts?.custom ?? []),
    [prompts]
  );

  const selectedPrompt = effectiveSelectedPromptId
    ? getPromptById(effectiveSelectedPromptId)
    : null;
  const isBuiltIn = Boolean(selectedPrompt && 'read_only' in selectedPrompt);
  const showDraft = !selectedPrompt && (editingId === NEW_DRAFT || newPromptContent.length > 0);
  const draftHasChanges = conversationId
    ? newPromptContent !== baseInlineContent
    : newPromptContent.length > 0;
  // None is checked unless a saved prompt is selected or a custom draft is in effect.
  const checkedId = selectedPrompt ? selectedPrompt.id : showDraft ? undefined : null;

  const items: PromptRadioItem[] = [
    { id: null, name: 'None' },
    ...sortedBuiltIns.map((p) => ({
      id: p.id,
      name: p.name,
      builtIn: true,
      edited: hasUnsavedChanges(p.id),
    })),
    ...sortedCustom.map((p) => ({ id: p.id, name: p.name, edited: hasUnsavedChanges(p.id) })),
  ];

  const existingNames = [...sortedBuiltIns, ...sortedCustom].map((p) => p.name);
  const saveAsContent = effectiveSelectedPromptId
    ? getEffectivePromptContent(effectiveSelectedPromptId)
    : newPromptContent;

  const renderExpanded = (item: PromptRadioItem) => {
    if (!item.id || !selectedPrompt) return null;
    const content = getEffectivePromptContent(item.id);
    if (editingId === item.id) {
      return (
        <PromptEditor
          id="prompt-content"
          value={content}
          onChange={handleInlineChange}
          note={isBuiltIn ? 'Built-in · edits apply to this chat only' : 'Applies to new messages'}
          canSave={!isBuiltIn}
          hasChanges={hasUnsavedChanges(item.id)}
          onRevert={handleRevert}
          onSaveAsNew={handleShowSaveAs}
          onSave={handleSavePrompt}
          onClose={() => setEditingId(null)}
          autoFocus
        />
      );
    }
    return (
      <div className="flex flex-col gap-2 pl-6">
        {content ? (
          <p className="line-clamp-3 text-xs whitespace-pre-line text-fg-muted">{content}</p>
        ) : null}
        <div className="flex items-center gap-1">
          <Button variant="secondary" size="sm" onClick={() => setEditingId(item.id)}>
            <Pencil />
            Edit
          </Button>
          <span className="flex-1" />
          <Menu>
            <MenuTrigger
              aria-label={`More actions for ${item.name}`}
              className={iconButtonClasses({ size: 'sm' })}
            >
              <Ellipsis />
            </MenuTrigger>
            <MenuContent>
              <MenuItem onClick={() => void duplicatePrompt(selectedPrompt.id)}>
                <Copy />
                Duplicate
              </MenuItem>
              {!isBuiltIn ? (
                <MenuItem
                  tone="danger"
                  onClick={() => setDeleteTarget(selectedPrompt as CustomPrompt)}
                >
                  <Trash2 />
                  Delete
                </MenuItem>
              ) : null}
            </MenuContent>
          </Menu>
        </div>
      </div>
    );
  };

  const footer = showDraft ? (
    <div className="flex flex-col gap-2 rounded-control border border-line bg-surface p-2">
      <span className="px-1 text-sm text-fg">
        {editingId === NEW_DRAFT || !conversationId ? 'New prompt' : 'Custom prompt'}
      </span>
      <PromptEditor
        id="prompt-content"
        value={newPromptContent}
        onChange={handleNewContentChange}
        note="Applies to new messages"
        canSave={false}
        hasChanges={draftHasChanges}
        onRevert={handleRevert}
        onSaveAsNew={handleShowSaveAs}
        onClose={() => setEditingId(null)}
        autoFocus={editingId === NEW_DRAFT}
      />
    </div>
  ) : (
    <button
      type="button"
      onClick={handleStartNewPrompt}
      className="flex items-center gap-3 rounded-control p-2 text-left text-sm text-fg-muted transition-colors hover:bg-muted hover:text-fg focus-ring touch-target"
    >
      <Plus aria-hidden="true" className="size-4" />
      New prompt
    </button>
  );

  return (
    <>
      <DetailsSection
        title="System prompt"
        open={open}
        onToggle={onToggle}
        summary={selectedPrompt?.name ?? (showDraft ? 'Custom' : 'None')}
      >
        {loading && !prompts ? (
          <p className="px-1 py-4 text-sm text-fg-muted">Loading prompts...</p>
        ) : (
          <>
            {(error || prompts?.error) && (
              <div
                className="mt-1 rounded-control bg-warning-subtle px-3 py-2 text-sm text-warning"
                role="status"
                aria-live="polite"
              >
                {error || prompts?.error}
              </div>
            )}
            <PromptRadioList
              items={items}
              checkedId={checkedId}
              onSelect={handleRadioSelect}
              renderExpanded={renderExpanded}
              footer={footer}
            />
          </>
        )}
      </DetailsSection>

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

      <SaveAsModal
        isOpen={showSaveAsModal}
        initialName={saveAsInitialName}
        content={saveAsContent}
        existingNames={existingNames}
        onSave={handleSaveAsModalSave}
        onCancel={() => setShowSaveAsModal(false)}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete prompt?"
        description={
          <>&ldquo;{deleteTarget?.name}&rdquo; will be deleted. This can&rsquo;t be undone.</>
        }
        confirmLabel="Delete"
        busy={deleting}
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}

const NEW_DRAFT = '__new__';
