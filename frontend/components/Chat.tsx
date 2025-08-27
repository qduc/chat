"use client";
import { useCallback, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
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
import type { QualityLevel } from './ui/QualitySlider';
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
    researchMode,
    setResearchMode,
    reasoningEffort,
    setReasoningEffort,
    verbosity,
    setVerbosity,
    qualityLevel,
    setQualityLevel,
  } = useChatContext();
  const [input, setInput] = useState('');

  const conversations = useConversations();
  const chatStream = useChatStream();
  const messageEditing = useMessageEditing();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Sync URL param with active conversation
  useEffect(() => {
    if (conversationId) {
      const params = new URLSearchParams(searchParams.toString());
      params.set('conversationId', conversationId);
      router.replace(`?${params.toString()}`);
    } else {
      // Remove param if no active conversation
      const params = new URLSearchParams(searchParams.toString());
      params.delete('conversationId');
      router.replace(`?${params.toString()}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  // On mount, check for conversationId in URL and load that conversation
  useEffect(() => {
    const urlConvoId = searchParams.get('conversationId');
    if (urlConvoId && urlConvoId !== conversationId) {
      selectConversation(urlConvoId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    await chatStream.regenerateFromBase(base, conversationId, model, useTools, shouldStream, reasoningEffort, verbosity, researchMode, qualityLevel);
  }, [chatStream, conversationId, model, useTools, shouldStream, reasoningEffort, verbosity, researchMode, qualityLevel]);

  const handleNewChat = useCallback(async () => {
    if (chatStream.pending.streaming) chatStream.stopStreaming();
    chatStream.clearMessages();
    setInput('');
    messageEditing.handleCancelEdit();

    // No longer need to explicitly create conversations - they'll be auto-created on first message
    setConversationId(null);

    // Remove conversationId param from URL
    const params = new URLSearchParams(searchParams.toString());
    params.delete('conversationId');
    router.replace(`?${params.toString()}`);
  }, [chatStream, setConversationId, messageEditing, router, searchParams]);

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

      // Apply persisted settings from conversation data
      if (data.model) setModel(data.model);
      if (data.streaming_enabled !== undefined) setShouldStream(data.streaming_enabled);
      if (data.tools_enabled !== undefined) setUseTools(data.tools_enabled);
      if (data.research_mode !== undefined) setResearchMode(data.research_mode);
      if (data.quality_level !== undefined && data.quality_level !== null) {
        const qualityLevel = data.quality_level as QualityLevel;
        setQualityLevel(qualityLevel);
      }
      if (data.reasoning_effort !== undefined && data.reasoning_effort !== null) {
        setReasoningEffort(data.reasoning_effort);
      }
      if (data.verbosity !== undefined && data.verbosity !== null) {
        setVerbosity(data.verbosity);
      }
    } catch (e: any) {
      // ignore
    }
  }, [chatStream, setConversationId, messageEditing, setModel, setShouldStream, setUseTools, setResearchMode, setQualityLevel, setReasoningEffort, setVerbosity]);

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

    await chatStream.sendMessage(
      trimmed,
      conversationId,
      model,
      useTools,
      shouldStream,
      reasoningEffort,
      verbosity,
      researchMode,
      // Handle auto-created conversation: set id and refresh history list
      conversations.historyEnabled ? (conversation) => {
        setConversationId(conversation.id);
        // Ensure sidebar reflects server ordering/title by refetching
        void conversations.refreshConversations();
      } : undefined,
      qualityLevel
    );
  }, [input, chatStream, conversationId, model, useTools, shouldStream, reasoningEffort, verbosity, researchMode, conversations, setConversationId, qualityLevel]);

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
        await chatStream.regenerateFromBase(base, targetConvoId, model, useTools, shouldStream, reasoningEffort, verbosity, researchMode, qualityLevel);
      }
    );
  }, [conversationId, messageEditing, chatStream, model, useTools, shouldStream, setConversationId, reasoningEffort, verbosity, researchMode, qualityLevel]);

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
      await chatStream.generateFromHistory(model, useTools, reasoningEffort, verbosity, baseMessages as any, researchMode, qualityLevel);
    }

    messageEditing.handleCancelEdit();
  }, [chatStream, messageEditing, model, useTools, reasoningEffort, verbosity, researchMode, qualityLevel]);

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
          onNewChat={handleNewChat}
        />
      )}
      <div className="flex flex-col flex-1 relative">
        <ChatHeader
          isStreaming={chatStream.pending.streaming}
          onNewChat={handleNewChat}
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
        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 w-full max-w-4xl px-4">
          <MessageInput
            input={input}
            pending={chatStream.pending}
            onInputChange={setInput}
            onSend={handleSend}
            onStop={chatStream.stopStreaming}
            useTools={useTools}
            shouldStream={shouldStream}
            researchMode={researchMode}
            onUseToolsChange={setUseTools}
            onShouldStreamChange={setShouldStream}
            onResearchModeChange={setResearchMode}
          />
        </div>
      </div>
    </div>
  );
}

export function Chat() {
  // Feature flag to enable v2 implementation
  if (isFeatureEnabled('CHAT_V2')) {
    return (
        <ChatProvider>
            <ChatV2 />
        </ChatProvider>
    );
  }

  // Default to v1 implementation
  return (
    <ChatProvider>
      <ChatInner />
    </ChatProvider>
  );
}
