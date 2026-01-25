/**
 * UserMessage - User message bubble with toolbar
 * Renders the user's message content with copy/edit/fork actions
 */

import React from 'react';
import { MessageContentRenderer } from '../ui/MessageContentRenderer';
import { MessageToolbar } from './MessageToolbar';
import { hasAudio, extractTextFromContent, type MessageContent } from '../../lib';

interface UserMessageProps {
  messageId: string;
  content: MessageContent;
  copiedMessageId: string | null;
  actionsDisabled: boolean;
  onCopy: (messageId: string, text: string) => void;
  onFork?: (messageId: string, modelId: string) => void;
  onEditMessage?: (messageId: string, content: string) => void;
  toolbarRef?: React.RefObject<HTMLDivElement | null>;
}

export function UserMessage({
  messageId,
  content,
  copiedMessageId,
  actionsDisabled,
  onCopy,
  onFork,
  onEditMessage,
  toolbarRef,
}: UserMessageProps) {
  const messageHasAudio = hasAudio(content);
  const textContent = extractTextFromContent(content);

  return (
    <>
      <div
        className={`rounded-2xl px-5 py-3.5 text-base leading-relaxed bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100 ${messageHasAudio ? 'min-w-[280px] sm:min-w-[400px]' : ''}`}
      >
        <MessageContentRenderer content={content} isStreaming={false} role="user" />
      </div>
      {content && (
        <MessageToolbar
          messageId={messageId}
          modelId="primary"
          hasContent={!!content}
          copiedMessageId={copiedMessageId}
          actionsDisabled={actionsDisabled}
          isStreaming={false}
          hasComparison={false}
          isUser={true}
          onCopy={onCopy}
          onFork={onFork}
          onEdit={onEditMessage}
          contentText={textContent}
          variant="user"
          toolbarRef={toolbarRef}
        />
      )}
    </>
  );
}
