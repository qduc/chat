"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useChatState } from '../hooks/useChatState';
import { ChatSidebar } from './ChatSidebar';
import { ChatHeader } from './ChatHeader';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import { RightSidebar } from './RightSidebar';
import SettingsModal from './SettingsModal';
import { AuthModal, AuthMode } from './auth/AuthModal';
import type { MessageContent } from '../lib';

export function ChatV2() {
  const { state, actions } = useChatState();
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

  // Simple event handlers - just dispatch actions
  const handleCopy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {}
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (state.rightSidebarCollapsed) return;
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('rightSidebarWidth', String(rightSidebarWidth));
  }, [rightSidebarWidth, state.rightSidebarCollapsed]);

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
    if (state.rightSidebarCollapsed) return;
    resizeStateRef.current = {
      startX: event.clientX,
      startWidth: rightSidebarWidth
    };
    isResizingRef.current = true;
    setIsResizingRightSidebar(true);
  }, [rightSidebarWidth, state.rightSidebarCollapsed]);

  const handleResizeDoubleClick = useCallback(() => {
    if (state.rightSidebarCollapsed) return;
    nextWidthRef.current = clampRightSidebarWidth(DEFAULT_RIGHT_SIDEBAR_WIDTH);
    setRightSidebarWidth(nextWidthRef.current);
  }, [DEFAULT_RIGHT_SIDEBAR_WIDTH, clampRightSidebarWidth, state.rightSidebarCollapsed]);

  useEffect(() => {
    if (!state.rightSidebarCollapsed) return;
    stopResizing();
  }, [state.rightSidebarCollapsed, stopResizing]);

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
        actions.toggleSidebar();
      }
      // Keyboard shortcut for toggling right sidebar (Ctrl/Cmd + Shift + \)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === '\\') {
        e.preventDefault();
        actions.toggleRightSidebar();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [actions]);

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

  const handleRetryMessage = useCallback(async (messageId: string) => {
    if (state.status === 'streaming') return;
    if (state.messages.length === 0) return;

    // Find the message index
    const idx = state.messages.findIndex(m => m.id === messageId);
    if (idx === -1) return;

    const message = state.messages[idx];
    if (message.role !== 'assistant') return;

    // Keep only messages up to (but not including) the message being retried
    const base = state.messages.slice(0, idx);
    actions.regenerate(base);
  }, [state.messages, state.status, actions]);

  const handleApplyLocalEdit = useCallback(async (messageId: string, updatedContent: MessageContent) => {
    if (state.status === 'streaming') {
      actions.stopStreaming();
    }

    const idx = state.messages.findIndex(m => m.id === messageId);
    if (idx === -1) return;

    const baseMessages = [
      ...state.messages.slice(0, idx),
      { ...state.messages[idx], content: updatedContent }
    ];

    actions.setMessages(baseMessages);
    actions.cancelEdit();

    if (baseMessages.length && baseMessages[baseMessages.length - 1].role === 'user') {
      actions.regenerate(baseMessages);
    }
  }, [state.messages, state.status, actions]);

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

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const sidebarTitle = state.conversations.find(convo => convo.id === state.conversationId)?.title?.trim();
    const activeTitle = (state.currentConversationTitle ?? sidebarTitle)?.trim();
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
  }, [pathname, searchKey, state.conversationId, state.conversations, state.currentConversationTitle]);

  return (
    <div className="flex h-dvh max-h-dvh bg-gradient-to-br from-slate-50 via-white to-slate-100/40 dark:from-neutral-950 dark:via-neutral-950 dark:to-neutral-900/20">
      {state.historyEnabled && (
        <ChatSidebar
          conversations={state.conversations}
          nextCursor={state.nextCursor}
          loadingConversations={state.loadingConversations}
          conversationId={state.conversationId}
          collapsed={state.sidebarCollapsed}
          onSelectConversation={actions.selectConversation}
          onDeleteConversation={actions.deleteConversation}
          onLoadMore={actions.loadMoreConversations}
          onRefresh={actions.refreshConversations}
          onNewChat={actions.newChat}
          onToggleCollapse={actions.toggleSidebar}
        />
      )}
      <div className="flex flex-col flex-1">
        <ChatHeader
          isStreaming={state.status === 'streaming'}
          onNewChat={actions.newChat}
          model={state.model}
          onModelChange={actions.setModel}
          onProviderChange={actions.setProviderId}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onShowLogin={handleShowLogin}
          onShowRegister={handleShowRegister}
          onRefreshModels={actions.loadProvidersAndModels}
          isLoadingModels={state.isLoadingModels}
          groups={state.modelGroups}
          fallbackOptions={state.modelOptions}
          modelToProvider={state.modelToProvider}
        />
        <div className="flex flex-1 min-h-0">
          <div className="flex flex-col flex-1 relative">
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
              onRetryMessage={handleRetryMessage}
            />
            {/* Removed soft fade to keep a cleaner boundaryless look */}
      <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 w-full max-w-4xl px-6 z-30">
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
                enabledTools={state.enabledTools}
                onEnabledToolsChange={actions.setEnabledTools}
                onShouldStreamChange={actions.setShouldStream}
                model={state.model}
                qualityLevel={state.qualityLevel}
                onQualityLevelChange={actions.setQualityLevel}
                modelCapabilities={state.modelCapabilities}
                images={state.images}
                onImagesChange={actions.setImages}
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
          {!state.rightSidebarCollapsed && (
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
            userId={state.user?.id}
            conversationId={state.conversationId || undefined}
            collapsed={state.rightSidebarCollapsed}
            onToggleCollapse={actions.toggleRightSidebar}
            onEffectivePromptChange={actions.setInlineSystemPromptOverride}
            onActivePromptIdChange={actions.setActiveSystemPromptId}
            conversationActivePromptId={state.activeSystemPromptId}
            conversationSystemPrompt={state.systemPrompt}
            width={rightSidebarWidth}
            isResizing={isResizingRightSidebar}
          />
        </div>
      </div>
    </div>
  );
}
