import React from 'react';
import { DetailsSection } from './DetailsSection';
import { formatChatInfoSummary, type ChatInfo } from '../../lib/chatInfo';
import { formatStartedAt } from '../../lib/detailsFormat';

interface ChatInfoSectionProps {
  info: ChatInfo;
  open: boolean;
  onToggle: () => void;
}

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-fg-subtle">{term}</dt>
      <dd className="col-span-3 min-w-0 break-words text-fg">{children}</dd>
    </>
  );
}

/** Read-only settings of the current chat. */
export function ChatInfoSection({ info, open, onToggle }: ChatInfoSectionProps) {
  const started = formatStartedAt(info.startedAt);
  return (
    <DetailsSection
      title="This chat"
      open={open}
      onToggle={onToggle}
      summary={formatChatInfoSummary(info)}
    >
      <dl className="grid grid-cols-4 gap-x-3 gap-y-2 px-1 pt-1 pb-2 text-xs">
        <Row term="Model">
          {info.modelId || 'Not selected'}
          {info.providerName ? (
            <span className="text-fg-subtle"> · {info.providerName}</span>
          ) : null}
        </Row>
        <Row term="Reasoning">{info.reasoningLabel}</Row>
        <Row term="Tools">{info.tools.length > 0 ? info.tools.join(', ') : 'None'}</Row>
        <Row term="Params">
          {info.paramsLabel} · {info.streaming ? 'streaming' : 'no streaming'}
        </Row>
        {started ? <Row term="Started">{started}</Row> : null}
      </dl>
    </DetailsSection>
  );
}
