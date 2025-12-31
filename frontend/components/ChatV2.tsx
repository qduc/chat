'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ArrowUp, ArrowDown, Bot } from 'lucide-react';
import { useChat } from '../hooks/useChat';
import { ChatSidebar } from './ChatSidebar';
import { ChatHeader } from './ChatHeader';
import { MessageList } from './MessageList';
import { MessageInput, type MessageInputRef } from './MessageInput';
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
  const messageListRef = useRef<HTMLDivElement>(null!);
  const [scrollButtons, setScrollButtons] = useState({ showTop: false, showBottom: false });
  const [showScrollButtons, setShowScrollButtons] = useState(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isLoadingConversationRef = useRef(false);
  const messageInputRef = useRef<MessageInputRef>(null);
  const messageInputContainerRef = useRef<HTMLDivElement>(null);
  const [messageInputHeight, setMessageInputHeight] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const hasCheckedMobileRef = useRef(false);

  const modelAvailability = useMemo(() => {
    if (chat.isLoadingModels || chat.modelOptions.length === 0) {
      return { locked: false, missing: [] as string[] };
    }

    const optionValues = new Set(chat.modelOptions.map((option) => option.value));
    const resolveModel = (modelId: string) => {
      if (!modelId) return null;
      if (optionValues.has(modelId)) return modelId;

      if (!modelId.includes('::')) {
        const providerId = chat.modelToProvider[modelId] || '';
        if (providerId) {
          const qualified = `${providerId}::${modelId}`;
          if (optionValues.has(qualified)) return qualified;
        }

        const suffixMatch = chat.modelOptions.find((option) =>
          option.value.endsWith(`::${modelId}`)
        );
        if (suffixMatch) return suffixMatch.value;
      }

      return null;
    };

    const candidates = [chat.model, ...chat.compareModels].filter(Boolean);
    const missing: string[] = [];
    const seen = new Set<string>();

    for (const modelId of candidates) {
      if (seen.has(modelId)) continue;
      seen.add(modelId);
      if (!resolveModel(modelId)) {
        missing.push(modelId);
      }
    }

    const hasConversation = chat.messages.length > 0 || !!chat.conversationId;
    const hasComparison = chat.compareModels.length > 0;
    return {
      locked: hasConversation && hasComparison && missing.length > 0,
      missing,
    };
  }, [
    chat.isLoadingModels,
    chat.modelOptions,
    chat.modelToProvider,
    chat.model,
    chat.compareModels,
    chat.messages.length,
    chat.conversationId,
  ]);

  const unavailableModelLabels = useMemo(
    () =>
      modelAvailability.missing.map((modelId) =>
        modelId.includes('::') ? modelId.split('::')[1] : modelId
      ),
    [modelAvailability.missing]
  );
  const modelLockReason = modelAvailability.locked
    ? `Unavailable model${unavailableModelLabels.length === 1 ? '' : 's'}: ${unavailableModelLabels.join(
        ', '
      )}. Refresh models to resume.`
    : undefined;
  const modelSelectionLocked =
    modelAvailability.locked || (chat.messages.length > 0 && chat.compareModels.length > 0);
  const modelSelectionLockReason = modelAvailability.locked
    ? modelLockReason
    : 'Primary model is locked for comparison chats after the first message. Start a new chat to change.';
  const canSend = !modelAvailability.locked;

  const { sidebarCollapsed, rightSidebarCollapsed, toggleSidebar, toggleRightSidebar } = chat;

  // Detect mobile screen size and auto-collapse sidebars on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (hasCheckedMobileRef.current) return;

    const mobile = window.innerWidth < 768; // md breakpoint
    setIsMobile(mobile);

    // Auto-collapse both sidebars on initial mount if mobile
    if (mobile) {
      if (!sidebarCollapsed) {
        toggleSidebar();
      }
      if (!rightSidebarCollapsed) {
        toggleRightSidebar();
      }
    }

    hasCheckedMobileRef.current = true;
  }, [sidebarCollapsed, rightSidebarCollapsed, toggleSidebar, toggleRightSidebar]);

  // Track window resize for responsive behavior
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Handle scroll button visibility with auto-hide
  useEffect(() => {
    const container = messageListRef.current;
    if (!container) return;

    const handleScroll = () => {
      // Show buttons on scroll activity
      setShowScrollButtons(true);

      // Clear existing timeout
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }

      // Hide buttons after 2 seconds of no scrolling
      scrollTimeoutRef.current = setTimeout(() => {
        setShowScrollButtons(false);
      }, 2000);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      container.removeEventListener('scroll', handleScroll);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

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

  const handleSelectConversation = useCallback(
    async (id: string) => {
      isLoadingConversationRef.current = true;
      await chat.selectConversation(id);
    },
    [chat]
  );

  const handleNewChat = useCallback(() => {
    chat.newChat();
    // Focus the message input after a short delay to ensure the component is ready
    setTimeout(() => {
      messageInputRef.current?.focus();
    }, 0);
  }, [chat]);

  const handleFocusMessageInput = useCallback(() => {
    messageInputRef.current?.focus();
  }, []);

  useEffect(() => {
    const storedWidth =
      typeof window !== 'undefined' ? window.localStorage.getItem('rightSidebarWidth') : null;
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

  const clampRightSidebarWidth = useCallback(
    (value: number) => {
      return Math.min(Math.max(value, MIN_RIGHT_SIDEBAR_WIDTH), MAX_RIGHT_SIDEBAR_WIDTH);
    },
    [MAX_RIGHT_SIDEBAR_WIDTH, MIN_RIGHT_SIDEBAR_WIDTH]
  );

  const scheduleWidthUpdate = useCallback(
    (value: number) => {
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
    },
    [clampRightSidebarWidth]
  );

  const handleResizeMove = useCallback(
    (event: PointerEvent) => {
      if (!isResizingRef.current) return;
      const delta = resizeStateRef.current.startX - event.clientX;
      const nextWidth = resizeStateRef.current.startWidth + delta;
      scheduleWidthUpdate(nextWidth);
    },
    [scheduleWidthUpdate]
  );

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

  const handleResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (chat.rightSidebarCollapsed) return;
      resizeStateRef.current = {
        startX: event.clientX,
        startWidth: rightSidebarWidth,
      };
      isResizingRef.current = true;
      setIsResizingRightSidebar(true);
    },
    [rightSidebarWidth, chat.rightSidebarCollapsed]
  );

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
      isLoadingConversationRef.current = true;
      void chat.selectConversation(cid);
    } else if (!cid && chat.conversationId) {
      chat.newChat();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchKey]);

  const handleRetryMessage = useCallback(
    async (messageId: string) => {
      if (!canSend) return;
      if (chat.status === 'streaming') return;
      if (chat.messages.length === 0) return;

      // Find the message index
      const idx = chat.messages.findIndex((m) => m.id === messageId);
      if (idx === -1) return;

      const message = chat.messages[idx];
      if (message.role !== 'assistant') return;

      // Keep only messages up to (but not including) the message being retried
      const base = chat.messages.slice(0, idx);
      chat.regenerate(base);
    },
    [canSend, chat]
  );

  const handleRetryComparisonModel = useCallback(
    async (messageId: string, modelId: string) => {
      if (!canSend) return;
      if (chat.status === 'streaming') return;
      await chat.retryComparisonModel(messageId, modelId);
    },
    [canSend, chat]
  );

  const handleApplyLocalEdit = useCallback(
    async (messageId: string, updatedContent: MessageContent) => {
      if (!canSend) return;
      if (chat.status === 'streaming') {
        chat.stopStreaming();
      }

      const idx = chat.messages.findIndex((m) => m.id === messageId);
      if (idx === -1) return;

      const baseMessages = [
        ...chat.messages.slice(0, idx),
        { ...chat.messages[idx], content: updatedContent },
      ];

      chat.setMessages(baseMessages);
      chat.cancelEdit();

      if (baseMessages.length && baseMessages[baseMessages.length - 1].role === 'user') {
        chat.regenerate(baseMessages);
      }
    },
    [canSend, chat]
  );

  const handleFork = useCallback(
    (messageId: string, modelId: string) => {
      const idx = chat.messages.findIndex((m) => m.id === messageId);
      if (idx === -1) return;

      const forkModelId = modelId === 'primary' ? chat.model : modelId;
      const newMessages = chat.messages.slice(0, idx + 1).map((message) => {
        if (message.role !== 'assistant') {
          return message.comparisonResults ? { ...message, comparisonResults: undefined } : message;
        }

        if (modelId !== 'primary') {
          const comparison = message.comparisonResults?.[modelId];
          if (comparison) {
            return {
              ...message,
              content: comparison.content ?? '',
              tool_calls: comparison.tool_calls,
              tool_outputs: comparison.tool_outputs,
              message_events: comparison.message_events,
              usage: comparison.usage,
              comparisonResults: undefined,
            };
          }
        }

        return message.comparisonResults ? { ...message, comparisonResults: undefined } : message;
      });

      // Capture current settings to preserve them
      const currentModel = forkModelId || chat.model;
      const currentProviderId = chat.providerId;
      const currentUseTools = chat.useTools;
      const currentEnabledTools = chat.enabledTools;
      const currentShouldStream = chat.shouldStream;
      const currentQualityLevel = chat.qualityLevel;
      const currentSystemPrompt = chat.systemPrompt;
      const currentActiveSystemPromptId = chat.activeSystemPromptId;

      chat.newChat();
      chat.setCompareModels([]);
      chat.setMessages(newMessages);

      // Restore settings
      if (currentModel) chat.setModel(currentModel);
      if (currentModel?.includes('::')) {
        chat.setProviderId(currentModel.split('::')[0]);
      } else if (currentProviderId) {
        chat.setProviderId(currentProviderId);
      }
      chat.setUseTools(currentUseTools);
      chat.setEnabledTools(currentEnabledTools);
      chat.setShouldStream(currentShouldStream);
      chat.setQualityLevel(currentQualityLevel);
      chat.setActiveSystemPromptId(currentActiveSystemPromptId);
      if (currentSystemPrompt !== null) {
        chat.setInlineSystemPromptOverride(currentSystemPrompt);
      }
    },
    [chat]
  );

  const handleGenerate = useCallback(() => {
    if (!canSend) return;
    if (chat.messages.length > 0) {
      chat.regenerate(chat.messages);
    }
  }, [canSend, chat]);

  const showGenerateButton =
    chat.messages.length > 0 &&
    chat.messages[chat.messages.length - 1].role === 'user' &&
    chat.status !== 'streaming' &&
    !chat.pending.streaming &&
    canSend;

  // Load conversations and hydrate from URL on first load
  useEffect(() => {
    if (initCheckedRef.current) return;
    initCheckedRef.current = true;

    // Load conversation list
    chat.refreshConversations();

    const cid = searchParams?.get('c');
    if (cid && !chat.conversationId) {
      initLoadingRef.current = true;
      isLoadingConversationRef.current = true;
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

  // Scroll to bottom when a conversation is loaded (not when first created)
  useEffect(() => {
    if (chat.conversationId && isLoadingConversationRef.current) {
      // Use a timeout to allow the message list to render before scrolling
      setTimeout(() => {
        scrollToBottom('auto');
        // Reset the ref after scrolling
        isLoadingConversationRef.current = false;
      }, 0);
    }
    // We only want to run this when the conversation ID changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.conversationId]);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const sidebarTitle = chat.conversations
      .find((convo) => convo.id === chat.conversationId)
      ?.title?.trim();
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
    if (!canSend) return;
    const messageToSend = chat.input;
    // clear input right away so the UI feels responsive
    chat.setInput('');
    // call sendMessage with the captured content so it doesn't rely on chat.input after clearing
    void chat.sendMessage(messageToSend);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSend, chat.input, chat.setInput, chat.sendMessage]);

  // Scroll functions
  const scrollToTop = useCallback(() => {
    const container = messageListRef.current;
    if (!container) return;
    if (typeof (container as any).scrollTo === 'function') {
      (container as any).scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      container.scrollTop = 0;
    }
  }, []);

  const scrollToBottom = useCallback((behavior: 'smooth' | 'auto' = 'smooth') => {
    const container = messageListRef.current;
    if (!container) return;
    const top = container.scrollHeight;
    if (typeof (container as any).scrollTo === 'function') {
      (container as any).scrollTo({ top, behavior });
    } else {
      container.scrollTop = top;
    }
  }, []);

  const handleSuggestionClick = useCallback(
    (text: string) => {
      chat.setInput(text);
      messageInputRef.current?.focus();
    },
    [chat]
  );

  // Observe MessageInput container height changes
  useEffect(() => {
    const container = messageInputContainerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setMessageInputHeight(entry.contentRect.height);
      }
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, []);

  return (
    <div className="flex h-dvh max-h-dvh bg-white dark:bg-zinc-950 relative overflow-x-hidden">
      {/* Mobile Backdrop */}
      {(!chat.sidebarCollapsed || !chat.rightSidebarCollapsed) && (
        <div
          className="md:hidden fixed inset-0 bg-black/50 z-40 transition-opacity"
          onClick={() => {
            if (!chat.sidebarCollapsed) chat.toggleSidebar();
            if (!chat.rightSidebarCollapsed) chat.toggleRightSidebar();
          }}
          aria-hidden="true"
        />
      )}

      {/* Left Sidebar - Overlay on mobile, static on desktop */}
      {chat.historyEnabled && (
        <div
          className={`
            ${chat.sidebarCollapsed ? '-translate-x-full md:translate-x-0' : 'translate-x-0'}
            fixed md:relative inset-y-0 left-0 z-50 md:z-auto
            transition-transform duration-300 ease-in-out
          `}
        >
          <ChatSidebar
            conversations={chat.conversations}
            nextCursor={chat.nextCursor}
            loadingConversations={chat.loadingConversations}
            conversationId={chat.conversationId}
            collapsed={chat.sidebarCollapsed}
            onSelectConversation={handleSelectConversation}
            onDeleteConversation={chat.deleteConversation}
            onLoadMore={chat.loadMoreConversations}
            onRefresh={chat.refreshConversations}
            onNewChat={handleNewChat}
            onToggleCollapse={chat.toggleSidebar}
            unsavedPlaceholder={!chat.conversationId && chat.messages.length > 0}
          />
        </div>
      )}

      <div className="flex flex-col flex-1 min-w-0">
        <ChatHeader
          isStreaming={chat.status === 'streaming'}
          onNewChat={handleNewChat}
          model={chat.model}
          onModelChange={chat.setModel}
          onProviderChange={chat.setProviderId}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onShowLogin={handleShowLogin}
          onShowRegister={handleShowRegister}
          onRefreshModels={chat.forceRefreshModels}
          isLoadingModels={chat.isLoadingModels}
          groups={chat.modelGroups}
          fallbackOptions={chat.modelOptions}
          modelToProvider={chat.modelToProvider}
          onFocusMessageInput={handleFocusMessageInput}
          onToggleLeftSidebar={chat.toggleSidebar}
          onToggleRightSidebar={chat.toggleRightSidebar}
          showLeftSidebarButton={chat.historyEnabled}
          showRightSidebarButton={true}
          selectedComparisonModels={chat.compareModels}
          onComparisonModelsChange={chat.setCompareModels}
          comparisonLocked={chat.messages.length > 0}
          comparisonLockReason="Model comparison is locked after the first message. Start a new chat to change."
          modelSelectionLocked={modelSelectionLocked}
          modelSelectionLockReason={modelSelectionLockReason}
        />
        <div className="flex flex-1 min-h-0 min-w-0">
          <div className="flex flex-col flex-1 relative min-w-0">
            <MessageList
              messages={chat.messages}
              pending={chat.pending}
              conversationId={chat.conversationId}
              compareModels={chat.compareModels}
              primaryModelLabel={chat.model}
              canSend={canSend}
              editingMessageId={chat.editingMessageId}
              editingContent={chat.editingContent}
              onCopy={handleCopy}
              onEditMessage={chat.startEdit}
              onCancelEdit={chat.cancelEdit}
              onSaveEdit={chat.saveEdit}
              onApplyLocalEdit={handleApplyLocalEdit}
              onEditingContentChange={chat.updateEditContent}
              onRetryMessage={handleRetryMessage}
              onRetryComparisonModel={handleRetryComparisonModel}
              onScrollStateChange={setScrollButtons}
              containerRef={messageListRef}
              onSuggestionClick={handleSuggestionClick}
              onFork={handleFork}
            />

            {/* Scroll Buttons - centered but visually minimal */}
            <div
              className="absolute left-1/2 transform -translate-x-1/2 flex flex-col gap-2 z-10 pointer-events-none transition-[bottom] duration-150"
              style={{
                bottom: `${messageInputHeight + 32}px`, // 32px gap above MessageInput
              }}
            >
              {scrollButtons.showTop && (
                <button
                  onClick={scrollToTop}
                  className={`p-1.5 rounded-full bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-200 border border-zinc-200/70 dark:border-zinc-700/70 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all duration-200 aspect-square ${
                    showScrollButtons
                      ? 'opacity-100 scale-100 pointer-events-auto'
                      : 'opacity-0 scale-95 pointer-events-none'
                  }`}
                  aria-label="Scroll to top"
                  title="Scroll to top"
                >
                  <ArrowUp className="w-3 h-3 sm:w-4 sm:h-4" />
                </button>
              )}
              {scrollButtons.showBottom && (
                <button
                  onClick={() => scrollToBottom()}
                  className={`p-1.5 rounded-full bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-200 border border-zinc-200/70 dark:border-zinc-700/70 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all duration-200 aspect-square ${
                    showScrollButtons
                      ? 'opacity-100 scale-100 pointer-events-auto'
                      : 'opacity-0 scale-95 pointer-events-none'
                  }`}
                  aria-label="Scroll to bottom"
                  title="Scroll to bottom"
                >
                  <ArrowDown className="w-3 h-3 sm:w-4 sm:h-4" />
                </button>
              )}
            </div>

            {/* Removed soft fade to keep a cleaner boundaryless look */}
            <div
              ref={messageInputContainerRef}
              className="absolute bottom-2 sm:bottom-4 left-1/2 transform -translate-x-1/2 w-full max-w-3xl px-2 sm:px-4 md:px-6 z-30"
            >
              {showGenerateButton ? (
                <div className="flex justify-center pb-4">
                  <button
                    onClick={handleGenerate}
                    className="flex items-center gap-2 px-6 py-3 rounded-full bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-medium shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all active:scale-95"
                  >
                    <Bot className="w-5 h-5" />
                    Generate Response
                  </button>
                </div>
              ) : (
                <MessageInput
                  ref={messageInputRef}
                  input={chat.input}
                  pending={chat.pending}
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
                  files={chat.files}
                  onFilesChange={chat.setFiles}
                  disabled={!canSend}
                  disabledReason={modelLockReason}
                />
              )}
            </div>
            <SettingsModal
              open={isSettingsOpen}
              onClose={() => setIsSettingsOpen(false)}
              onProvidersChanged={chat.loadProvidersAndModels}
              modelGroups={chat.modelGroups}
              modelOptions={chat.modelOptions}
            />
            <AuthModal
              open={showAuthModal}
              onClose={() => setShowAuthModal(false)}
              initialMode={authMode}
            />
          </div>
          {/* Right Sidebar Resize Handle - Desktop only */}
          {!chat.rightSidebarCollapsed && (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize right sidebar"
              className={`hidden md:block flex-shrink-0 self-stretch w-1 cursor-col-resize select-none transition-colors duration-150 ${isResizingRightSidebar ? 'bg-zinc-400/60 dark:bg-zinc-600/60' : 'bg-transparent hover:bg-zinc-400/40 dark:hover:bg-zinc-600/40'}`}
              onPointerDown={handleResizeStart}
              onDoubleClick={handleResizeDoubleClick}
            />
          )}

          {/* Right Sidebar - Overlay on mobile, static on desktop */}
          <div
            className={`
              ${chat.rightSidebarCollapsed ? 'translate-x-full md:translate-x-0' : 'translate-x-0'}
              fixed md:relative inset-y-0 right-0 z-50 md:z-auto
              transition-transform duration-300 ease-in-out
            `}
          >
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
    </div>
  );
}
