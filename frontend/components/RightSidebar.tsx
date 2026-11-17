import React, { useMemo } from 'react';
import { X } from 'lucide-react';
import { IconButton } from './ui/Button';
import { useDetailsSections } from '../hooks/useDetailsSections';
import { useModelInfo } from '../hooks/useModelInfo';
import { SystemPromptSection } from './details/SystemPromptSection';
import { ChatInfoSection } from './details/ChatInfoSection';
import { UsageSection } from './details/UsageSection';
import { SourcesSection } from './details/SourcesSection';
import { FilesSection } from './details/FilesSection';
import { MemorySection } from './details/MemorySection';
import { aggregateUsage, computeContextMeter } from '../lib/usageSummary';
import { extractSources } from '../lib/conversationSources';
import { extractFiles } from '../lib/conversationFiles';
import type { ChatInfo } from '../lib/chatInfo';
import type { ChatMessage } from '../lib/types';

interface RightSidebarProps {
  userId?: string;
  conversationId?: string;
  /** Closes the panel (used by the mobile drawer's close button). */
  onToggleCollapse?: () => void;
  onEffectivePromptChange?: (content: string) => void;
  onActivePromptIdChange?: (promptId: string | null | undefined) => void;
  // Active system prompt ID from loaded conversation
  conversationActivePromptId?: string | null | undefined;
  conversationSystemPrompt?: string | null;
  width?: number;
  /** Settings of the current chat, for the "This chat" section. */
  chatInfo?: ChatInfo;
  /** Messages of the branch being viewed. */
  messages?: ChatMessage[];
}

const EMPTY_MESSAGES: ChatMessage[] = [];

const EMPTY_CHAT_INFO: ChatInfo = {
  modelId: '',
  providerId: null,
  providerName: null,
  reasoningLabel: 'Default',
  tools: [],
  paramsLabel: 'Default',
  streaming: true,
  startedAt: null,
};

/** Chat details panel: system prompt, chat settings, usage, sources, files and memory. */
export function RightSidebar({
  userId,
  conversationId,
  onToggleCollapse,
  onEffectivePromptChange,
  onActivePromptIdChange,
  conversationActivePromptId,
  conversationSystemPrompt,
  width = 320,
  chatInfo = EMPTY_CHAT_INFO,
  messages = EMPTY_MESSAGES,
}: RightSidebarProps) {
  const { open, toggle } = useDetailsSections();

  const usage = useMemo(() => aggregateUsage(messages), [messages]);
  const sources = useMemo(() => extractSources(messages), [messages]);
  const files = useMemo(() => extractFiles(messages), [messages]);
  // Only look up the context window once there is usage to compare it with.
  const modelInfo = useModelInfo(usage.hasUsage ? chatInfo.modelId : '', chatInfo.providerId);
  const meter = computeContextMeter(usage.contextTokens, modelInfo?.context_window);

  const started = messages.length > 0;

  return (
    <aside
      aria-label="Chat details"
      style={{ width: `${width}px`, minWidth: `${width}px` }}
      className="scrollbar-thin relative z-30 flex h-full flex-col overflow-y-auto border-l border-line bg-canvas-subtle"
    >
      {onToggleCollapse ? (
        <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2 md:hidden">
          <span className="px-1 text-sm font-medium text-fg">Chat details</span>
          <IconButton label="Close chat details" size="sm" onClick={onToggleCollapse}>
            <X />
          </IconButton>
        </div>
      ) : null}

      <SystemPromptSection
        open={open.prompt}
        onToggle={() => toggle('prompt')}
        userId={userId}
        conversationId={conversationId}
        onEffectivePromptChange={onEffectivePromptChange}
        onActivePromptIdChange={onActivePromptIdChange}
        conversationActivePromptId={conversationActivePromptId}
        conversationSystemPrompt={conversationSystemPrompt}
      />

      <ChatInfoSection info={chatInfo} open={open.chat} onToggle={() => toggle('chat')} />

      {started ? (
        <>
          {usage.hasUsage ? (
            <UsageSection
              summary={usage}
              meter={meter}
              open={open.usage}
              onToggle={() => toggle('usage')}
            />
          ) : null}
          {sources.length > 0 ? (
            <SourcesSection
              sources={sources}
              open={open.sources}
              onToggle={() => toggle('sources')}
            />
          ) : null}
          {files.length > 0 ? (
            <FilesSection files={files} open={open.files} onToggle={() => toggle('files')} />
          ) : null}
          {userId ? <MemorySection open={open.memory} onToggle={() => toggle('memory')} /> : null}
        </>
      ) : (
        <p className="p-4 text-xs text-fg-subtle">
          Usage, sources and files show up here once the chat starts.
        </p>
      )}
    </aside>
  );
}
