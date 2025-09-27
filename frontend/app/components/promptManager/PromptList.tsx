import React from 'react';
import { BuiltInPrompt, CustomPrompt } from '../../../hooks/useSystemPrompts';

// Simple chevron icons as inline SVG
const ChevronDownIcon = ({ className }: { className: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m19 9-7 7-7-7" />
  </svg>
);

const ChevronRightIcon = ({ className }: { className: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m9 5 7 7-7 7" />
  </svg>
);

interface PromptListProps {
  builtIns: BuiltInPrompt[];
  customPrompts: CustomPrompt[];
  activePromptId: string | null;
  hasUnsavedChanges: (promptId: string) => boolean;
  onSelectPrompt: (promptId: string) => void;
  onEditPrompt: (promptId: string) => void;
  onDuplicatePrompt: (promptId: string) => void;
  onDeletePrompt: (promptId: string) => void;
  onClearSelection: () => void;
  error?: string | null;
}

interface PromptSectionProps {
  title: string;
  prompts: (BuiltInPrompt | CustomPrompt)[];
  isExpanded: boolean;
  onToggleExpanded: () => void;
  activePromptId: string | null;
  hasUnsavedChanges: (promptId: string) => boolean;
  onSelectPrompt: (promptId: string) => void;
  onEditPrompt: (promptId: string) => void;
  onDuplicatePrompt: (promptId: string) => void;
  onDeletePrompt: (promptId: string) => void;
  showEditActions: boolean;
}

interface PromptItemProps {
  prompt: BuiltInPrompt | CustomPrompt;
  isActive: boolean;
  hasUnsavedChanges: boolean;
  onSelect: () => void;
  onEdit?: () => void;
  onDuplicate: () => void;
  onDelete?: () => void;
  showEditActions: boolean;
}

function PromptItem({
  prompt,
  isActive,
  hasUnsavedChanges,
  onSelect,
  onEdit,
  onDuplicate,
  onDelete,
  showEditActions
}: PromptItemProps) {
  const isBuiltIn = 'read_only' in prompt;
  const itemLabel = `${prompt.name}${hasUnsavedChanges ? ' (unsaved changes)' : ''}`;

  return (
    <div
      className={`
        flex items-center justify-between p-2 text-sm rounded cursor-pointer
        hover:bg-gray-100 dark:hover:bg-gray-700
        ${isActive ? 'bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700' : ''}
      `}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      role="button"
      tabIndex={0}
      aria-pressed={isActive}
      aria-label={`Select prompt ${itemLabel}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center">
          <span className="truncate">
            {prompt.name}
            {hasUnsavedChanges && <span className="text-orange-500 ml-1" aria-hidden="true">*</span>}
          </span>
          {isBuiltIn && (
            <span className="ml-2 px-1.5 py-0.5 text-xs bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 rounded">
              Built-in
            </span>
          )}
        </div>
        {('description' in prompt) && prompt.description && (
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">
            {prompt.description}
          </div>
        )}
        {!isBuiltIn && 'usage_count' in prompt && prompt.usage_count > 0 && (
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Used {prompt.usage_count} times
          </div>
        )}
      </div>

      {showEditActions && (
        <div className="flex items-center space-x-1 ml-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDuplicate();
            }}
            type="button"
            className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            title="Duplicate"
            aria-label={`Duplicate prompt ${prompt.name}`}
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </button>

          {!isBuiltIn && onEdit && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              type="button"
              className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              title="Edit"
              aria-label={`Edit prompt ${prompt.name}`}
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
          )}

          {!isBuiltIn && onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`Delete "${prompt.name}"?`)) {
                  onDelete();
                }
              }}
              type="button"
              className="p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400"
              title="Delete"
              aria-label={`Delete prompt ${prompt.name}`}
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function PromptSection({
  title,
  prompts,
  isExpanded,
  onToggleExpanded,
  activePromptId,
  hasUnsavedChanges,
  onSelectPrompt,
  onEditPrompt,
  onDuplicatePrompt,
  onDeletePrompt,
  showEditActions
}: PromptSectionProps) {
  const Icon = isExpanded ? ChevronDownIcon : ChevronRightIcon;
  const sectionSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'section';
  const headingId = `${sectionSlug}-heading`;
  const contentId = `${sectionSlug}-content`;

  return (
    <div className="mb-4">
      <button
        onClick={onToggleExpanded}
        type="button"
        className="flex items-center w-full p-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
        aria-expanded={isExpanded}
        aria-controls={contentId}
        id={headingId}
      >
        <Icon className="w-4 h-4 mr-2" />
        {title} ({prompts.length})
      </button>

      {isExpanded && (
        <div
          className="ml-2 space-y-1"
          id={contentId}
          role="region"
          aria-labelledby={headingId}
        >
          {prompts.length === 0 ? (
            <div className="p-2 text-sm text-gray-500 dark:text-gray-400 italic">
              No prompts in this category
            </div>
          ) : (
            prompts.map((prompt) => (
              <PromptItem
                key={prompt.id}
                prompt={prompt}
                isActive={activePromptId === prompt.id}
                hasUnsavedChanges={hasUnsavedChanges(prompt.id)}
                onSelect={() => onSelectPrompt(prompt.id)}
                onEdit={'read_only' in prompt ? undefined : () => onEditPrompt(prompt.id)}
                onDuplicate={() => onDuplicatePrompt(prompt.id)}
                onDelete={'read_only' in prompt ? undefined : () => onDeletePrompt(prompt.id)}
                showEditActions={showEditActions}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function PromptList({
  builtIns,
  customPrompts,
  activePromptId,
  hasUnsavedChanges,
  onSelectPrompt,
  onEditPrompt,
  onDuplicatePrompt,
  onDeletePrompt,
  onClearSelection,
  error
}: PromptListProps) {
  const [expandedSections, setExpandedSections] = React.useState({
    none: true,
    builtIns: true,
    custom: true
  });

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  // Sort built-ins by order, custom by last_used_at desc
  const sortedBuiltIns = [...builtIns].sort((a, b) => a.order - b.order);
  const sortedCustom = [...customPrompts].sort((a, b) => {
    if (!a.last_used_at && !b.last_used_at) {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    }
    if (!a.last_used_at) return 1;
    if (!b.last_used_at) return -1;
    return new Date(b.last_used_at).getTime() - new Date(a.last_used_at).getTime();
  });

  return (
    <div className="space-y-2">
      {error && (
        <div
          className="p-2 text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded"
          role="status"
          aria-live="polite"
        >
          ⚠️ {error}
        </div>
      )}

      {/* None option */}
      <PromptSection
        title="None"
        prompts={[]}
        isExpanded={expandedSections.none}
        onToggleExpanded={() => toggleSection('none')}
        activePromptId={activePromptId}
        hasUnsavedChanges={hasUnsavedChanges}
        onSelectPrompt={onSelectPrompt}
        onEditPrompt={onEditPrompt}
        onDuplicatePrompt={onDuplicatePrompt}
        onDeletePrompt={onDeletePrompt}
        showEditActions={false}
      />

      {expandedSections.none && (
        <div className="ml-2">
          <button
            type="button"
            className={`
              flex items-center w-full p-2 text-sm rounded cursor-pointer text-left
              hover:bg-gray-100 dark:hover:bg-gray-700
              ${!activePromptId ? 'bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700' : ''}
            `}
            onClick={onClearSelection}
            aria-pressed={!activePromptId}
            aria-label="Clear active system prompt"
          >
            <span className="text-gray-700 dark:text-gray-300">No system prompt</span>
          </button>
        </div>
      )}

      {/* Built-ins */}
      <PromptSection
        title="Built-in Prompts"
        prompts={sortedBuiltIns}
        isExpanded={expandedSections.builtIns}
        onToggleExpanded={() => toggleSection('builtIns')}
        activePromptId={activePromptId}
        hasUnsavedChanges={hasUnsavedChanges}
        onSelectPrompt={onSelectPrompt}
        onEditPrompt={onEditPrompt}
        onDuplicatePrompt={onDuplicatePrompt}
        onDeletePrompt={onDeletePrompt}
        showEditActions={true}
      />

      {/* Custom prompts */}
      <PromptSection
        title="My Prompts"
        prompts={sortedCustom}
        isExpanded={expandedSections.custom}
        onToggleExpanded={() => toggleSection('custom')}
        activePromptId={activePromptId}
        hasUnsavedChanges={hasUnsavedChanges}
        onSelectPrompt={onSelectPrompt}
        onEditPrompt={onEditPrompt}
        onDuplicatePrompt={onDuplicatePrompt}
        onDeletePrompt={onDeletePrompt}
        showEditActions={true}
      />
    </div>
  );
}