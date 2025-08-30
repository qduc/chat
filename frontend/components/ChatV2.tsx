"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useChatState } from '../hooks/useChatState';
import { ChatSidebar } from './ChatSidebar';
import { ChatHeader } from './ChatHeader';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import { RightSidebar } from './RightSidebar';
import SettingsModal from './SettingsModal';

export function ChatV2() {
  const { state, actions } = useChatState();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initCheckedRef = useRef(false);
  const initLoadingRef = useRef(false);
  const searchKey = searchParams?.toString();

  // Simple event handlers - just dispatch actions
  const handleCopy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {}
  }, []);

  // Respond to URL changes (e.g., back/forward) to drive state
  useEffect(() => {
    if (!searchParams) return;
    if (initLoadingRef.current) return;
    const cid = searchParams.get('c');
    if (cid && cid !== state.conversationId) {
      void actions.selectConversation(cid);
    } else if (!cid && state.conversationId) {
      actions.newChat();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchKey]);

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

  // Hydrate conversation from URL (?c=...) on first load
  useEffect(() => {
    if (initCheckedRef.current) return;
    initCheckedRef.current = true;

    const cid = searchParams?.get('c');
    if (cid && !state.conversationId) {
      initLoadingRef.current = true;
      (async () => {
        try {
          await actions.selectConversation(cid);
        } finally {
          initLoadingRef.current = false;
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep URL in sync with selected conversation
  useEffect(() => {
    if (!initCheckedRef.current || initLoadingRef.current) return;
    const params = new URLSearchParams(searchParams?.toString());
    if (state.conversationId) {
      if (params.get('c') !== state.conversationId) {
        params.set('c', state.conversationId);
        router.push(`${pathname}?${params.toString()}`);
      }
    } else {
      if (params.has('c')) {
        params.delete('c');
        const q = params.toString();
        router.push(q ? `${pathname}?${q}` : pathname);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.conversationId]);

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
          model={state.model}
          onModelChange={actions.setModel}
          providerId={state.providerId}
          onProviderChange={actions.setProviderId}
          onOpenSettings={() => setIsSettingsOpen(true)}
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
        {/* Removed soft fade to keep a cleaner boundaryless look */}
        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 w-full max-w-4xl px-6">
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
            onUseToolsChange={actions.setUseTools}
            onShouldStreamChange={actions.setShouldStream}
            model={state.model}
            qualityLevel={state.qualityLevel}
            onQualityLevelChange={actions.setQualityLevel}
          />
        </div>
        <SettingsModal
          open={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
        />
      </div>
      <RightSidebar systemPrompt={state.systemPrompt ?? ''} onSystemPromptChange={actions.setSystemPrompt} />
    </div>
  );
}
