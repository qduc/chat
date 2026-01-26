/**
 * Types for message components
 */

import type { ChatMessage, ImageContent, ImageAttachment, MessageContent } from '../../lib/types';
import type { PendingState, EvaluationDraft } from '../../hooks/useChat';
import type { Evaluation } from '../../lib/types';

// Tool output type from ChatMessage
export type ToolOutput = NonNullable<ChatMessage['tool_outputs']>[number];

// Segment types for rendering assistant messages
export type AssistantSegment =
  | { kind: 'text'; text: string }
  | { kind: 'tool_call'; toolCall: any; outputs: ToolOutput[] }
  | { kind: 'images'; images: ImageContent[] };

// Context value for message-related state
export interface MessageContextValue {
  // State
  collapsedToolOutputs: Record<string, boolean>;
  copiedMessageId: string | null;
  selectedComparisonModels: string[];
  isMobile: boolean;

  // Handlers
  setCollapsedToolOutputs: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  handleCopy: (messageId: string, text: string) => void;
  onToggleComparisonModel: (modelId: string, event?: React.MouseEvent) => void;
  onSelectAllComparisonModels: (models: string[]) => void;

  // Props passed through
  canSend: boolean;
  pending: PendingState;
  primaryModelLabel: string | null;
  linkedConversations: Record<string, string>;
  evaluations: Evaluation[];
  evaluationDrafts: EvaluationDraft[];
  onFork?: (messageId: string, modelId: string) => void;
  onRetryMessage?: (messageId: string) => void;
  onRetryComparisonModel?: (messageId: string, modelId: string) => void;
  onOpenJudgeModal?: (messageId: string, comparisonModelIds: string[]) => void;
  onDeleteJudgeResponse: (id: string) => Promise<void>;
}

// Props for individual message component
export interface MessageProps {
  message: ChatMessage;
  isStreaming: boolean;
  conversationId: string | null;
  compareModels: string[];
  primaryModelLabel: string | null;
  linkedConversations: Record<string, string>;
  evaluations: Evaluation[];
  evaluationDrafts: EvaluationDraft[];
  canSend: boolean;
  editingMessageId: string | null;
  editingContent: string;
  onCopy: (text: string) => void;
  onEditMessage: (messageId: string, content: string) => void;
  onCancelEdit: () => void;
  onApplyLocalEdit: (messageId: string) => void;
  onEditingContentChange: (content: string) => void;
  onRetryMessage?: (messageId: string) => void;
  onRetryComparisonModel?: (messageId: string, modelId: string) => void;
  editingTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
  lastUserMessageRef: React.RefObject<HTMLDivElement | null> | null;
  resizeEditingTextarea: () => void;
  collapsedToolOutputs: Record<string, boolean>;
  setCollapsedToolOutputs: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  copiedMessageId: string | null;
  handleCopy: (messageId: string, text: string) => void;
  pending: PendingState;
  streamingStats: { tokensPerSecond: number; isEstimate?: boolean } | null;
  // Image editing support
  editingImages: ImageAttachment[];
  onEditingImagesChange: (files: File[]) => void;
  onRemoveEditingImage: (imageId: string) => void;
  onEditingPaste: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onEditingImageUploadClick: () => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  toolbarRef?: React.RefObject<HTMLDivElement | null>;
  onFork?: (messageId: string, modelId: string) => void;
  selectedComparisonModels: string[];
  onToggleComparisonModel: (modelId: string, event?: React.MouseEvent) => void;
  onSelectAllComparisonModels: (models: string[]) => void;
  isMobile: boolean;
  showComparisonTabs: boolean;
  onOpenJudgeModal?: (messageId: string, comparisonModelIds: string[]) => void;
  onDeleteJudgeResponse: (id: string) => Promise<void>;
}

// Model display data for rendering
export interface ModelDisplayData {
  modelId: string;
  displayMessage: ChatMessage;
  isModelStreaming: boolean;
  isModelError: boolean;
  error?: string;
  assistantSegments: AssistantSegment[];
}

// Maximum number of model columns to display side-by-side
export const MAX_COMPARISON_COLUMNS = 3;
