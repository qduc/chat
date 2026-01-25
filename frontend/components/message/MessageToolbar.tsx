/**
 * MessageToolbar - Action buttons for messages
 * Copy, Edit, Fork, Retry buttons with tooltip feedback
 */

import React from 'react';
import { Copy, Edit2, GitFork, RefreshCw } from 'lucide-react';

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
  contentText: string;
  variant?: 'user' | 'assistant';
  toolbarRef?: React.RefObject<HTMLDivElement | null>;
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
  contentText,
  variant = 'assistant',
  toolbarRef,
}: MessageToolbarProps) {
  const copyId = variant === 'user' ? messageId : `${messageId}-${modelId}`;
  const isCopied = copiedMessageId === copyId;

  if (variant === 'user') {
    return (
      <div
        className="mt-1 flex items-center justify-end opacity-0 group-hover:opacity-100 transition-opacity text-xs pointer-events-none group-hover:pointer-events-auto"
        ref={toolbarRef}
      >
        <div className="flex items-center gap-2">
          {hasContent && (
            <div className="relative">
              <button
                type="button"
                onClick={() => onCopy(messageId, contentText)}
                title="Copy"
                className="p-2 rounded-md bg-white/20 dark:bg-neutral-800/30 hover:bg-white/60 dark:hover:bg-neutral-700/70 text-slate-700 dark:text-slate-200 cursor-pointer transition-colors"
              >
                <Copy className="w-3 h-3" aria-hidden="true" />
                <span className="sr-only">Copy</span>
              </button>
              {isCopied && (
                <div className="absolute bottom-full mb-1 left-1/2 transform -translate-x-1/2 bg-slate-800 dark:bg-slate-700 text-white text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap z-10 animate-fade-in shadow-lg">
                  Copied
                  <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-[3px] border-r-[3px] border-t-[4px] border-transparent border-t-slate-800 dark:border-t-slate-700"></div>
                </div>
              )}
            </div>
          )}
          {onFork && (
            <button
              type="button"
              onClick={() => onFork(messageId, 'primary')}
              title="Fork"
              disabled={actionsDisabled}
              className="p-2 rounded-md bg-white/20 dark:bg-neutral-800/30 hover:bg-white/60 dark:hover:bg-neutral-700/70 text-slate-700 dark:text-slate-200 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <GitFork className="w-3 h-3" aria-hidden="true" />
              <span className="sr-only">Fork</span>
            </button>
          )}
          {onEdit && (
            <button
              type="button"
              onClick={() => onEdit(messageId, contentText)}
              title="Edit"
              disabled={actionsDisabled}
              className="p-2 rounded-md bg-white/20 dark:bg-neutral-800/30 hover:bg-white/60 dark:hover:bg-neutral-700/70 text-slate-700 dark:text-slate-200 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Edit2 className="w-3 h-3" aria-hidden="true" />
              <span className="sr-only">Edit</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  // Assistant toolbar (integrated into stats row)
  return (
    <div className="flex items-center gap-1.5 flex-shrink-0">
      {hasContent && (
        <div className="relative">
          <button
            type="button"
            onClick={() => onCopy(copyId, contentText)}
            title="Copy"
            className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 transition-colors"
          >
            <Copy className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="sr-only">Copy</span>
          </button>
          {isCopied && (
            <div className="absolute bottom-full mb-1 left-1/2 transform -translate-x-1/2 bg-slate-800 dark:bg-slate-700 text-white text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap z-10 animate-fade-in shadow-lg">
              Copied
              <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-[3px] border-r-[3px] border-t-[4px] border-transparent border-t-slate-800 dark:border-t-slate-700"></div>
            </div>
          )}
        </div>
      )}
      {onFork && (
        <button
          type="button"
          onClick={() => onFork(messageId, modelId)}
          title="Fork"
          className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 transition-colors"
        >
          <GitFork className="w-3.5 h-3.5" aria-hidden="true" />
          <span className="sr-only">Fork</span>
        </button>
      )}
      {!isStreaming && hasComparison && !isUser && onRetryModel && (
        <button
          type="button"
          onClick={() => onRetryModel(messageId, modelId)}
          title="Retry this model"
          disabled={actionsDisabled}
          className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
          <span className="sr-only">Retry this model</span>
        </button>
      )}
      {!isStreaming && !hasComparison && onRetry && (
        <button
          type="button"
          onClick={() => onRetry(messageId)}
          title="Regenerate"
          disabled={actionsDisabled}
          className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
          <span className="sr-only">Regenerate</span>
        </button>
      )}
    </div>
  );
}
