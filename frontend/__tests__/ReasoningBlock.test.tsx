import { render, screen, waitFor } from '@testing-library/react';
import { ReasoningBlock } from '../components/message/ReasoningBlock';

describe('ReasoningBlock', () => {
  it('defaults to collapsed when loading a conversation', () => {
    render(<ReasoningBlock text="Loaded thought" isStreaming={false} />);

    expect(screen.getByText('Thought Process')).toBeInTheDocument();
    expect(screen.queryByText('Loaded thought')).not.toBeInTheDocument();
  });

  it('shows a scrolling peek while streaming and follows new text', async () => {
    const { rerender } = render(<ReasoningBlock text="Line 1\nLine 2" isStreaming />);

    const content = screen.getByTestId('reasoning-block-content');
    expect(content).toHaveClass('max-h-32');
    expect(content).toHaveClass('overflow-y-auto');

    Object.defineProperty(content, 'scrollHeight', {
      configurable: true,
      value: 240,
    });
    Object.defineProperty(content, 'scrollTop', {
      configurable: true,
      writable: true,
      value: 0,
    });

    rerender(<ReasoningBlock text={'Line 1\nLine 2\nLine 3\nLine 4'} isStreaming />);

    await waitFor(() => {
      expect((content as HTMLDivElement).scrollTop).toBe(240);
    });
  });

  it('collapses after streaming finishes', () => {
    const { rerender } = render(<ReasoningBlock text="Streaming thought" isStreaming />);

    expect(screen.getByText('Streaming thought')).toBeInTheDocument();

    rerender(<ReasoningBlock text="Streaming thought" isStreaming={false} />);

    expect(screen.queryByText('Streaming thought')).not.toBeInTheDocument();
  });
});
