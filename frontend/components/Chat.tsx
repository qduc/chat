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

function ChatInner() {
  const { conversationId, setConversationId, model, setModel, useTools, setUseTools } = useChatContext();
  const [input, setInput] = useState('');
  
  const conversations = useConversations();
  const chatStream = useChatStream();
  const messageEditing = useMessageEditing();

  const handleCopy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {}
  }, []);

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
    if (!input.trim()) return;
    await chatStream.sendMessage(input.trim(), conversationId, model, useTools);
    setInput('');
  }, [input, chatStream, conversationId, model, useTools]);

  const handleSaveEdit = useCallback(async () => {
    if (!conversationId) return;
    await messageEditing.handleSaveEdit(
      conversationId,
      (newConversationId) => {
        setConversationId(newConversationId);
        chatStream.setPreviousResponseId(null);
      },
      chatStream.setMessages,
      conversations.addConversation
    );
  }, [conversationId, messageEditing, setConversationId, chatStream, conversations]);

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
          isStreaming={chatStream.pending.streaming}
          onModelChange={setModel}
          onUseToolsChange={setUseTools}
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
          onEditingContentChange={messageEditing.setEditingContent}
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
  return (
    <ChatProvider>
      <ChatInner />
    </ChatProvider>
  );
}
