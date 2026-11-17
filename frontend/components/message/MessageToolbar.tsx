/**
 * MessageToolbar - Action buttons for messages
 * Copy, Edit, Fork, Retry buttons with tooltip feedback
 */

import React from 'react';
import { Code, Copy, Edit2, GitFork, RefreshCw } from 'lucide-react';
import { IconButton } from '../ui/Button';
import { cn } from '../../lib/cn';

/** Compact toolbar button: 28px on fine pointers, 44px touch target on coarse ones. */
const toolbarButtonClasses = 'size-7';

function CopyButton({ isCopied, onClick }: { isCopied: boolean; onClick: () => void }) {
  return (
    <div className="relative">
      <IconButton label="Copy" title="Copy" onClick={onClick} className={toolbarButtonClasses}>
        <Copy />
      </IconButton>
      {isCopied && (
        <div
          role="status"
          className="absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 rounded-control bg-primary px-2 py-1 text-xs whitespace-nowrap text-on-primary"
        >
          Copied
        </div>
      )}
    </div>
  );
}

interface MessageToolbarProps {
  messageId: string;
  modelId: string;
  hasContent: boolean;
  copiedMessageId: string | null;
  actionsDisabled: boolean;
  isStreaming: boolean;
  hasComparison: boolean;
  isUser: boolean;
  onCopy: (messageId: string, text: string) => void;
  onFork?: (messageId: string, modelId: string) => void;
  onEdit?: (messageId: string, text: string) => void;
  onRetry?: (messageId: string) => void;
  onRetryModel?: (messageId: string, modelId: string) => void;
  onToggleRaw?: () => void;
  isRaw?: boolean;
  contentText: string;
  variant?: 'user' | 'assistant';
  toolbarRef?: React.RefObject<HTMLDivElement | null>;
  revisionNavigation?: React.ReactNode;
}

export function MessageToolbar({
  messageId,
  modelId,
  hasContent,
  copiedMessageId,
  actionsDisabled,
  isStreaming,
  hasComparison,
  isUser,
  onCopy,
  onFork,
  onEdit,
  onRetry,
  onRetryModel,
  onToggleRaw,
  isRaw = false,
  contentText,
  variant = 'assistant',
  toolbarRef,
  revisionNavigation,
}: MessageToolbarProps) {
  const copyId = variant === 'user' ? messageId : `${messageId}-${modelId}`;
  const isCopied = copiedMessageId === copyId;

  if (variant === 'user') {
    return (
      <div className="mt-1 flex items-center justify-end gap-2" ref={toolbarRef}>
        {/* Actions appear on hover, on keyboard focus, and always on touch */}
        <div className="pointer-events-none flex items-center gap-1 opacity-0 transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100">
          {hasContent && (
            <CopyButton isCopied={isCopied} onClick={() => onCopy(messageId, contentText)} />
          )}
          {onFork && (
            <IconButton
              label="Fork"
              title="Fork"
              onClick={() => onFork(messageId, 'primary')}
              disabled={actionsDisabled}
              className={toolbarButtonClasses}
            >
              <GitFork />
            </IconButton>
          )}
          {onEdit && (
            <IconButton
              label="Edit"
              title="Edit"
              onClick={() => onEdit(messageId, contentText)}
              disabled={actionsDisabled}
              className={toolbarButtonClasses}
            >
              <Edit2 />
            </IconButton>
          )}
        </div>
        {revisionNavigation}
      </div>
    );
  }

  // Assistant toolbar (integrated into stats row)
  return (
    <div className="flex shrink-0 items-center gap-1">
      {hasContent && <CopyButton isCopied={isCopied} onClick={() => onCopy(copyId, contentText)} />}
      {hasContent && onToggleRaw && (
        <IconButton
          label={isRaw ? 'Show rendered' : 'Show raw text'}
          title={isRaw ? 'Show rendered' : 'Show raw text'}
          aria-pressed={isRaw}
          onClick={onToggleRaw}
          className={cn(toolbarButtonClasses, isRaw && 'bg-emphasis text-fg')}
        >
          <Code />
        </IconButton>
      )}
      {onFork && (
        <IconButton
          label="Fork"
          title="Fork"
          onClick={() => onFork(messageId, modelId)}
          className={toolbarButtonClasses}
        >
          <GitFork />
        </IconButton>
      )}
      {!isStreaming && hasComparison && !isUser && onRetryModel && (
        <IconButton
          label="Retry this model"
          title="Retry this model"
          onClick={() => onRetryModel(messageId, modelId)}
          disabled={actionsDisabled}
          className={toolbarButtonClasses}
        >
          <RefreshCw />
        </IconButton>
      )}
      {!isStreaming && !hasComparison && onRetry && (
        <IconButton
          label="Regenerate"
          title="Regenerate"
          onClick={() => onRetry(messageId)}
          disabled={actionsDisabled}
          className={toolbarButtonClasses}
        >
          <RefreshCw />
        </IconButton>
      )}
      {revisionNavigation}
    </div>
  );
}
