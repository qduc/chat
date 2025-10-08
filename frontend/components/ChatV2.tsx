"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useChat } from '../hooks/useChat';
import { ChatSidebar } from './ChatSidebar';
import { ChatHeader } from './ChatHeader';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import { RightSidebar } from './RightSidebar';
import SettingsModal from './SettingsModal';
import { AuthModal, AuthMode } from './auth/AuthModal';
import type { MessageContent } from '../lib';

export function ChatV2() {
  const chat = useChat();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('login');

  const DEFAULT_RIGHT_SIDEBAR_WIDTH = 320;
  const MIN_RIGHT_SIDEBAR_WIDTH = 260;
  const MAX_RIGHT_SIDEBAR_WIDTH = 560;
  const [rightSidebarWidth, setRightSidebarWidth] = useState(DEFAULT_RIGHT_SIDEBAR_WIDTH);
  const [isResizingRightSidebar, setIsResizingRightSidebar] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initCheckedRef = useRef(false);
  const initLoadingRef = useRef(false);
  const searchKey = searchParams?.toString();
  const resizeStateRef = useRef({ startX: 0, startWidth: DEFAULT_RIGHT_SIDEBAR_WIDTH });
  const isResizingRef = useRef(false);
  const nextWidthRef = useRef(DEFAULT_RIGHT_SIDEBAR_WIDTH);
  const frameRef = useRef<number | null>(null);

  // Simple event handlers
  const handleCopy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {}
  }, []);

  const handleShowLogin = useCallback(() => {
    setAuthMode('login');
    setShowAuthModal(true);
  }, []);

  const handleShowRegister = useCallback(() => {
    setAuthMode('register');
    setShowAuthModal(true);
  }, []);

  useEffect(() => {
    const storedWidth = typeof window !== 'undefined' ? window.localStorage.getItem('rightSidebarWidth') : null;
    if (!storedWidth) return;
    const parsed = Number.parseInt(storedWidth, 10);
    if (Number.isFinite(parsed)) {
      const clamped = Math.min(Math.max(parsed, MIN_RIGHT_SIDEBAR_WIDTH), MAX_RIGHT_SIDEBAR_WIDTH);
      nextWidthRef.current = clamped;
      setRightSidebarWidth(clamped);
    }
  }, []);

  useEffect(() => {
    if (chat.rightSidebarCollapsed) return;
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('rightSidebarWidth', String(rightSidebarWidth));
  }, [rightSidebarWidth, chat.rightSidebarCollapsed]);

  const stopResizing = useCallback(() => {
    if (!isResizingRef.current) return;
    isResizingRef.current = false;
    setIsResizingRightSidebar(false);
    if (frameRef.current !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    setRightSidebarWidth(nextWidthRef.current);
  }, []);

  const clampRightSidebarWidth = useCallback((value: number) => {
    return Math.min(Math.max(value, MIN_RIGHT_SIDEBAR_WIDTH), MAX_RIGHT_SIDEBAR_WIDTH);
  }, [MAX_RIGHT_SIDEBAR_WIDTH, MIN_RIGHT_SIDEBAR_WIDTH]);

  const scheduleWidthUpdate = useCallback((value: number) => {
    const clamped = clampRightSidebarWidth(value);
    nextWidthRef.current = clamped;

    if (typeof window === 'undefined') {
      setRightSidebarWidth(clamped);
      return;
    }

    if (frameRef.current !== null) {
      return;
    }

    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      setRightSidebarWidth(nextWidthRef.current);
    });
  }, [clampRightSidebarWidth]);

  const handleResizeMove = useCallback((event: PointerEvent) => {
    if (!isResizingRef.current) return;
    const delta = resizeStateRef.current.startX - event.clientX;
    const nextWidth = resizeStateRef.current.startWidth + delta;
    scheduleWidthUpdate(nextWidth);
  }, [scheduleWidthUpdate]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handlePointerMove = (event: PointerEvent) => handleResizeMove(event);
    const handlePointerUp = () => stopResizing();
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [handleResizeMove, stopResizing]);

  const handleResizeStart = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (chat.rightSidebarCollapsed) return;
    resizeStateRef.current = {
      startX: event.clientX,
      startWidth: rightSidebarWidth
    };
    isResizingRef.current = true;
    setIsResizingRightSidebar(true);
  }, [rightSidebarWidth, chat.rightSidebarCollapsed]);

  const handleResizeDoubleClick = useCallback(() => {
    if (chat.rightSidebarCollapsed) return;
    nextWidthRef.current = clampRightSidebarWidth(DEFAULT_RIGHT_SIDEBAR_WIDTH);
    setRightSidebarWidth(nextWidthRef.current);
  }, [DEFAULT_RIGHT_SIDEBAR_WIDTH, clampRightSidebarWidth, chat.rightSidebarCollapsed]);

  useEffect(() => {
    if (!chat.rightSidebarCollapsed) return;
    stopResizing();
  }, [chat.rightSidebarCollapsed, stopResizing]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!isResizingRightSidebar) {
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');
      return;
    }

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [isResizingRightSidebar]);

  useEffect(() => {
    return () => {
      if (frameRef.current !== null && typeof window !== 'undefined') {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, []);

  // Keyboard shortcut for toggling sidebar (Ctrl/Cmd + \)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
        e.preventDefault();
        chat.toggleSidebar();
      }
      // Keyboard shortcut for toggling right sidebar (Ctrl/Cmd + Shift + \)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === '\\') {
        e.preventDefault();
        chat.toggleRightSidebar();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Respond to URL changes (e.g., back/forward) to drive state
  useEffect(() => {
    if (!searchParams) return;
    if (initLoadingRef.current) return;
    const cid = searchParams.get('c');
    if (cid && cid !== chat.conversationId) {
      void chat.selectConversation(cid);
    } else if (!cid && chat.conversationId) {
      chat.newChat();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchKey]);

  const handleRetryMessage = useCallback(async (messageId: string) => {
    if (chat.status === 'streaming') return;
    if (chat.messages.length === 0) return;

    // Find the message index
    const idx = chat.messages.findIndex(m => m.id === messageId);
    if (idx === -1) return;

    const message = chat.messages[idx];
    if (message.role !== 'assistant') return;

    // Keep only messages up to (but not including) the message being retried
    const base = chat.messages.slice(0, idx);
    chat.regenerate(base);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.messages, chat.status]);

  const handleApplyLocalEdit = useCallback(async (messageId: string, updatedContent: MessageContent) => {
    if (chat.status === 'streaming') {
      chat.stopStreaming();
    }

    const idx = chat.messages.findIndex(m => m.id === messageId);
    if (idx === -1) return;

    const baseMessages = [
      ...chat.messages.slice(0, idx),
      { ...chat.messages[idx], content: updatedContent }
    ];

    chat.setMessages(baseMessages);
    chat.cancelEdit();

    if (baseMessages.length && baseMessages[baseMessages.length - 1].role === 'user') {
      chat.regenerate(baseMessages);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.messages, chat.status]);

  // Load conversations and hydrate from URL on first load
  useEffect(() => {
    if (initCheckedRef.current) return;
    initCheckedRef.current = true;

    // Load conversation list
    chat.refreshConversations();

    const cid = searchParams?.get('c');
    if (cid && !chat.conversationId) {
      initLoadingRef.current = true;
      (async () => {
        try {
          await chat.selectConversation(cid);
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
    if (chat.conversationId) {
      if (params.get('c') !== chat.conversationId) {
        params.set('c', chat.conversationId);
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
  }, [chat.conversationId]);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const sidebarTitle = chat.conversations.find(convo => convo.id === chat.conversationId)?.title?.trim();
    const activeTitle = (chat.currentConversationTitle ?? sidebarTitle)?.trim();
    const nextTitle = activeTitle ? `${activeTitle} - ChatForge` : 'ChatForge';

    const applyTitle = () => {
      document.title = nextTitle;
    };

    applyTitle();

    if (typeof window === 'undefined') return;

    const frameId = window.requestAnimationFrame(applyTitle);
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [pathname, searchKey, chat.conversationId, chat.conversations, chat.currentConversationTitle]);

  // Clear the input immediately when the user presses send, then invoke sendMessage
  const handleSend = useCallback(() => {
    const messageToSend = chat.input;
    // clear input right away so the UI feels responsive
    chat.setInput('');
    // call sendMessage with the captured content so it doesn't rely on chat.input after clearing
    void chat.sendMessage(messageToSend);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.input, chat.setInput, chat.sendMessage]);

  return (
    <div className="flex h-dvh max-h-dvh bg-gradient-to-br from-slate-50 via-white to-slate-100/40 dark:from-neutral-950 dark:via-neutral-950 dark:to-neutral-900/20">
      {chat.historyEnabled && (
        <ChatSidebar
          conversations={chat.conversations}
          nextCursor={chat.nextCursor}
          loadingConversations={chat.loadingConversations}
          conversationId={chat.conversationId}
          collapsed={chat.sidebarCollapsed}
          onSelectConversation={chat.selectConversation}
          onDeleteConversation={chat.deleteConversation}
          onLoadMore={chat.loadMoreConversations}
          onRefresh={chat.refreshConversations}
          onNewChat={chat.newChat}
          onToggleCollapse={chat.toggleSidebar}
        />
      )}
      <div className="flex flex-col flex-1">
        <ChatHeader
          isStreaming={chat.status === 'streaming'}
          onNewChat={chat.newChat}
          model={chat.model}
          onModelChange={chat.setModel}
          onProviderChange={chat.setProviderId}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onShowLogin={handleShowLogin}
          onShowRegister={handleShowRegister}
          onRefreshModels={chat.loadProvidersAndModels}
          isLoadingModels={chat.isLoadingModels}
          groups={chat.modelGroups}
          fallbackOptions={chat.modelOptions}
          modelToProvider={chat.modelToProvider}
        />
        <div className="flex flex-1 min-h-0">
          <div className="flex flex-col flex-1 relative">
            <MessageList
              messages={chat.messages}
              pending={{
                streaming: chat.status === 'streaming',
                error: chat.error ?? undefined,
                abort: chat.abort
              }}
              conversationId={chat.conversationId}
              editingMessageId={chat.editingMessageId}
              editingContent={chat.editingContent}
              onCopy={handleCopy}
              onEditMessage={chat.startEdit}
              onCancelEdit={chat.cancelEdit}
              onSaveEdit={chat.saveEdit}
              onApplyLocalEdit={handleApplyLocalEdit}
              onEditingContentChange={chat.updateEditContent}
              onRetryMessage={handleRetryMessage}
            />
            {/* Removed soft fade to keep a cleaner boundaryless look */}
      <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 w-full max-w-4xl px-6 z-30">
              <MessageInput
                input={chat.input}
                pending={{
                  streaming: chat.status === 'streaming',
                  error: chat.error ?? undefined,
                  abort: chat.abort
                }}
                onInputChange={chat.setInput}
                onSend={handleSend}
                onStop={chat.stopStreaming}
                useTools={chat.useTools}
                shouldStream={chat.shouldStream}
                onUseToolsChange={chat.setUseTools}
                enabledTools={chat.enabledTools}
                onEnabledToolsChange={chat.setEnabledTools}
                onShouldStreamChange={chat.setShouldStream}
                model={chat.model}
                qualityLevel={chat.qualityLevel}
                onQualityLevelChange={chat.setQualityLevel}
                modelCapabilities={chat.modelCapabilities}
                images={chat.images}
                onImagesChange={chat.setImages}
              />
            </div>
            <SettingsModal
              open={isSettingsOpen}
              onClose={() => setIsSettingsOpen(false)}
            />
            <AuthModal
              open={showAuthModal}
              onClose={() => setShowAuthModal(false)}
              initialMode={authMode}
            />
          </div>
          {!chat.rightSidebarCollapsed && (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize right sidebar"
              className={`flex-shrink-0 self-stretch w-1 cursor-col-resize select-none transition-colors duration-150 ${isResizingRightSidebar ? 'bg-blue-400/60 dark:bg-blue-500/50' : 'bg-transparent hover:bg-blue-400/40 dark:hover:bg-blue-500/30'}`}
              onPointerDown={handleResizeStart}
              onDoubleClick={handleResizeDoubleClick}
            />
          )}
          <RightSidebar
            userId={chat.user?.id}
            conversationId={chat.conversationId || undefined}
            collapsed={chat.rightSidebarCollapsed}
            onToggleCollapse={chat.toggleRightSidebar}
            onEffectivePromptChange={chat.setInlineSystemPromptOverride}
            onActivePromptIdChange={chat.setActiveSystemPromptId}
            conversationActivePromptId={chat.activeSystemPromptId}
            conversationSystemPrompt={chat.systemPrompt}
            width={rightSidebarWidth}
            isResizing={isResizingRightSidebar}
          />
        </div>
      </div>
    </div>
  );
}
