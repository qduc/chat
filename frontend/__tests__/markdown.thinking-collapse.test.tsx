import { render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '../contexts/ThemeContext';

jest.mock('remark-gfm', () => () => ({}));
jest.mock('remark-math', () => () => ({}));
jest.mock('rehype-highlight', () => () => ({}));
jest.mock('rehype-katex', () => () => ({}));
jest.mock('katex/dist/katex.min.css', () => ({}));

jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children, components }: { children: string; components: any }) => {
    const thinkingBlock =
      typeof children === 'string' && children.includes('Investigate')
        ? components?.code?.({
            className: 'language-thinking',
            children: 'Investigate',
          })
        : null;

    return <div data-testid="markdown-output">{thinkingBlock}</div>;
  },
}));

import Markdown from '../components/Markdown';

beforeAll(() => {
  if (typeof window.matchMedia !== 'function') {
    // @ts-expect-error: Mocking window.matchMedia for test environment where it may not be defined
    window.matchMedia = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
  }
});

describe('Markdown thinking collapse behavior', () => {
  it('collapses thinking blocks after streaming finishes', async () => {
    const content = `<thinking>\nInvestigate\n</thinking>`;

    const { rerender } = render(
      <ThemeProvider>
        <Markdown text={content} isStreaming />
      </ThemeProvider>
    );

    expect(screen.getByText('Thought Process')).toBeInTheDocument();
    expect(screen.getByText('Investigate')).toBeInTheDocument();

    rerender(
      <ThemeProvider>
        <Markdown text={content} isStreaming={false} />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.queryByText('Investigate')).not.toBeInTheDocument();
    });
  });
});
