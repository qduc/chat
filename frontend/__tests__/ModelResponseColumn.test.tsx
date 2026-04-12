/**
 * Tests for inline retry status rendering in ModelResponseColumn
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ModelResponseColumn } from '../components/message/ModelResponseColumn';

jest.mock('../components/Markdown', () => ({
  __esModule: true,
  default: ({ text }: any) => <div data-testid="markdown">{text}</div>,
}));

jest.mock('../components/ui/MessageContentRenderer', () => ({
  MessageContentRenderer: () => <div data-testid="content-renderer" />,
}));

jest.mock('../components/message/ToolSegment', () => ({
  ToolSegment: () => <div data-testid="tool-segment" />,
}));

jest.mock('../components/message/ReasoningBlock', () => ({
  ReasoningBlock: () => <div data-testid="reasoning-block" />,
}));

jest.mock('../components/message/MessageToolbar', () => ({
  MessageToolbar: () => <div data-testid="message-toolbar" />,
}));

jest.mock('../components/message/RevisionNavigation', () => ({
  RevisionNavigation: () => <div data-testid="revision-navigation" />,
}));

jest.mock('lucide-react', () => ({
  AlertCircle: () => <span data-testid="alert-circle" />,
  Loader2: () => <span data-testid="loader" />,
}));

const baseData = {
  modelId: 'primary',
  displayMessage: {
    id: 'assistant-1',
    role: 'assistant' as const,
    content: '',
  },
  isModelStreaming: true,
  isModelError: false,
  error: undefined,
  assistantSegments: [] as any[],
};

describe('ModelResponseColumn retry status', () => {
  it('renders retry status inline while waiting for provider retry', () => {
    render(
      <ModelResponseColumn
        data={baseData as any}
        messageId="assistant-1"
        isMultiColumn={false}
        isEditing={false}
        isUser={false}
        hasComparison={false}
        pending={
          {
            streaming: true,
            abort: null,
            retryStatus: {
              source: 'provider',
              modelId: 'primary',
              status: 429,
              attempt: 1,
              maxRetries: 3,
              retryAfterMs: 2500,
            },
          } as any
        }
        streamingStats={null}
        collapsedToolOutputs={{}}
        copiedMessageId={null}
        actionsDisabled={false}
        onToggleToolOutput={jest.fn()}
        onCopy={jest.fn()}
        getModelDisplayName={(id) => id}
      />
    );

    expect(
      screen.getByText('Retrying after provider rate limit (attempt 1/3, waiting ~3s)')
    ).toBeInTheDocument();
    expect(screen.getByTestId('loader')).toBeInTheDocument();
  });
});
