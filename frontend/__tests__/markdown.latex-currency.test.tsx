import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '../contexts/ThemeContext';
import Markdown from '../components/Markdown';

// Mock components and libraries to focus on preprocessing logic
jest.mock('remark-gfm', () => () => ({}));
jest.mock('remark-math', () => () => ({}));
jest.mock('rehype-highlight', () => () => ({}));
jest.mock('rehype-katex', () => () => ({}));
jest.mock('katex/dist/katex.min.css', () => ({}));

// The Markdown component renders a list of MemoizedMarkdownBlock components.
// We mock ReactMarkdown inside those blocks to capture the "processed" text they receive.
jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children: string }) => (
    <div data-testid="markdown-output">{children}</div>
  ),
}));

beforeAll(() => {
  if (typeof window.matchMedia !== 'function') {
    // @ts-expect-error: Mocking window.matchMedia for test environment
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

describe('Markdown LaTeX and Currency Interaction', () => {
  const getRenderedText = () => {
    const outputs = screen.getAllByTestId('markdown-output');
    // Note: normalizeLatexDelimiters might add spaces or newlines,
    // and Markdown.tsx adds '  \n' for hard breaks.
    return outputs.map((node) => node.textContent ?? '').join('\n');
  };

  it('correctly normalizes LaTeX starting with a number without escaping it', () => {
    const content = 'The answer is \\( 100 + x \\).';
    render(
      <ThemeProvider>
        <Markdown text={content} />
      </ThemeProvider>
    );

    const rendered = getRenderedText();
    // Should be converted to $ ... $ and NOT escaped to \$ ... $
    expect(rendered).toContain('$100 + x$');
    expect(rendered).not.toContain('\\$100 + x$');
  });

  it('correctly escapes actual currency while preserving math in the same string', () => {
    const content = 'I have $100 and formula is \\( x = 5 \\).';
    render(
      <ThemeProvider>
        <Markdown text={content} />
      </ThemeProvider>
    );

    const rendered = getRenderedText();
    // Currency should be escaped, math should be normalized to $
    expect(rendered).toContain('\\$100');
    expect(rendered).toContain('$x = 5$');
  });

  it('handles complex math with decimals and powers without escaping', () => {
    const content = 'Value: \\( 2.5 \\times 10^3 \\).';
    render(
      <ThemeProvider>
        <Markdown text={content} />
      </ThemeProvider>
    );

    const rendered = getRenderedText();
    expect(rendered).toContain('$2.5 \\times 10^3$');
    expect(rendered).not.toContain('\\$2.5');
  });

  it('escapes currency with spaces correctly', () => {
    const content = 'Price: $ 100 to $ 200';
    render(
      <ThemeProvider>
        <Markdown text={content} />
      </ThemeProvider>
    );

    const rendered = getRenderedText();
    expect(rendered).toContain('\\$ 100');
    expect(rendered).toContain('\\$ 200');
  });

  it('allows escaped dollar signs inside LaTeX blocks', () => {
    const content = 'Formula: \\( \\$1.00 + x \\)';
    render(
      <ThemeProvider>
        <Markdown text={content} />
      </ThemeProvider>
    );

    const rendered = getRenderedText();
    // The inner \$ should be preserved, outer \( \) normalized to $
    expect(rendered).toContain('$\\$1.00 + x$');
  });

  it('preserves multiple math blocks starting with numbers', () => {
    const content = 'Compare \\( 1 \\) and \\( 2 \\).';
    render(
      <ThemeProvider>
        <Markdown text={content} />
      </ThemeProvider>
    );

    const rendered = getRenderedText();
    expect(rendered).toContain('$1$');
    expect(rendered).toContain('$2$');
    expect(rendered).not.toContain('\\$1');
    expect(rendered).not.toContain('\\$2');
  });

  it('correctly normalizes LaTeX native $ starting with a number without escaping it', () => {
    const content = 'The answer is $100 + x$.';
    render(
      <ThemeProvider>
        <Markdown text={content} />
      </ThemeProvider>
    );

    const rendered = getRenderedText();
    expect(rendered).toContain('$100 + x$');
    expect(rendered).not.toContain('\\$100 + x$');
  });

  it('handles complex math native $ with decimals and powers without escaping', () => {
    const content = 'Value: $2.5 \\times 10^3$.';
    render(
      <ThemeProvider>
        <Markdown text={content} />
      </ThemeProvider>
    );

    const rendered = getRenderedText();
    expect(rendered).toContain('$2.5 \\times 10^3$');
    expect(rendered).not.toContain('\\$2.5');
  });

  it('handles currency range with en-dash and bold formatting correctly', () => {
    const content = '**$539–$640** because **RAM prices are volatile**';
    render(
      <ThemeProvider>
        <Markdown text={content} />
      </ThemeProvider>
    );

    const rendered = getRenderedText();
    // Both dollar signs should be escaped to prevent them from forming a math block
    expect(rendered).toContain('\\$539');
    expect(rendered).toContain('\\$640');
  });

  it('handles currency with trailing bold formatting and range correctly', () => {
    const content =
      'So a realistic bottom-line is **closer to $550–$600** when everything is factored in.';
    render(
      <ThemeProvider>
        <Markdown text={content} />
      </ThemeProvider>
    );

    const rendered = getRenderedText();
    expect(rendered).toContain('\\$550');
    expect(rendered).toContain('\\$600');
  });

  it('handles currency with preceding tilde correctly', () => {
    const content = '(~$97 for 16GB DDR4)';
    render(
      <ThemeProvider>
        <Markdown text={content} />
      </ThemeProvider>
    );

    const rendered = getRenderedText();
    expect(rendered).toContain('\\$97');
  });
});
