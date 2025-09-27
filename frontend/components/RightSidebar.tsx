import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useSystemPrompts } from '../hooks/useSystemPrompts';
import PromptList from '../app/components/promptManager/PromptList';
import PromptEditor from '../app/components/promptManager/PromptEditor';
import UnsavedChangesModal from '../app/components/promptManager/UnsavedChangesModal';

interface RightSidebarProps {
  userId?: string;
  conversationId?: string;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onEffectivePromptChange?: (content: string) => void;
}

export function RightSidebar({
  userId,
  conversationId,
  collapsed = false,
  onToggleCollapse,
  onEffectivePromptChange
}: RightSidebarProps) {
  const {
    prompts,
    loading,
    error,
    activePromptId,
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

  const [currentView, setCurrentView] = useState<'list' | 'editor'>('list');
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [showUnsavedModal, setShowUnsavedModal] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  // Notify parent of effective prompt content changes
  useEffect(() => {
    if (activePromptId && onEffectivePromptChange) {
      const content = getEffectivePromptContent(activePromptId);
      onEffectivePromptChange(content);
    } else if (!activePromptId && onEffectivePromptChange) {
      onEffectivePromptChange('');
    }
  }, [activePromptId, inlineEdits, onEffectivePromptChange, getEffectivePromptContent]);

  const handleSelectPrompt = async (promptId: string) => {
    if (!conversationId) return;

    const success = await selectPrompt(promptId, conversationId);
    if (success) {
      setSelectedPromptId(promptId);
      setCurrentView('editor');
    }
  };

  const handleClearSelection = async () => {
    if (!conversationId) return;

    await clearPrompt(conversationId);
    setSelectedPromptId(null);
    setCurrentView('list');
  };

  const handleEditPrompt = (promptId: string) => {
    setSelectedPromptId(promptId);
    setIsEditing(true);
    setCurrentView('editor');
  };

  const handleSavePrompt = async (updates: { name?: string; body?: string }) => {
    if (!selectedPromptId) return false;

    const success = await updatePrompt(selectedPromptId, updates);
    if (success) {
      setIsEditing(false);
      return true;
    }
    return false;
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
  };

  const handleInlineChange = (content: string) => {
    if (!selectedPromptId) return;

    const prompt = getPromptById(selectedPromptId);
    if (!prompt) return;

    // Clear inline edit if content matches original
    if (content === prompt.body) {
      clearInlineEdit(selectedPromptId);
    } else {
      setInlineEdit(selectedPromptId, content);
    }
  };

  const handleToggleEdit = () => {
    setIsEditing(!isEditing);
  };

  const handleDuplicate = async (promptId: string) => {
    const newPrompt = await duplicatePrompt(promptId);
    if (newPrompt && conversationId) {
      await selectPrompt(newPrompt.id, conversationId);
      setSelectedPromptId(newPrompt.id);
      setCurrentView('editor');
    }
  };

  const handleDelete = async (promptId: string) => {
    const success = await deletePrompt(promptId);
    if (success && selectedPromptId === promptId) {
      setSelectedPromptId(null);
      setCurrentView('list');
    }
  };

  const checkUnsavedChanges = (action: () => void) => {
    if (selectedPromptId && hasUnsavedChanges(selectedPromptId)) {
      setPendingAction(() => action);
      setShowUnsavedModal(true);
    } else {
      action();
    }
  };

  const handleUnsavedDiscard = () => {
    if (selectedPromptId) {
      discardInlineEdit(selectedPromptId);
    }
    setShowUnsavedModal(false);
    if (pendingAction) {
      pendingAction();
      setPendingAction(null);
    }
  };

  const handleUnsavedSave = async () => {
    if (selectedPromptId) {
      const success = await saveInlineEdit(selectedPromptId);
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
    if (selectedPromptId) {
      const prompt = getPromptById(selectedPromptId);
      const inlineContent = inlineEdits[selectedPromptId];

      if (prompt && inlineContent) {
        const newPrompt = await createPrompt({
          name: `${prompt.name} (Copy)`,
          body: inlineContent
        });

        if (newPrompt) {
          discardInlineEdit(selectedPromptId);
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

  const selectedPrompt = selectedPromptId ? getPromptById(selectedPromptId) : null;
  const inlineContent = selectedPromptId ? inlineEdits[selectedPromptId] : undefined;

  return (
    <>
      <aside className={`${collapsed ? 'w-16' : 'w-80'} z-30 flex flex-col bg-white/60 dark:bg-neutral-900/60 backdrop-blur-sm transition-all duration-300 ease-in-out relative border-l border-gray-200 dark:border-gray-700`}>
        {/* Collapse/Expand Button */}
        <button
          className="absolute -left-3 top-6 z-10 w-6 h-6 rounded-full bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-700 shadow-sm hover:shadow-md transition-all duration-200 flex items-center justify-center text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
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
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                  System Prompts
                </h2>
                {currentView === 'editor' && (
                  <button
                    onClick={() => checkUnsavedChanges(() => setCurrentView('list'))}
                    className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    ← Back to List
                  </button>
                )}
              </div>

              {currentView === 'list' && (
                <button
                  onClick={() => {
                    createPrompt({ name: 'New Prompt', body: 'You are a helpful assistant.' })
                      .then(newPrompt => {
                        if (newPrompt) {
                          setSelectedPromptId(newPrompt.id);
                          setIsEditing(true);
                          setCurrentView('editor');
                        }
                      });
                  }}
                  className="mt-2 w-full px-3 py-2 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  + New Prompt
                </button>
              )}
            </div>

            {/* Content */}
            <div className="flex-1 min-h-0">
              {loading && !prompts ? (
                <div className="p-4 text-center text-gray-500 dark:text-gray-400">
                  Loading prompts...
                </div>
              ) : currentView === 'list' ? (
                <div className="h-full overflow-y-auto p-4">
                  <PromptList
                    builtIns={prompts?.built_ins || []}
                    customPrompts={prompts?.custom || []}
                    activePromptId={activePromptId}
                    hasUnsavedChanges={hasUnsavedChanges}
                    onSelectPrompt={handleSelectPrompt}
                    onEditPrompt={handleEditPrompt}
                    onDuplicatePrompt={handleDuplicate}
                    onDeletePrompt={handleDelete}
                    onClearSelection={handleClearSelection}
                    error={error || prompts?.error}
                  />
                </div>
              ) : (
                <PromptEditor
                  prompt={selectedPrompt}
                  isEditing={isEditing}
                  inlineContent={inlineContent}
                  onSave={handleSavePrompt}
                  onCancel={handleCancelEdit}
                  onInlineChange={handleInlineChange}
                  onToggleEdit={handleToggleEdit}
                />
              )}
            </div>

            {/* Footer info */}
            <div className="p-3 border-t border-gray-200 dark:border-gray-700 text-xs text-slate-500 dark:text-slate-400">
              {activePromptId ? (
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
        inlineContent={selectedPromptId ? inlineEdits[selectedPromptId] || '' : ''}
        onDiscard={handleUnsavedDiscard}
        onSave={handleUnsavedSave}
        onSaveAsNew={handleUnsavedSaveAsNew}
        onCancel={handleUnsavedCancel}
      />
    </>
  );
}
