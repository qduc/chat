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
  mergeToolOutputsToAssistantMessages,
  type ChatMessage,
  type ConversationBranch,
  type MessageContent,
  type ImageAttachment,
  type ImageContent,
} from '../lib';
import type { Evaluation, MessageRevision } from '../lib/types';
import { useStreamingScroll } from '../hooks/useStreamingScroll';
import { useIsMobile } from '../hooks/useIsMobile';
import { WelcomeMessage } from './WelcomeMessage';
import { useAuth } from '../contexts/AuthContext';
import { conversations as conversationsApi } from '../lib/api';
import type { RevisionNavProps } from './message/types';

interface MessageListProps {
  messages: ChatMessage[];
  pending: PendingState;
  error?: string | null;
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
  onRetryMessage: (messageId: string, timelineMessages?: ChatMessage[]) => void;
  onRetryComparisonModel?: (messageId: string, modelId: string) => void;
  onScrollStateChange?: (state: { showTop: boolean; showBottom: boolean }) => void;
  containerRef?: React.RefObject<HTMLDivElement>;
  onSuggestionClick?: (text: string) => void;
  onFork?: (messageId: string, modelId: string, timelineMessages?: ChatMessage[]) => void;
  activeBranchId?: string | null;
  branches?: ConversationBranch[];
  onSwitchBranch?: (branchId: string) => Promise<unknown> | void;
  branchModeEnabled?: boolean;
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
  error = null,
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
  activeBranchId = null,
  branches = [],
  onSwitchBranch,
  branchModeEnabled = false,
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
  const [switchingVersionKey, setSwitchingVersionKey] = useState<string | null>(null);
  const [streamingStats, setStreamingStats] = useState<{
    tokensPerSecond: number;
    isEstimate?: boolean;
  } | null>(null);

  // Revision state - keyed by message ID, reset on conversation change
  type RevEntry = {
    slot: number;
    revisions: MessageRevision[] | null;
    loading: boolean;
    allRevisions?: MessageRevision[] | null;
  };
  const [editRevState, setEditRevState] = useState<Record<string, RevEntry>>({});
  const [regenRevState, setRegenRevState] = useState<Record<string, RevEntry>>({});

  const contentKey = useCallback((content: MessageContent | null | undefined) => {
    return JSON.stringify(content ?? null);
  }, []);

  const filterRevisions = useCallback(
    (
      revisions: MessageRevision[],
      operationType: MessageRevision['operation_type'],
      anchorContent?: MessageContent | null
    ) =>
      revisions.filter(
        (revision) =>
          revision.operation_type === operationType &&
          (anchorContent === undefined ||
            contentKey(revision.anchor_content) === contentKey(anchorContent))
      ),
    [contentKey]
  );

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
  const prevTimelineSignatureRef = useRef<string | null>(null);
  const lastTokenStatsMessageIdRef = useRef<string | null>(null);

  // Reset revision state on conversation change
  useEffect(() => {
    if (prevConversationIdRef.current !== conversationId) {
      setEditRevState({});
      setRegenRevState({});
      prevTimelineSignatureRef.current = null;
    }
  }, [conversationId]);

  const timelineSignature = useMemo(
    () =>
      messages
        .map((message) =>
          [
            message.id,
            message.role,
            message.edit_revision_count ?? 0,
            message.regenerate_revision_count ?? 0,
            message.anchor_user_message_id ?? '',
            message.role === 'user' ? contentKey(message.content) : '',
          ].join(':')
        )
        .join('|'),
    [messages, contentKey]
  );

  useEffect(() => {
    const prevSignature = prevTimelineSignatureRef.current;
    if (prevSignature != null && prevSignature !== timelineSignature) {
      setEditRevState({});
      setRegenRevState({});
    }
    prevTimelineSignatureRef.current = timelineSignature;
  }, [timelineSignature]);

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
  const branchById = useMemo(
    () => new Map(branches.map((branch) => [branch.id, branch])),
    [branches]
  );

  const switchBranchVersion = useCallback(
    async (branchId: string, versionKey: string) => {
      if (!onSwitchBranch || !branchId) return;
      setSwitchingVersionKey(versionKey);
      try {
        await onSwitchBranch(branchId);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to switch branches';
        showToast({ message, variant: 'error' });
      } finally {
        setSwitchingVersionKey(null);
      }
    },
    [onSwitchBranch, showToast]
  );

  const getBaseVersionBranchId = useCallback(
    (
      currentBranchId: string,
      operationType: ConversationBranch['operation_type'],
      branchPointMessageId: number | null
    ) => {
      const visited = new Set<string>();
      let branch = branchById.get(currentBranchId) ?? null;
      while (branch) {
        if (visited.has(branch.id)) break; // cycle guard
        visited.add(branch.id);
        const parent = branch.parent_branch_id
          ? (branchById.get(branch.parent_branch_id) ?? null)
          : null;
        if (
          branch.operation_type === operationType &&
          branch.branch_point_message_id === branchPointMessageId &&
          parent
        ) {
          if (
            parent.operation_type === operationType &&
            parent.branch_point_message_id === branchPointMessageId
          ) {
            branch = parent;
            continue;
          }
          return parent.id;
        }
        return branch.id;
      }
      return currentBranchId;
    },
    [branchById]
  );

  const buildBranchRevisionNav = useCallback(
    (message: ChatMessage, operationType: 'edit' | 'regenerate'): RevisionNavProps | undefined => {
      const currentBranchId = message.branch_id;
      const isSwitchBlocked = pending.streaming;
      if (!onSwitchBranch || !currentBranchId || branchById.size === 0) {
        return undefined;
      }

      if (!Object.prototype.hasOwnProperty.call(message, '_parentMessageId')) {
        return undefined;
      }

      const branchPointMessageId = message._parentMessageId ?? null;
      const baseBranchId = getBaseVersionBranchId(
        currentBranchId,
        operationType,
        branchPointMessageId
      );
      const versionBranchIds = Array.from(
        new Set([
          baseBranchId,
          ...branches
            .filter(
              (branch) =>
                branch.operation_type === operationType &&
                branch.branch_point_message_id === branchPointMessageId
            )
            .sort((a, b) => {
              const timeDiff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
              return timeDiff !== 0 ? timeDiff : a.id.localeCompare(b.id);
            })
            .map((branch) => branch.id),
        ])
      );

      if (versionBranchIds.length <= 1) {
        return undefined;
      }

      const currentIndex = versionBranchIds.indexOf(currentBranchId);
      if (currentIndex === -1) {
        return undefined;
      }

      const versionKey = `${operationType}:${branchPointMessageId ?? 'root'}`;
      return {
        slot: currentIndex + 1,
        total: versionBranchIds.length,
        onPrev: () => {
          if (isSwitchBlocked) return;
          const target = versionBranchIds[currentIndex - 1];
          if (target) void switchBranchVersion(target, versionKey);
        },
        onNext: () => {
          if (isSwitchBlocked) return;
          const target = versionBranchIds[currentIndex + 1];
          if (target) void switchBranchVersion(target, versionKey);
        },
        loading: switchingVersionKey === versionKey,
        disabled: isSwitchBlocked,
      };
    },
    [
      branches,
      branchById.size,
      getBaseVersionBranchId,
      onSwitchBranch,
      pending.streaming,
      switchBranchVersion,
      switchingVersionKey,
    ]
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

  // ---------------------------------------------------------------------------
  // Revision state helpers
  // ---------------------------------------------------------------------------

  /** Navigate to previous edit revision for a user message */
  const handlePrevEditRevision = useCallback(
    async (msgId: string) => {
      const msg = messages.find((m) => m.id === msgId);
      if (!msg) return;
      const totalSlots = (msg.edit_revision_count ?? 0) + 1;
      const currentSlot = editRevState[msgId]?.slot ?? totalSlots;
      if (currentSlot <= 1) return;
      const nextSlot = currentSlot - 1;

      if (!editRevState[msgId]?.revisions && conversationId) {
        setEditRevState((prev) => ({
          ...prev,
          [msgId]: { slot: nextSlot, revisions: null, loading: true },
        }));
        try {
          const all = await conversationsApi.getMessageRevisions(conversationId, msgId);
          const editRevisions = filterRevisions(all, 'edit');
          setEditRevState((prev) => ({
            ...prev,
            [msgId]: {
              slot: nextSlot,
              revisions: editRevisions,
              allRevisions: all,
              loading: false,
            },
          }));
        } catch {
          setEditRevState((prev) => ({
            ...prev,
            [msgId]: { slot: nextSlot, revisions: [], allRevisions: [], loading: false },
          }));
        }
      } else {
        setEditRevState((prev) => ({
          ...prev,
          [msgId]: { ...(prev[msgId] ?? { revisions: null, loading: false }), slot: nextSlot },
        }));
      }
    },
    [messages, editRevState, conversationId, filterRevisions]
  );

  /** Navigate to next edit revision (toward current) for a user message */
  const handleNextEditRevision = useCallback(
    (msgId: string) => {
      const msg = messages.find((m) => m.id === msgId);
      if (!msg) return;
      const totalSlots = (msg.edit_revision_count ?? 0) + 1;
      const currentSlot = editRevState[msgId]?.slot ?? totalSlots;
      if (currentSlot >= totalSlots) return;
      setEditRevState((prev) => ({
        ...prev,
        [msgId]: { ...(prev[msgId] ?? { revisions: null, loading: false }), slot: currentSlot + 1 },
      }));
    },
    [messages, editRevState]
  );

  /** Navigate to previous regen revision for an assistant message */
  const handlePrevRegenRevision = useCallback(
    async (msg: ChatMessage) => {
      const assistantMsgId = msg.id;
      const totalSlots = (msg.regenerate_revision_count ?? 0) + 1;
      const currentSlot = regenRevState[assistantMsgId]?.slot ?? totalSlots;
      if (currentSlot <= 1) return;
      const nextSlot = currentSlot - 1;

      if (!regenRevState[assistantMsgId]?.revisions && conversationId) {
        const anchorUserId = msg.anchor_user_message_id;
        if (!anchorUserId) return;
        const branchContent =
          msg._timeline_anchor_content ??
          messages.find((message) => message.id === anchorUserId)?.content ??
          null;

        setRegenRevState((prev) => ({
          ...prev,
          [assistantMsgId]: { slot: nextSlot, revisions: null, loading: true },
        }));
        try {
          const all = await conversationsApi.getMessageRevisions(conversationId, anchorUserId);
          const regenRevisions = filterRevisions(all, 'regenerate', branchContent);
          setRegenRevState((prev) => ({
            ...prev,
            [assistantMsgId]: {
              slot: nextSlot,
              revisions: regenRevisions,
              allRevisions: all,
              loading: false,
            },
          }));
        } catch {
          setRegenRevState((prev) => ({
            ...prev,
            [assistantMsgId]: { slot: nextSlot, revisions: [], allRevisions: [], loading: false },
          }));
        }
      } else {
        setRegenRevState((prev) => ({
          ...prev,
          [assistantMsgId]: {
            ...(prev[assistantMsgId] ?? { revisions: null, loading: false }),
            slot: nextSlot,
          },
        }));
      }
    },
    [messages, regenRevState, conversationId, filterRevisions]
  );

  /** Navigate to next regen revision (toward current) for an assistant message */
  const handleNextRegenRevision = useCallback(
    (msg: ChatMessage) => {
      const assistantMsgId = msg.id;
      const totalSlots = (msg.regenerate_revision_count ?? 0) + 1;
      const currentSlot = regenRevState[assistantMsgId]?.slot ?? totalSlots;
      if (currentSlot >= totalSlots) return;
      setRegenRevState((prev) => ({
        ...prev,
        [assistantMsgId]: {
          ...(prev[assistantMsgId] ?? { revisions: null, loading: false }),
          slot: currentSlot + 1,
        },
      }));
    },
    [regenRevState]
  );

  // ---------------------------------------------------------------------------
  // Display messages - applies revision overrides and injects synthetic follow-ups
  // ---------------------------------------------------------------------------
  const displayMessages = useMemo(() => {
    type DisplayEntry = {
      msg: ChatMessage;
      editRev?: RevisionNavProps;
      regenRev?: RevisionNavProps;
    };

    if (branchModeEnabled) {
      return messages.map((msg) => ({
        msg,
        editRev: msg.role === 'user' ? buildBranchRevisionNav(msg, 'edit') : undefined,
        regenRev: msg.role === 'assistant' ? buildBranchRevisionNav(msg, 'regenerate') : undefined,
      }));
    }

    const result: DisplayEntry[] = [];
    let skipUntilNextUser = false;
    let pendingSynthetics: DisplayEntry[] = [];

    for (const msg of messages) {
      if (msg.role === 'user') {
        // Before starting a new user block, flush any pending synthetic messages
        result.push(...pendingSynthetics);
        pendingSynthetics = [];
        skipUntilNextUser = false;

        const editCount = msg.edit_revision_count ?? 0;
        const totalEditSlots = editCount + 1;
        const editEntry = editRevState[msg.id];
        const editSlot = editEntry?.slot ?? totalEditSlots;
        const isInPastEditSlot = editCount > 0 && editSlot < totalEditSlots;

        let displayMsg = msg;
        if (isInPastEditSlot) {
          const revision = editEntry?.revisions?.[editSlot - 1] ?? null;
          if (revision?.anchor_content != null) {
            displayMsg = { ...msg, content: revision.anchor_content };
          }
          if (revision) {
            // Normalize follow-ups (merges tool outputs, removes tool messages)
            const normalized = mergeToolOutputsToAssistantMessages(revision.follow_ups);
            const branchRegenRevisions = filterRevisions(
              editEntry?.allRevisions ?? [],
              'regenerate',
              revision.anchor_content
            );
            pendingSynthetics = normalized
              .filter((fu: any) => fu.role === 'assistant')
              .map((fu: any, idx: number) => {
                const syntheticMessage: ChatMessage = {
                  id: `synthetic-${revision.id}-${idx}`,
                  role: 'assistant' as const,
                  content: fu.content ?? '',
                  tool_calls: fu.tool_calls ?? undefined,
                  tool_outputs: fu.tool_outputs ?? undefined,
                  reasoning_details: fu.reasoning_details ?? undefined,
                  usage: fu.usage ?? undefined,
                  anchor_user_message_id: msg.id,
                  regenerate_revision_count: branchRegenRevisions.length,
                  _timeline_anchor_content: revision.anchor_content,
                  _historical: true,
                };
                const regenEntry = regenRevState[syntheticMessage.id];
                const totalRegenSlots = branchRegenRevisions.length + 1;
                const regenSlot = regenEntry?.slot ?? totalRegenSlots;
                const isInPastRegenSlot =
                  branchRegenRevisions.length > 0 && regenSlot < totalRegenSlots;
                let displaySynthetic = syntheticMessage;

                if (isInPastRegenSlot && regenEntry?.revisions) {
                  const regenRevision = regenEntry.revisions[regenSlot - 1] ?? null;
                  if (regenRevision) {
                    const historical = mergeToolOutputsToAssistantMessages(
                      regenRevision.follow_ups
                    ).find((entry: any) => entry.role === 'assistant');
                    if (historical) {
                      displaySynthetic = {
                        ...syntheticMessage,
                        content: historical.content ?? '',
                        tool_calls: historical.tool_calls ?? undefined,
                        tool_outputs: historical.tool_outputs ?? undefined,
                        reasoning_details: historical.reasoning_details ?? undefined,
                        usage: historical.usage ?? undefined,
                      };
                    }
                  }
                }

                return {
                  msg: displaySynthetic,
                  regenRev:
                    branchRegenRevisions.length > 0
                      ? {
                          slot: regenSlot,
                          total: totalRegenSlots,
                          onPrev: () => handlePrevRegenRevision(syntheticMessage),
                          onNext: () => handleNextRegenRevision(syntheticMessage),
                          loading: regenEntry?.loading ?? false,
                        }
                      : undefined,
                };
              });
            skipUntilNextUser = true;
          } else if (editEntry?.loading) {
            // Revisions loading: show a placeholder synthetic message
            pendingSynthetics = [
              {
                msg: {
                  id: `synthetic-loading-${msg.id}`,
                  role: 'assistant' as const,
                  content: '',
                  _historical: true,
                },
              },
            ];
            skipUntilNextUser = true;
          }
        }

        const editRev: RevisionNavProps | undefined =
          editCount > 0
            ? {
                slot: editSlot,
                total: totalEditSlots,
                onPrev: () => handlePrevEditRevision(msg.id),
                onNext: () => handleNextEditRevision(msg.id),
                loading: editEntry?.loading ?? false,
              }
            : undefined;

        result.push({ msg: displayMsg, editRev });
      } else if (msg.role === 'assistant') {
        if (skipUntilNextUser) {
          // Real follow-up messages are hidden when showing a past edit revision
          continue;
        }

        const regenCount = msg.regenerate_revision_count ?? 0;
        const totalRegenSlots = regenCount + 1;
        const regenEntry = regenRevState[msg.id];
        const regenSlot = regenEntry?.slot ?? totalRegenSlots;
        const isInPastRegenSlot = regenCount > 0 && regenSlot < totalRegenSlots;

        let displayMsg = msg;
        if (isInPastRegenSlot && regenEntry?.revisions) {
          const revision = regenEntry.revisions[regenSlot - 1] ?? null;
          if (revision) {
            const normalized = mergeToolOutputsToAssistantMessages(revision.follow_ups);
            const firstAssistant = normalized.find((fu: any) => fu.role === 'assistant');
            if (firstAssistant) {
              displayMsg = {
                ...msg,
                content: firstAssistant.content ?? '',
                tool_calls: firstAssistant.tool_calls ?? undefined,
                tool_outputs: firstAssistant.tool_outputs ?? undefined,
                reasoning_details: firstAssistant.reasoning_details ?? undefined,
                usage: firstAssistant.usage ?? undefined,
                _historical: true,
              };
            }
          }
        }

        const regenRev: RevisionNavProps | undefined =
          regenCount > 0
            ? {
                slot: regenSlot,
                total: totalRegenSlots,
                onPrev: () => handlePrevRegenRevision(msg),
                onNext: () => handleNextRegenRevision(msg),
                loading: regenEntry?.loading ?? false,
              }
            : undefined;

        result.push({ msg: displayMsg, regenRev });
      } else if (!skipUntilNextUser) {
        result.push({ msg });
      }
    }

    // Flush synthetic follow-ups at the end of the list
    result.push(...pendingSynthetics);

    return result;
  }, [
    messages,
    editRevState,
    regenRevState,
    filterRevisions,
    handlePrevEditRevision,
    handleNextEditRevision,
    handlePrevRegenRevision,
    handleNextRegenRevision,
    branchModeEnabled,
    buildBranchRevisionNav,
  ]);

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
    (messageId: string, timelineMessages?: ChatMessage[]) => {
      if (!canSend) return;
      setStreamingStats(null);
      onRetryMessage(messageId, timelineMessages);
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

  const sanitizeTimelineMessage = useCallback((message: ChatMessage): ChatMessage => {
    const {
      _historical: _ignoredHistorical,
      _timeline_anchor_content: _ignoredTimelineAnchorContent,
      ...rest
    } = message;
    void _ignoredHistorical;
    void _ignoredTimelineAnchorContent;
    return rest;
  }, []);

  const buildOperationTimeline = useCallback(
    (timeline: ChatMessage[]) => {
      return timeline
        .filter((message) => !message._historical)
        .map((message) => sanitizeTimelineMessage(message));
    },
    [sanitizeTimelineMessage]
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

  const displayedError = pending.error ?? error;

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
          {displayMessages.map(({ msg: m, editRev, regenRev }, idx) => {
            const isUser = m.role === 'user';
            const isStreaming = pending.streaming && idx === displayMessages.length - 1;
            const isLastAssistantMessage = !isUser && idx === displayMessages.length - 1;
            const visibleTimeline = buildOperationTimeline(
              displayMessages.slice(0, idx + 1).map(({ msg }) => msg)
            );
            const isRecentUserMessage =
              isUser &&
              !m._historical &&
              (idx === displayMessages.length - 1 ||
                (idx === displayMessages.length - 2 &&
                  displayMessages[displayMessages.length - 1]?.msg.role === 'assistant'));

            return (
              <Message
                key={m.id}
                message={m}
                isStreaming={isStreaming}
                conversationId={conversationId}
                compareModels={compareModels}
                editRevision={editRev}
                regenRevision={regenRev}
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
                onRetryMessage={
                  m._historical ? undefined : () => handleRetryMessage(m.id, visibleTimeline)
                }
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
                onFork={
                  onFork && !m._historical
                    ? (_messageId, modelId) => onFork(m.id, modelId, visibleTimeline)
                    : undefined
                }
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
          {displayedError && (
            <div className="flex items-start gap-3 text-base text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded-xl px-4 py-3 shadow-sm">
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <div>
                <div className="font-medium mb-1">Error occurred</div>
                <div className="text-red-600 dark:text-red-400">{displayedError}</div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </main>
    </>
  );
}
