"use client";
import { useCallback, useState } from 'react';
import { ChatProvider, useChatContext } from '../contexts/ChatContext';
import { useConversations } from '../hooks/useConversations';
import { useChatStream } from '../hooks/useChatStream';
import { useMessageEditing } from '../hooks/useMessageEditing';
import { ChatSidebar } from './ChatSidebar';
import { ChatHeader } from './ChatHeader';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import { createConversation, getConversationApi } from '../lib/chat';
import type { Role } from '../lib/chat';
import { ChatV2 } from './ChatV2';
import { isFeatureEnabled } from '../lib/featureFlags';

function ChatInner() {
  const {
    conversationId,
    setConversationId,
    model,
    setModel,
    useTools,
    setUseTools,
    shouldStream,
    setShouldStream,
    reasoningEffort,
    verbosity,
  } = useChatContext();
  const [input, setInput] = useState('');

  const conversations = useConversations();
  const chatStream = useChatStream();
  const messageEditing = useMessageEditing();

  const handleCopy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {}
  }, []);

  const handleRetryLastAssistant = useCallback(async () => {
    if (chatStream.pending.streaming) return;
    const msgs = chatStream.messages;
    if (msgs.length === 0) return;
    const last = msgs[msgs.length - 1];
    if (last.role !== 'assistant') return;
    // Remove the last assistant message and regenerate the reply
    const base = msgs.slice(0, -1);
    chatStream.setMessages(base);
    chatStream.setPreviousResponseId(null);
    await chatStream.regenerateFromBase(base, conversationId, model, useTools, shouldStream, reasoningEffort, verbosity);
  }, [chatStream, conversationId, model, useTools, shouldStream, reasoningEffort, verbosity]);

  const handleNewChat = useCallback(async () => {
    if (chatStream.pending.streaming) chatStream.stopStreaming();
    chatStream.clearMessages();
    setInput('');
    messageEditing.handleCancelEdit();

    if (conversations.historyEnabled) {
      try {
        const convo = await createConversation(undefined, { model });
        setConversationId(convo.id);
        conversations.addConversation({
          id: convo.id,
          title: convo.title || 'New chat',
          model: convo.model,
          created_at: convo.created_at
        });
      } catch (e: any) {
        if (e.status === 501) conversations.setHistoryEnabled(false);
      }
    } else {
      setConversationId(null);
    }
  }, [chatStream, conversations, model, setConversationId, messageEditing]);

  const selectConversation = useCallback(async (id: string) => {
    if (chatStream.pending.streaming) chatStream.stopStreaming();
    setConversationId(id);
    chatStream.clearMessages();
    messageEditing.handleCancelEdit();

    try {
      const data = await getConversationApi(undefined, id, { limit: 200 });
      const msgs = data.messages.map(m => ({
        id: String(m.id),
        role: m.role as Role,
        content: m.content || ''
      }));
      chatStream.setMessages(msgs);
    } catch (e: any) {
      // ignore
    }
  }, [chatStream, setConversationId, messageEditing]);

  const handleDeleteConversation = useCallback(async (id: string) => {
    await conversations.deleteConversation(id);
    if (conversationId === id) {
      setConversationId(null);
      chatStream.clearMessages();
    }
  }, [conversations, conversationId, setConversationId, chatStream]);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    // Clear input immediately for a more responsive feel
    setInput('');
    await chatStream.sendMessage(trimmed, conversationId, model, useTools, shouldStream, reasoningEffort, verbosity);
  }, [input, chatStream, conversationId, model, useTools, shouldStream, reasoningEffort, verbosity]);

  const handleSaveEdit = useCallback(() => {
    if (chatStream.pending.streaming) {
      chatStream.stopStreaming();
    }
    // Fire-and-forget: `useMessageEditing` applies optimistic updates and will
    // reconcile or revert when the network call completes. Avoid awaiting here
    // so the UI doesn't block.
    void messageEditing.handleSaveEdit(
      conversationId,
      chatStream.setMessages,
      async (base, newConversationId) => {
        // Reset streaming context and regenerate assistant reply from provided base messages
        chatStream.setPreviousResponseId(null);
        const targetConvoId = newConversationId ?? conversationId;
        if (newConversationId) {
          setConversationId(newConversationId);
        }
        await chatStream.regenerateFromBase(base, targetConvoId, model, useTools, shouldStream, reasoningEffort, verbosity);
      }
    );
  }, [conversationId, messageEditing, chatStream, model, useTools, shouldStream, setConversationId, reasoningEffort, verbosity]);

  const handleApplyLocalEdit = useCallback(async () => {
    const id = messageEditing.editingMessageId;
    const content = messageEditing.editingContent.trim();
    if (!id || !content) return;
    if (chatStream.pending.streaming) chatStream.stopStreaming();

    // Compute trimmed messages with the edit applied from the latest snapshot
    const prev = chatStream.messages;
    const idx = prev.findIndex(m => m.id === id);
    if (idx === -1) return;
    const updatedUser = { ...prev[idx], content } as { id: string; role: Role; content: string };
    const baseMessages = [...prev.slice(0, idx), updatedUser] as { id: string; role: Role; content: string }[];

    // Apply the trimmed messages
    chatStream.setMessages(baseMessages as any);
    // Reset previous response link to avoid stale continuation
    chatStream.setPreviousResponseId(null);

    // Regenerate using computed baseMessages (ensure last is user)
    if (baseMessages.length && baseMessages[baseMessages.length - 1].role === 'user') {
      await chatStream.generateFromHistory(model, useTools, reasoningEffort, verbosity, baseMessages as any);
    }

    messageEditing.handleCancelEdit();
  }, [chatStream, messageEditing, model, useTools, reasoningEffort, verbosity]);

  return (
    <div className="flex h-dvh max-h-dvh bg-gradient-to-br from-slate-50 via-white to-slate-100/40 dark:from-neutral-950 dark:via-neutral-950 dark:to-neutral-900/20">
      {conversations.historyEnabled && (
        <ChatSidebar
          conversations={conversations.conversations}
          nextCursor={conversations.nextCursor}
          loadingConversations={conversations.loadingConversations}
          conversationId={conversationId}
          onSelectConversation={selectConversation}
          onDeleteConversation={handleDeleteConversation}
          onLoadMore={conversations.loadMoreConversations}
          onRefresh={conversations.refreshConversations}
        />
      )}
      <div className="flex flex-col flex-1 relative">
        <ChatHeader
          model={model}
          useTools={useTools}
          shouldStream={shouldStream}
          isStreaming={chatStream.pending.streaming}
          onModelChange={setModel}
          onUseToolsChange={setUseTools}
          onShouldStreamChange={setShouldStream}
          onNewChat={handleNewChat}
          onStop={chatStream.stopStreaming}
        />
        <MessageList
          messages={chatStream.messages}
          pending={chatStream.pending}
          conversationId={conversationId}
          editingMessageId={messageEditing.editingMessageId}
          editingContent={messageEditing.editingContent}
          onCopy={handleCopy}
          onEditMessage={messageEditing.handleEditMessage}
          onCancelEdit={messageEditing.handleCancelEdit}
          onSaveEdit={handleSaveEdit}
          onApplyLocalEdit={handleApplyLocalEdit}
          onEditingContentChange={messageEditing.setEditingContent}
          onRetryLastAssistant={handleRetryLastAssistant}
        />
        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 w-full max-w-2xl px-4">
          <MessageInput
            input={input}
            pending={chatStream.pending}
            onInputChange={setInput}
            onSend={handleSend}
          />
        </div>
      </div>
    </div>
  );
}

export function Chat() {
  // Feature flag to enable v2 implementation
  if (isFeatureEnabled('CHAT_V2')) {
    return <ChatV2 />;
  }

  // Default to v1 implementation
  return (
    <ChatProvider>
      <ChatInner />
    </ChatProvider>
  );
}
