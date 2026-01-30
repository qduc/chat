/**
 * Message - Main message wrapper component
 * Chooses between UserMessage and AssistantMessage based on role
 */

import React from 'react';
import { Bot } from 'lucide-react';
import { UserMessage } from './UserMessage';
import { AssistantMessage } from './AssistantMessage';
import { MessageEditForm } from './MessageEditForm';
import { hasAudio, extractTextFromContent } from '../../lib';
import type { MessageProps } from './types';

// Deep comparison for comparisonResults objects to detect changes from linked conversations
function deepEqualComparisonResults(
  a: Record<string, { content: any; usage?: any; status: string; error?: string }> | undefined,
  b: Record<string, { content: any; usage?: any; status: string; error?: string }> | undefined
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);

  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (!keysB.includes(key)) return false;

    const objA = a[key];
    const objB = b[key];

    // Compare content - stringify for deep comparison
    if (JSON.stringify(objA.content) !== JSON.stringify(objB.content)) return false;

    // Compare usage
    if (JSON.stringify(objA.usage) !== JSON.stringify(objB.usage)) return false;

    // Compare status and error
    if (objA.status !== objB.status) return false;
    if (objA.error !== objB.error) return false;
  }

  return true;
}

export const Message = React.memo<MessageProps>(
  function Message({
    message,
    isStreaming,
    compareModels,
    primaryModelLabel,
    linkedConversations,
    evaluations,
    evaluationDrafts,
    canSend,
    editingMessageId,
    editingContent,
    onEditMessage,
    onCancelEdit,
    onApplyLocalEdit,
    onEditingContentChange,
    onRetryMessage,
    onRetryComparisonModel,
    editingTextareaRef,
    lastUserMessageRef,
    resizeEditingTextarea,
    collapsedToolOutputs,
    setCollapsedToolOutputs,
    copiedMessageId,
    handleCopy,
    pending,
    streamingStats,
    editingImages,
    onEditingImagesChange,
    onRemoveEditingImage,
    onEditingPaste,
    onEditingImageUploadClick,
    fileInputRef,
    toolbarRef,
    onFork,
    selectedComparisonModels,
    onToggleComparisonModel,
    onSelectAllComparisonModels,
    isMobile,
    showComparisonTabs,
    onOpenJudgeModal,
    onDeleteJudgeResponse,
  }) {
    const isUser = message.role === 'user';
    const isEditing = editingMessageId === message.id;
    const messageHasAudio = hasAudio(message.content);
    const actionsDisabled = !canSend;

    // Compute whether multi-column layout is active
    const baseComparisonModels = Object.keys(message.comparisonResults || {});
    const showStreamingTabs = isStreaming && compareModels.length > 0;
    const comparisonModels = showStreamingTabs
      ? Array.from(new Set([...baseComparisonModels, ...compareModels]))
      : baseComparisonModels;
    const allModels = ['primary', ...comparisonModels];
    const resolvedSelectedModels = selectedComparisonModels.filter(
      (m) => m === 'primary' || comparisonModels.includes(m)
    );
    const activeModels = resolvedSelectedModels.length > 0 ? resolvedSelectedModels : ['primary'];
    const isMultiColumn = activeModels.length > 1;

    const handleToggleToolOutput = (key: string) => {
      setCollapsedToolOutputs((s) => ({ ...s, [key]: !(s[key] ?? true) }));
    };

    return (
      <div
        className={`flex gap-4 ${isUser ? 'justify-end' : 'justify-start'}`}
        ref={lastUserMessageRef}
      >
        {!isUser && (
          <div className="hidden">
            <Bot className="w-4 h-4 text-slate-700 dark:text-slate-200" />
          </div>
        )}
        <div
          className={`group relative ${isEditing ? 'w-full' : ''} ${isUser ? (messageHasAudio ? 'max-w-full order-first' : 'max-w-full sm:max-w-[85%] md:max-w-[75%] lg:max-w-[60%] order-first') : 'w-full'}`}
          style={{ minWidth: 0 }}
        >
          {isEditing ? (
            <MessageEditForm
              messageId={message.id}
              editingContent={editingContent}
              editingImages={editingImages}
              actionsDisabled={actionsDisabled}
              editingTextareaRef={editingTextareaRef}
              fileInputRef={fileInputRef}
              onEditingContentChange={onEditingContentChange}
              onEditingImagesChange={onEditingImagesChange}
              onRemoveEditingImage={onRemoveEditingImage}
              onEditingPaste={onEditingPaste}
              onEditingImageUploadClick={onEditingImageUploadClick}
              onApplyLocalEdit={onApplyLocalEdit}
              onCancelEdit={onCancelEdit}
              resizeEditingTextarea={resizeEditingTextarea}
            />
          ) : isUser ? (
            <UserMessage
              messageId={message.id}
              content={message.content}
              copiedMessageId={copiedMessageId}
              actionsDisabled={actionsDisabled}
              onCopy={handleCopy}
              onFork={onFork}
              onEditMessage={onEditMessage}
              toolbarRef={toolbarRef}
            />
          ) : (
            <AssistantMessage
              message={message}
              isStreaming={isStreaming}
              compareModels={compareModels}
              primaryModelLabel={primaryModelLabel}
              linkedConversations={linkedConversations}
              evaluations={evaluations}
              evaluationDrafts={evaluationDrafts}
              canSend={canSend}
              pending={pending}
              streamingStats={streamingStats}
              selectedComparisonModels={selectedComparisonModels}
              isMobile={isMobile}
              showComparisonTabs={showComparisonTabs}
              collapsedToolOutputs={collapsedToolOutputs}
              copiedMessageId={copiedMessageId}
              onToggleToolOutput={handleToggleToolOutput}
              onCopy={handleCopy}
              onFork={onFork}
              onRetryMessage={onRetryMessage}
              onRetryComparisonModel={onRetryComparisonModel}
              onToggleComparisonModel={onToggleComparisonModel}
              onSelectAllComparisonModels={onSelectAllComparisonModels}
              onOpenJudgeModal={onOpenJudgeModal}
              onDeleteJudgeResponse={onDeleteJudgeResponse}
              isEditing={isEditing}
            />
          )}
        </div>
      </div>
    );
  },
  (prev, next) => {
    // Only re-render if content changed or streaming state changed
    return (
      prev.message.content === next.message.content &&
      prev.message.tool_calls === next.message.tool_calls &&
      prev.message.tool_outputs === next.message.tool_outputs &&
      // Deep compare comparisonResults to detect changes from linked conversations
      deepEqualComparisonResults(prev.message.comparisonResults, next.message.comparisonResults) &&
      prev.message.usage === next.message.usage &&
      prev.isStreaming === next.isStreaming &&
      prev.compareModels === next.compareModels &&
      prev.primaryModelLabel === next.primaryModelLabel &&
      prev.linkedConversations === next.linkedConversations &&
      prev.evaluations === next.evaluations &&
      prev.evaluationDrafts === next.evaluationDrafts &&
      prev.canSend === next.canSend &&
      prev.editingMessageId === next.editingMessageId &&
      prev.editingContent === next.editingContent &&
      prev.pending.streaming === next.pending.streaming &&
      prev.collapsedToolOutputs === next.collapsedToolOutputs &&
      prev.copiedMessageId === next.copiedMessageId &&
      prev.streamingStats?.tokensPerSecond === next.streamingStats?.tokensPerSecond &&
      prev.streamingStats?.isEstimate === next.streamingStats?.isEstimate &&
      prev.editingImages === next.editingImages &&
      prev.toolbarRef === next.toolbarRef &&
      prev.selectedComparisonModels === next.selectedComparisonModels &&
      prev.isMobile === next.isMobile &&
      prev.showComparisonTabs === next.showComparisonTabs &&
      prev.onDeleteJudgeResponse === next.onDeleteJudgeResponse
    );
  }
);
