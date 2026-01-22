import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '../contexts/ThemeContext';

jest.mock('remark-gfm', () => () => ({}));
jest.mock('remark-math', () => () => ({}));
jest.mock('rehype-highlight', () => () => ({}));
jest.mock('rehype-katex', () => () => ({}));
jest.mock('katex/dist/katex.min.css', () => ({}));

jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children: string }) => (
    <div data-testid="markdown-output">{children}</div>
  ),
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

describe('Markdown thinking fences', () => {
  it('keeps thinking content intact when reasoning includes nested fences', () => {
    const content = `<thinking>
1. **Analyze the Request:**

\`\`\`js
console.log('streaming');
\`\`\`

10. **Final Output Generation:** (This matches the provided good response.)

**(Self-Correction during code generation):**

Proceed to generate response.
</thinking>

Here is a complete response.`;

    render(
      <ThemeProvider>
        <Markdown text={content} isStreaming />
      </ThemeProvider>
    );

    const outputs = screen.getAllByTestId('markdown-output');
    const rendered = outputs.map((node) => node.textContent ?? '').join('\n');

    expect(rendered).toContain('Final Output Generation');
    const hasSafeFence =
      rendered.includes('````thinking') ||
      rendered.includes('~~~thinking') ||
      rendered.includes('~~~~thinking');
    expect(hasSafeFence).toBe(true);
  });
});
