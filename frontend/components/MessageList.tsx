/**
 * MessageList - Container component for message rendering
 * Orchestrates message display, editing, and judge functionality
 */

import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { AlertCircle } from 'lucide-react';
import { useToast } from './ui/Toast';
import { Message, JudgeModal, MAX_COMPARISON_COLUMNS } from './message';
import type { PendingState, EvaluationDraft } from '../hooks/useChat';
import {
  images,
  createMixedContent,
  extractImagesFromContent,
  type ChatMessage,
  type MessageContent,
  type ImageAttachment,
  type ImageContent,
} from '../lib';
import type { Evaluation } from '../lib/types';
import { useStreamingScroll } from '../hooks/useStreamingScroll';
import { useIsMobile } from '../hooks/useIsMobile';
import { WelcomeMessage } from './WelcomeMessage';
import { useAuth } from '../contexts/AuthContext';

interface MessageListProps {
  messages: ChatMessage[];
  pending: PendingState;
  conversationId: string | null;
  compareModels: string[];
  primaryModelLabel: string | null;
  modelGroups: Array<{
    id: string;
    label: string;
    options: Array<{ value: string; label: string }>;
  }>;
  modelOptions: Array<{ value: string; label: string }>;
  linkedConversations: Record<string, string>;
  evaluations: Evaluation[];
  evaluationDrafts: EvaluationDraft[];
  canSend: boolean;
  editingMessageId: string | null;
  editingContent: string;
  onCopy: (text: string) => void;
  onEditMessage: (messageId: string, content: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onApplyLocalEdit: (messageId: string, content: MessageContent) => void;
  onEditingContentChange: (content: string) => void;
  onRetryMessage: (messageId: string) => void;
  onRetryComparisonModel?: (messageId: string, modelId: string) => void;
  onScrollStateChange?: (state: { showTop: boolean; showBottom: boolean }) => void;
  containerRef?: React.RefObject<HTMLDivElement>;
  onSuggestionClick?: (text: string) => void;
  onFork?: (messageId: string, modelId: string) => void;
  onJudge?: (options: {
    messageId: string;
    selectedModelIds: string[];
    judgeModelId: string;
    criteria?: string | null;
  }) => Promise<unknown>;
  onDeleteJudgeResponse: (id: string) => Promise<void>;
}

export function MessageList({
  messages,
  pending,
  conversationId,
  compareModels,
  primaryModelLabel,
  modelGroups,
  modelOptions,
  linkedConversations,
  evaluations,
  evaluationDrafts,
  canSend,
  editingMessageId,
  editingContent,
  onCopy,
  onEditMessage,
  onCancelEdit,
  onApplyLocalEdit,
  onEditingContentChange,
  onRetryMessage,
  onRetryComparisonModel,
  onScrollStateChange,
  containerRef: externalContainerRef,
  onSuggestionClick,
  onFork,
  onJudge,
  onDeleteJudgeResponse,
}: MessageListProps) {
  const { showToast } = useToast();
  const { user } = useAuth();
  const userId = user?.id;
  const judgeModelStorageKey = userId
    ? `chatforge-last-judge-model_${userId}`
    : 'chatforge-last-judge-model';

  const internalContainerRef = useRef<HTMLDivElement | null>(null);
  const containerRef = externalContainerRef || internalContainerRef;
  const editingTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // State
  const [collapsedToolOutputs, setCollapsedToolOutputs] = useState<Record<string, boolean>>({});
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [selectedComparisonModels, setSelectedComparisonModels] = useState<string[]>(['primary']);
  const [editingImages, setEditingImages] = useState<ImageAttachment[]>([]);
  const [streamingStats, setStreamingStats] = useState<{
    tokensPerSecond: number;
    isEstimate?: boolean;
  } | null>(null);

  // Judge modal state
  const [isJudgeModalOpen, setIsJudgeModalOpen] = useState(false);
  const [judgeMessageId, setJudgeMessageId] = useState<string | null>(null);
  const [judgeModelId, setJudgeModelId] = useState<string>('');

  // Load judge model from localStorage when user changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(judgeModelStorageKey);
      setJudgeModelId(saved || '');
    }
  }, [judgeModelStorageKey]);

  // Refs for tracking
  const initializedComparisonRef = useRef<string | null>(null);
  const prevConversationIdRef = useRef<string | null>(null);
  const lastTokenStatsMessageIdRef = useRef<string | null>(null);

  const isMobile = useIsMobile();
  const effectiveSelectedModels = isMobile
    ? [selectedComparisonModels[0] || 'primary']
    : selectedComparisonModels;
  const hasMultiColumnLayout = effectiveSelectedModels.length > 1;

  const { dynamicBottomPadding, lastUserMessageRef, toolbarRef, bottomRef } = useStreamingScroll(
    messages,
    pending,
    containerRef
  );

  // Available models for judging
  const judgeAvailableModels = useMemo(() => {
    if (!judgeMessageId) return [] as string[];
    const target = messages.find((msg) => msg.id === judgeMessageId);
    const comparisonModelIds = target ? Object.keys(target.comparisonResults || {}) : [];
    return ['primary', ...comparisonModelIds];
  }, [judgeMessageId, messages]);

  // First assistant message ID for showing comparison tabs
  const firstAssistantMessageId = useMemo(() => {
    const firstAssistant = messages.find((message) => message.role === 'assistant');
    return firstAssistant?.id ?? null;
  }, [messages]);

  // Initialize editing images when entering edit mode
  useEffect(() => {
    if (editingMessageId) {
      const message = messages.find((m) => m.id === editingMessageId);
      if (message) {
        const imageContents = extractImagesFromContent(message.content);
        const attachments: ImageAttachment[] = imageContents.map((img, idx) => ({
          id: `edit-${editingMessageId}-${idx}`,
          file: new File([], 'image'),
          url: img.image_url.url,
          name: `Image ${idx + 1}`,
          size: 0,
          type: 'image/*',
          downloadUrl: img.image_url.url,
        }));
        setEditingImages(attachments);
      }
    } else {
      setEditingImages([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingMessageId]);

  // Reset comparison selection on conversation change
  useEffect(() => {
    if (prevConversationIdRef.current !== conversationId) {
      prevConversationIdRef.current = conversationId;
      initializedComparisonRef.current = null;
      setSelectedComparisonModels(['primary']);
    }
  }, [conversationId]);

  // Initialize comparison model selection
  useEffect(() => {
    if (initializedComparisonRef.current === conversationId) return;
    if (messages.length === 0) return;

    const allComparisonModels = new Set<string>();
    messages.forEach((m) => {
      if (m.comparisonResults) {
        Object.keys(m.comparisonResults).forEach((modelId) => {
          allComparisonModels.add(modelId);
        });
      }
    });

    if (allComparisonModels.size === 0) return;

    initializedComparisonRef.current = conversationId;
    const modelsToSelect = ['primary', ...Array.from(allComparisonModels)].slice(
      0,
      MAX_COMPARISON_COLUMNS
    );
    setSelectedComparisonModels(modelsToSelect);
  }, [conversationId, messages]);

  // Track streaming statistics
  useEffect(() => {
    const stats = pending.tokenStats;

    if (!stats) {
      lastTokenStatsMessageIdRef.current = null;
      setStreamingStats(null);
      return;
    }

    if (stats.messageId !== lastTokenStatsMessageIdRef.current) {
      lastTokenStatsMessageIdRef.current = stats.messageId;
      setStreamingStats(null);
    }

    const { count, startTime, lastUpdated, isEstimate } = stats;

    if (!Number.isFinite(startTime) || count <= 0) return;

    const endTimestamp =
      pending.streaming || !Number.isFinite(lastUpdated) ? Date.now() : lastUpdated;
    const elapsedSeconds = (endTimestamp - startTime) / 1000;

    if (elapsedSeconds <= 0.1) return;

    const tokensPerSecond = count / elapsedSeconds;

    if (!Number.isFinite(tokensPerSecond) || tokensPerSecond <= 0) return;

    setStreamingStats({ tokensPerSecond, isEstimate });
  }, [
    pending.streaming,
    pending.tokenStats,
    pending.tokenStats?.messageId,
    pending.tokenStats?.count,
    pending.tokenStats?.isEstimate,
    pending.tokenStats?.startTime,
    pending.tokenStats?.lastUpdated,
  ]);

  // Resize editing textarea
  useEffect(() => {
    const ta = editingTextareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight + 2}px`;
  }, [editingContent, editingMessageId]);

  // Track scroll position
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !onScrollStateChange) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const threshold = 100;

      onScrollStateChange({
        showTop: scrollTop > threshold,
        showBottom: scrollTop < scrollHeight - clientHeight - threshold,
      });
    };

    handleScroll();
    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [messages.length, onScrollStateChange, containerRef]);

  // Handlers
  const handleToggleComparisonModel = useCallback(
    (modelId: string, event?: React.MouseEvent) => {
      if (isMobile) {
        setSelectedComparisonModels([modelId]);
        return;
      }

      const isSoloClick = event?.metaKey || event?.ctrlKey;

      if (isSoloClick) {
        setSelectedComparisonModels([modelId]);
        return;
      }

      setSelectedComparisonModels((prev) => {
        if (prev.includes(modelId)) {
          if (prev.length === 1) return prev;
          return prev.filter((m) => m !== modelId);
        }
        if (prev.length >= MAX_COMPARISON_COLUMNS) return prev;
        return [...prev, modelId];
      });
    },
    [isMobile]
  );

  const handleSelectAllComparisonModels = useCallback((models: string[]) => {
    setSelectedComparisonModels(models.slice(0, MAX_COMPARISON_COLUMNS));
  }, []);

  const handleEditingImageFiles = useCallback(async (files: File[]) => {
    try {
      const uploadedImages = await images.uploadImages(files, () => {});
      setEditingImages((prev) => [...prev, ...uploadedImages]);
    } catch (error) {
      console.error('Image upload failed during editing:', error);
    }
  }, []);

  const handleRemoveEditingImage = useCallback(
    (imageId: string) => {
      const imageToRemove = editingImages.find((img) => img.id === imageId);
      if (imageToRemove && imageToRemove.url.startsWith('blob:')) {
        images.revokePreviewUrl(imageToRemove.url);
      }
      setEditingImages((prev) => prev.filter((img) => img.id !== imageId));
    },
    [editingImages]
  );

  const handleEditingPaste = useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = Array.from(event.clipboardData?.items || []);
      const files: File[] = [];

      items.forEach((item) => {
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file && file.type.startsWith('image/')) {
            files.push(file);
          }
        }
      });

      if (files.length === 0) {
        const fileList = Array.from(event.clipboardData?.files || []);
        fileList.forEach((file) => {
          if (file.type.startsWith('image/')) {
            files.push(file);
          }
        });
      }

      if (files.length > 0) {
        event.preventDefault();
        void handleEditingImageFiles(files);
      }
    },
    [handleEditingImageFiles]
  );

  const handleEditingImageUploadClick = useCallback(() => {
    if (!canSend) return;
    fileInputRef.current?.click();
  }, [canSend]);

  const handleRetryMessage = useCallback(
    (messageId: string) => {
      if (!canSend) return;
      setStreamingStats(null);
      onRetryMessage(messageId);
    },
    [canSend, onRetryMessage]
  );

  const handleApplyLocalEdit = useCallback(
    (messageId: string) => {
      if (!canSend) return;
      setStreamingStats(null);

      const trimmedText = editingContent.trim();
      const imageContents: ImageContent[] = editingImages.map((img) => ({
        type: 'image_url' as const,
        image_url: {
          url: img.downloadUrl || img.url,
          detail: 'auto' as const,
        },
      }));

      if (!trimmedText && imageContents.length === 0) return;

      const nextContent =
        imageContents.length > 0 ? createMixedContent(trimmedText, imageContents) : trimmedText;

      onApplyLocalEdit(messageId, nextContent);
    },
    [canSend, editingContent, editingImages, onApplyLocalEdit]
  );

  const handleCopy = useCallback(
    (messageId: string, text: string) => {
      onCopy(text);
      setCopiedMessageId(messageId);
      setTimeout(() => setCopiedMessageId(null), 2000);
    },
    [onCopy]
  );

  const resizeEditingTextarea = useCallback(() => {
    const ta = editingTextareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight + 2}px`;
  }, []);

  const openJudgeModal = useCallback(
    (messageId: string, comparisonModelIds: string[]) => {
      if (!onJudge || comparisonModelIds.length === 0) return;
      setJudgeMessageId(messageId);
      const fallbackModel = modelOptions[0]?.value || '';

      // Use the persisted judgeModelId if available, otherwise use fallbackModel
      // We explicitly avoid using primaryModelLabel here to prevent coupling
      const defaultJudgeModel = judgeModelId || fallbackModel;
      if (defaultJudgeModel !== judgeModelId) {
        setJudgeModelId(defaultJudgeModel);
      }

      setIsJudgeModalOpen(true);
    },
    [modelOptions, onJudge, judgeModelId]
  );

  const closeJudgeModal = useCallback(() => {
    setIsJudgeModalOpen(false);
  }, []);

  const handleJudgeConfirm = useCallback(
    (options: { judgeModelId: string; selectedModelIds: string[]; criteria: string | null }) => {
      if (!onJudge || !judgeMessageId) return;

      setIsJudgeModalOpen(false);

      // Persist the selected judge model
      setJudgeModelId(options.judgeModelId);
      if (typeof window !== 'undefined') {
        localStorage.setItem(judgeModelStorageKey, options.judgeModelId);
      }

      void onJudge({
        messageId: judgeMessageId,
        selectedModelIds: options.selectedModelIds,
        judgeModelId: options.judgeModelId,
        criteria: options.criteria,
      }).catch((err) => {
        const message = err instanceof Error ? err.message : 'Failed to judge responses';
        showToast({ message, variant: 'error' });
      });
    },
    [judgeMessageId, judgeModelStorageKey, onJudge, showToast]
  );

  return (
    <>
      <JudgeModal
        isOpen={isJudgeModalOpen}
        onClose={closeJudgeModal}
        onConfirm={handleJudgeConfirm}
        availableModels={judgeAvailableModels}
        primaryModelLabel={primaryModelLabel}
        modelGroups={modelGroups}
        modelOptions={modelOptions}
        initialJudgeModelId={judgeModelId}
      />

      <main
        ref={containerRef}
        className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-track-transparent relative"
        style={{ willChange: 'scroll-position' }}
      >
        <div
          className={`w-full mx-auto px-4 sm:px-4 md:px-6 py-6 space-y-6 ${hasMultiColumnLayout ? 'max-w-6xl' : 'max-w-3xl'}`}
          style={{ paddingBottom: dynamicBottomPadding }}
        >
          {messages.length === 0 && <WelcomeMessage onSuggestionClick={onSuggestionClick} />}
          {messages.map((m, idx) => {
            const isUser = m.role === 'user';
            const isStreaming = pending.streaming && idx === messages.length - 1;
            const isLastAssistantMessage = !isUser && idx === messages.length - 1;
            const isRecentUserMessage =
              isUser &&
              (idx === messages.length - 1 ||
                (idx === messages.length - 2 &&
                  messages[messages.length - 1]?.role === 'assistant'));

            return (
              <Message
                key={m.id}
                message={m}
                isStreaming={isStreaming}
                conversationId={conversationId}
                compareModels={compareModels}
                primaryModelLabel={primaryModelLabel}
                linkedConversations={linkedConversations}
                evaluations={evaluations}
                evaluationDrafts={evaluationDrafts}
                canSend={canSend}
                editingMessageId={editingMessageId}
                editingContent={editingContent}
                onCopy={onCopy}
                onEditMessage={onEditMessage}
                onCancelEdit={onCancelEdit}
                onApplyLocalEdit={handleApplyLocalEdit}
                onEditingContentChange={onEditingContentChange}
                onRetryMessage={handleRetryMessage}
                onRetryComparisonModel={onRetryComparisonModel}
                editingTextareaRef={editingTextareaRef}
                lastUserMessageRef={isRecentUserMessage ? lastUserMessageRef : null}
                toolbarRef={isRecentUserMessage ? toolbarRef : undefined}
                resizeEditingTextarea={resizeEditingTextarea}
                collapsedToolOutputs={collapsedToolOutputs}
                setCollapsedToolOutputs={setCollapsedToolOutputs}
                copiedMessageId={copiedMessageId}
                handleCopy={handleCopy}
                pending={pending}
                streamingStats={isLastAssistantMessage ? streamingStats : null}
                editingImages={editingImages}
                onEditingImagesChange={handleEditingImageFiles}
                onRemoveEditingImage={handleRemoveEditingImage}
                onEditingPaste={handleEditingPaste}
                onEditingImageUploadClick={handleEditingImageUploadClick}
                fileInputRef={fileInputRef}
                onFork={onFork}
                selectedComparisonModels={effectiveSelectedModels}
                onToggleComparisonModel={handleToggleComparisonModel}
                onSelectAllComparisonModels={handleSelectAllComparisonModels}
                isMobile={isMobile}
                showComparisonTabs={m.id === firstAssistantMessageId}
                onOpenJudgeModal={openJudgeModal}
                onDeleteJudgeResponse={onDeleteJudgeResponse}
              />
            );
          })}
          {pending.error && (
            <div className="flex items-start gap-3 text-base text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded-xl px-4 py-3 shadow-sm">
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <div>
                <div className="font-medium mb-1">Error occurred</div>
                <div className="text-red-600 dark:text-red-400">{pending.error}</div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </main>
    </>
  );
}
