"use client";
import { useCallback } from 'react';
import { useChatState } from '../hooks/useChatState';
import { ChatSidebar } from './ChatSidebar';
import { ChatHeader } from './ChatHeader';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';

export function ChatV2() {
  const { state, actions } = useChatState();

  // Simple event handlers - just dispatch actions
  const handleCopy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {}
  }, []);

  const handleRetryLastAssistant = useCallback(async () => {
    if (state.status === 'streaming') return;
    if (state.messages.length === 0) return;

    const last = state.messages[state.messages.length - 1];
    if (last.role !== 'assistant') return;

    // Remove the last assistant message and regenerate
    const base = state.messages.slice(0, -1);
    actions.regenerate(base);
  }, [state.messages, state.status, actions]);

  const handleApplyLocalEdit = useCallback(async () => {
    if (!state.editingMessageId || !state.editingContent.trim()) return;
    if (state.status === 'streaming') {
      actions.stopStreaming();
    }

    const messageId = state.editingMessageId;
    const content = state.editingContent.trim();

    // Find the message and create base messages
    const idx = state.messages.findIndex(m => m.id === messageId);
    if (idx === -1) return;

    const updatedMessage = { ...state.messages[idx], content };
    const baseMessages = [...state.messages.slice(0, idx), updatedMessage];

    actions.setMessages(baseMessages);
    actions.cancelEdit();

    // If last message is user message, could trigger regeneration here
    if (baseMessages.length && baseMessages[baseMessages.length - 1].role === 'user') {
      actions.regenerate(baseMessages);
    }
  }, [state.editingMessageId, state.editingContent, state.messages, state.status, actions]);

  return (
    <div className="flex h-dvh max-h-dvh bg-gradient-to-br from-slate-50 via-white to-slate-100/40 dark:from-neutral-950 dark:via-neutral-950 dark:to-neutral-900/20">
      {state.historyEnabled && (
        <ChatSidebar
          conversations={state.conversations}
          nextCursor={state.nextCursor}
          loadingConversations={state.loadingConversations}
          conversationId={state.conversationId}
          onSelectConversation={actions.selectConversation}
          onDeleteConversation={actions.deleteConversation}
          onLoadMore={actions.loadMoreConversations}
          onRefresh={actions.refreshConversations}
          onNewChat={actions.newChat}
        />
      )}
      <div className="flex flex-col flex-1 relative">
        <ChatHeader
          isStreaming={state.status === 'streaming'}
          onNewChat={actions.newChat}
        />
        <MessageList
          messages={state.messages}
          pending={{
            streaming: state.status === 'streaming',
            error: state.error ?? undefined,
            abort: state.abort
          }}
          conversationId={state.conversationId}
          editingMessageId={state.editingMessageId}
          editingContent={state.editingContent}
          onCopy={handleCopy}
          onEditMessage={actions.startEdit}
          onCancelEdit={actions.cancelEdit}
          onSaveEdit={actions.saveEdit}
          onApplyLocalEdit={handleApplyLocalEdit}
          onEditingContentChange={actions.updateEditContent}
          onRetryLastAssistant={handleRetryLastAssistant}
        />
        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 w-full max-w-2xl px-4">
          <MessageInput
            input={state.input}
            pending={{
              streaming: state.status === 'streaming',
              error: state.error ?? undefined,
              abort: state.abort
            }}
            onInputChange={actions.setInput}
            onSend={actions.sendMessage}
            onStop={actions.stopStreaming}
            useTools={state.useTools}
            shouldStream={state.shouldStream}
            researchMode={false}
            onUseToolsChange={actions.setUseTools}
            onShouldStreamChange={actions.setShouldStream}
            onResearchModeChange={() => {}}
          />
        </div>
      </div>
    </div>
  );
}