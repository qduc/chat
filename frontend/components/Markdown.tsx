import React, { useMemo, useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { useTheme } from '../contexts/ThemeContext';
import { ClipboardCheck, Clipboard, ChevronDown, ChevronUp, WrapText } from 'lucide-react';

interface MarkdownProps {
  text: string;
  className?: string;
  isStreaming?: boolean;
}

const CODE_FENCE_PATTERN = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`]*`)/g;
const BLOCK_LATEX_PATTERN = /(^|[^\\])\\\[((?:\\.|[\s\S])*?)\\\]/g;
const INLINE_LATEX_PATTERN = /(^|[^\\])\\\(([\s\S]*?)\\\)/g;

const CURRENCY_KEYWORDS = new Set([
  'usd',
  'cad',
  'aud',
  'eur',
  'gbp',
  'jpy',
  'cny',
  'inr',
  'sgd',
  'hkd',
  'ntd',
  'mxn',
  'rub',
  'brl',
  'zar',
  'chf',
  'krw',
  'million',
  'billion',
  'trillion',
  'thousand',
  'percent',
  'per',
  'cent',
  'bucks',
  'dollars',
]);

// Heuristic guard to keep currency like "$20" from being parsed as inline math.
function shouldEscapeCurrencySequence(remainder: string): boolean {
  if (!remainder) return false;

  let index = 0;

  while (index < remainder.length && (remainder[index] === ' ' || remainder[index] === '\t')) {
    index += 1;
  }

  if (index >= remainder.length) return false;

  if (!/[0-9]/.test(remainder[index])) {
    return false;
  }

  let hasDigit = false;

  for (; index < remainder.length; index += 1) {
    const char = remainder[index];

    if (/[0-9]/.test(char)) {
      hasDigit = true;
      continue;
    }

    if (char === ',' || char === '.') {
      continue;
    }

    if (char === '$') {
      return false;
    }

    if (char === ' ' || char === '\t') {
      const trimmed = remainder.slice(index).trimStart();

      if (!trimmed) {
        return hasDigit;
      }

      if (trimmed[0] === '\n') {
        return hasDigit;
      }

      const lowerTrimmed = trimmed.toLowerCase();

      if (lowerTrimmed.startsWith('/')) {
        return true;
      }

      for (const keyword of CURRENCY_KEYWORDS) {
        if (lowerTrimmed.startsWith(keyword)) {
          return true;
        }
      }

      return hasDigit;
    }

    if (/[kKmMbBtT%]/.test(char)) {
      return true;
    }

    if (/[a-zA-Z]/.test(char)) {
      return true;
    }

    if (',.;:!?'.includes(char)) {
      return true;
    }

    break;
  }

  return hasDigit;
}

// Escape standalone currency dollars while leaving legitimate math untouched.
function escapeCurrencyDollarSigns(input: string): string {
  if (!input) return input;

  const segments = input.split(CODE_FENCE_PATTERN);

  return segments
    .map((segment) => {
      if (!segment) return segment;

      if (segment.startsWith('```') || segment.startsWith('~~~') || segment.startsWith('`')) {
        return segment;
      }

      let result = '';

      for (let index = 0; index < segment.length; index += 1) {
        const char = segment[index];

        if (char === '$') {
          const previousChar = index > 0 ? segment[index - 1] : '';

          if (previousChar === '\\') {
            result += char;
            continue;
          }

          const remainder = segment.slice(index + 1);

          if (shouldEscapeCurrencySequence(remainder)) {
            result += '\\$';
            continue;
          }
        }

        result += char;
      }

      return result;
    })
    .join('');
}

// ...existing code...
// Normalize common LaTeX delimiters from \(…\)/\[…\] to $…$/$$…$$.
// Some providers emit the escaped forms by default, and remark-math only parses dollar delimiters.
function normalizeLatexDelimiters(input: string): string {
  if (!input) return input;

  const segments = input.split(CODE_FENCE_PATTERN);
  return segments
    .map((segment) => {
      if (!segment) return segment;
      if (segment.startsWith('```') || segment.startsWith('~~~') || segment.startsWith('`')) {
        return segment;
      }

      const withBlocks = segment.replace(BLOCK_LATEX_PATTERN, (match, prefix, body) => {
        const hasLineBreak = body.includes('\n');
        const trimmed = body.trim();
        const normalized = hasLineBreak ? `\n${trimmed}\n` : trimmed;
        return `${prefix}$$${normalized}$$`;
      });

      return withBlocks.replace(INLINE_LATEX_PATTERN, (match, prefix, body) => {
        const normalized = body.trim();
        return `${prefix}$${normalized}$`;
      });
    })
    .join('');
}

function splitMarkdownIntoBlocks(text: string): string[] {
  if (!text) return [];

  const blocks: string[] = [];
  let currentBlock = '';
  let codeBlockFence: string | null = null;
  let inMathBlock = false;

  // We need to preserve newlines exactly to maintain markdown structure
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isLastLine = i === lines.length - 1;
    const lineWithNewline = line + (isLastLine ? '' : '\n');

    // Check for code block toggle
    // Allow for nested code blocks (indented) and blockquotes
    const fenceMatch = line.match(/^(\s*(?:>\s*)*)(`{3,}|~{3,})/);

    if (fenceMatch) {
      const fence = fenceMatch[2];

      if (!codeBlockFence) {
        // Opening fence
        codeBlockFence = fence;
      } else {
        // Closing fence?
        // Must be same character and at least same length
        // And must not have info string (content after fence)
        const isClosing = line.match(new RegExp(`^(\\s*(?:>\\s*)*)(${fence[0]}+)\\s*$`));

        if (isClosing) {
          const closingFence = isClosing[2];
          if (closingFence.length >= codeBlockFence.length) {
            codeBlockFence = null;
          }
        }
      }
    }

    // Check for math block toggle
    // Only check if not in code block
    if (!codeBlockFence && line.trim() === '$$') {
      inMathBlock = !inMathBlock;
    }

    currentBlock += lineWithNewline;

    // Split condition:
    // 1. Empty line (trimmed is empty)
    // 2. Not in code block
    // 3. Not in math block
    if (line.trim() === '' && !codeBlockFence && !inMathBlock) {
      // Lookahead to check if we should split
      // If the next non-empty line is indented or a list marker, it's likely a list continuation
      let shouldSplit = true;

      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j];
        if (nextLine.trim() === '') continue;

        // Check for indentation (2+ spaces or tab) which often indicates list continuation
        const isIndented = /^(\s{2,}|\t)/.test(nextLine);

        // Check for list marker (-, *, +, or 1.)
        const isListMarker = /^\s*([-*+]|\d+\.)\s/.test(nextLine);

        if (isIndented || isListMarker) {
          shouldSplit = false;
        }
        break; // Found the next non-empty line
      }

      if (shouldSplit) {
        blocks.push(currentBlock);
        currentBlock = '';
      }
    }
  }

  if (currentBlock) {
    blocks.push(currentBlock);
  }

  return blocks.filter((b) => b.length > 0);
}

const MarkdownComponents: any = {
  a: ({ href, children, ...props }: any) => (
    <a
      {...props}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="md-link underline decoration-slate-300 hover:decoration-slate-400 text-slate-700 dark:text-slate-300"
    >
      {children}
    </a>
  ),
  pre: function PreRenderer(p: any) {
    const { children } = p;
    const preRef = React.useRef<HTMLPreElement | null>(null);
    const codeRef = React.useRef<HTMLDivElement | null>(null);
    const [copied, setCopied] = React.useState(false);
    const [isCollapsed, setIsCollapsed] = React.useState(false);
    const [isWrapped, setIsWrapped] = React.useState(false);

    const onCopy = async () => {
      try {
        // Get text from the code content div only, not the entire pre element
        const text = codeRef.current?.innerText ?? '';
        if (!text) return;
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      } catch {
        // no-op
      }
    };

    // If this pre wraps a "thinking" code block, render the child directly to avoid double boxing
    const childEl = children as any;
    if (childEl?.props?.className?.includes('language-thinking')) {
      return childEl;
    }

    // Extract language from code element's className
    const codeClassName = childEl?.props?.className || '';
    const languageMatch = codeClassName.match(/language-(\w+)/);
    const language = languageMatch ? languageMatch[1] : null;
    const wrappedChild = React.isValidElement(childEl)
      ? React.cloneElement(childEl as React.ReactElement<any>, {
          className: `${codeClassName} ${
            isWrapped ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'
          }`.trim(),
        })
      : childEl;

    return (
      <pre
        ref={preRef}
        className={`md-pre relative my-3 overflow-hidden rounded border border-slate-200/50 dark:border-neutral-800/50 bg-slate-50/30 dark:bg-neutral-900/30`}
      >
        {/* Header with language and copy button */}
        <div className="flex items-center px-3 py-1.5 border-b border-slate-200/50 dark:border-neutral-800/50 bg-slate-50/50 dark:bg-neutral-900/30">
          {language && (
            <span className="text-xs text-slate-500 dark:text-slate-500">{language}</span>
          )}
          <div className="flex items-center gap-1 ml-auto">
            <button
              type="button"
              aria-label={isWrapped ? 'Disable word wrap' : 'Enable word wrap'}
              aria-pressed={isWrapped}
              onClick={() => setIsWrapped((prev) => !prev)}
              className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-colors ${
                isWrapped
                  ? 'text-slate-700 dark:text-slate-200 bg-slate-200/70 dark:bg-neutral-800/70'
                  : 'text-slate-500 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-100/50 dark:hover:bg-neutral-800/50'
              }`}
            >
              <WrapText className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label={copied ? 'Copied' : 'Copy code'}
              onClick={onCopy}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-slate-500 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-100/50 dark:hover:bg-neutral-800/50 transition-colors"
            >
              {copied ? (
                <ClipboardCheck className="h-3.5 w-3.5" />
              ) : (
                <Clipboard className="h-3.5 w-3.5" />
              )}
              <span className="sr-only">{copied ? 'Copied' : 'Copy'}</span>
            </button>
            <button
              type="button"
              aria-label={isCollapsed ? 'Expand code block' : 'Collapse code block'}
              aria-expanded={!isCollapsed}
              onClick={() => setIsCollapsed((prev) => !prev)}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-slate-500 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-100/50 dark:hover:bg-neutral-800/50 transition-colors"
            >
              {isCollapsed ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronUp className="h-3.5 w-3.5" />
              )}
              <span className="sr-only">
                {isCollapsed ? 'Expand code block' : 'Collapse code block'}
              </span>
            </button>
          </div>
        </div>

        {/* padded, scrollable code area */}
        <div
          ref={codeRef}
          className={`p-3 overflow-auto text-sm font-mono text-slate-700 dark:text-slate-300 leading-snug transition-all duration-200 ease-in-out ${
            isCollapsed ? 'pointer-events-none select-none' : ''
          } ${isWrapped ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'}`}
          style={
            isCollapsed
              ? {
                  maxHeight: 0,
                  paddingTop: 0,
                  paddingBottom: 0,
                  opacity: 0,
                }
              : undefined
          }
          aria-hidden={isCollapsed}
        >
          {wrappedChild}
        </div>
      </pre>
    );
  },
  code: function CodeRenderer({
    className,
    children,
    shouldHighlight,
  }: {
    className?: string;
    children?: React.ReactNode;
    shouldHighlight?: boolean;
  }) {
    const [isExpanded, setIsExpanded] = useState(false);

    const defaultCollapsedHeight = 72; // px

    if (className?.includes('language-thinking')) {
      return (
        <div className="my-4 border border-slate-200 dark:border-neutral-800 rounded-lg bg-slate-50 dark:bg-neutral-900/50">
          <div
            className="px-4 py-2 cursor-pointer font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-neutral-800 rounded-t-lg"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            💭 Thinking...
          </div>

          {/* Outer area can have padding; inner height box must not. */}
          <div className="border-t border-slate-200 dark:border-neutral-800">
            <div
              className={isExpanded ? 'px-4 py-3' : 'px-4'}
              style={
                isExpanded
                  ? {}
                  : {
                      maxHeight: `${defaultCollapsedHeight}px`,
                      overflow: 'hidden',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'flex-end',
                    }
              }
            >
              {/* Add vertical padding only when expanded to avoid shrinking visible height */}
              <div className="whitespace-pre-wrap font-mono text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                {children}
              </div>
            </div>

            {/* When collapsed, add bottom padding outside the height box for visual spacing */}
            {!isExpanded && <div className="px-4 pb-3" />}
          </div>
        </div>
      );
    }

    // Show un-highlighted code during streaming
    if (!shouldHighlight && className?.startsWith('language-')) {
      return (
        <code
          className={`${className} bg-slate-100 dark:bg-neutral-800 text-slate-700 dark:text-slate-300 px-1 rounded`}
        >
          {children}
        </code>
      );
    }

    return <code className={`${className} bg-slate-50 dark:bg-neutral-900/50`}>{children}</code>;
  },
  hr: () => <hr className="my-4 border-slate-200 dark:border-neutral-800" />,
  p: ({ children }: any) => <p className="md-p leading-relaxed mt-4 first:mt-0">{children}</p>,
  h1: ({ children }: any) => (
    <h1 className="md-h1 text-2xl font-bold leading-tight mt-6 mb-4 pb-2 border-b border-slate-200 dark:border-neutral-800 first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }: any) => (
    <h2 className="md-h2 text-xl font-semibold leading-snug mt-5 mb-3 first:mt-0">{children}</h2>
  ),
  h3: ({ children }: any) => (
    <h3 className="md-h3 text-lg font-medium leading-normal mt-4 mb-2 first:mt-0">{children}</h3>
  ),
  ul: ({ children }: any) => <ul className="list-disc ml-6 space-y-2 mb-4">{children}</ul>,
  ol: ({ children }: any) => <ol className="list-decimal ml-6 space-y-2 mb-4">{children}</ol>,
  li: ({ children }: any) => <li className="leading-relaxed">{children}</li>,
  blockquote: ({ children }: any) => (
    <blockquote className="border-l-2 border-slate-300 dark:border-neutral-700 pl-4 py-2 my-4 italic text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-neutral-900/50 rounded-r-lg leading-relaxed">
      {children}
    </blockquote>
  ),
  table: ({ children }: any) => (
    <div className="overflow-x-auto my-4 rounded-lg border border-slate-200 dark:border-neutral-800">
      <table className="min-w-full text-sm border-collapse bg-white dark:bg-neutral-950">
        {children}
      </table>
    </div>
  ),
  th: ({ children }: any) => (
    <th className="text-left px-4 py-3 border-b border-slate-200 dark:border-neutral-800 font-semibold bg-slate-50 dark:bg-neutral-900 first:rounded-tl-lg last:rounded-tr-lg">
      {children}
    </th>
  ),
  td: ({ children }: any) => (
    <td className="px-4 py-3 border-b border-slate-100 dark:border-neutral-900 align-top last:border-b-0">
      {children}
    </td>
  ),
};

const MemoizedMarkdownBlock = React.memo(
  function MemoizedMarkdownBlock({
    content,
    isStreaming,
  }: {
    content: string;
    isStreaming: boolean;
  }) {
    // Defer syntax highlighting until streaming completes for this block
    const [shouldHighlight, setShouldHighlight] = useState(!isStreaming);

    useEffect(() => {
      if (!isStreaming && !shouldHighlight) {
        // Stream just finished for this block, enable highlighting after brief delay
        const timer = setTimeout(() => setShouldHighlight(true), 50);
        return () => clearTimeout(timer);
      } else if (isStreaming && shouldHighlight) {
        // Started streaming again, disable highlighting
        setShouldHighlight(false);
      }
    }, [isStreaming, shouldHighlight]);

    // Conditional syntax highlighting
    const rehypePlugins = useMemo(
      () =>
        shouldHighlight
          ? [[rehypeHighlight, { ignoreMissing: true }] as any, rehypeKatex]
          : [rehypeKatex], // Skip expensive highlighting during stream
      [shouldHighlight]
    );

    // Inject shouldHighlight into code component
    const components = useMemo(
      () => ({
        ...MarkdownComponents,
        code: (props: any) => MarkdownComponents.code({ ...props, shouldHighlight }),
      }),
      [shouldHighlight]
    );

    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {content}
      </ReactMarkdown>
    );
  },
  (prev, next) => prev.content === next.content && prev.isStreaming === next.isStreaming
);

// Library-based Markdown renderer with:
// - GFM support (tables, strikethrough, task lists)
// - Syntax highlighting via highlight.js (auto-detects or uses language-* class)
// - Secure by default (no raw HTML rendering)
// - Accessible links opening in a new tab
export const Markdown: React.FC<MarkdownProps> = ({ text, className, isStreaming = false }) => {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  // Throttling for streaming content to improve performance and selection stability
  const [throttledText, setThrottledText] = useState(text);
  const lastUpdateRef = React.useRef(Date.now());
  const timeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!isStreaming) {
      setThrottledText(text);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      return;
    }

    const now = Date.now();
    const timeSinceLastUpdate = now - lastUpdateRef.current;
    const throttleMs = 50; // 50ms = 20fps, good balance between smoothness and performance

    if (timeSinceLastUpdate >= throttleMs) {
      setThrottledText(text);
      lastUpdateRef.current = now;
    } else {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        setThrottledText(text);
        lastUpdateRef.current = Date.now();
      }, throttleMs - timeSinceLastUpdate);
    }

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [text, isStreaming]);

  // Transform thinking blocks and reasoning summaries into collapsible sections
  // First, handle incomplete thinking blocks by temporarily adding closing tags
  const processedText = useMemo(() => {
    let textToProcess = escapeCurrencyDollarSigns(normalizeLatexDelimiters(throttledText));

    // Check for incomplete thinking blocks (both <thinking> and <think> variants)
    // Count opening and closing tags to ensure they match
    const openingThinkingTags = (textToProcess.match(/<thinking>/g) || []).length;
    const closingThinkingTags = (textToProcess.match(/<\/thinking>/g) || []).length;
    const openingThinkTags = (textToProcess.match(/<think>/g) || []).length;
    const closingThinkTags = (textToProcess.match(/<\/think>/g) || []).length;
    const hasIncompleteThinking = openingThinkingTags > closingThinkingTags;
    const hasIncompleteThink = openingThinkTags > closingThinkTags;

    if (hasIncompleteThinking) {
      // Only add closing tag if we have unmatched opening tags
      // Find the last <thinking> without a matching </thinking>
      textToProcess = textToProcess.replace(
        /<thinking>(?![\s\S]*<\/thinking>)([\s\S]*)$/,
        '<thinking>$1</thinking>'
      );
    }

    if (hasIncompleteThink) {
      // Only add closing tag if we have unmatched opening tags
      // Find the last <think> without a matching </think>
      textToProcess = textToProcess.replace(
        /<think>(?![\s\S]*<\/think>)([\s\S]*)$/,
        '<think>$1</think>'
      );
    }

    return textToProcess
      .replace(/<thinking>([\s\S]*?)<\/thinking>/g, (match, content) => {
        // Convert to a custom code block that we can detect
        return `\n\`\`\`thinking\n${content.trim()}\n\`\`\`\n`;
      })
      .replace(/<think>([\s\S]*?)<\/think>/g, (match, content) => {
        // Convert to a custom code block that we can detect (same as thinking)
        return `\n\`\`\`thinking\n${content.trim()}\n\`\`\`\n`;
      })
      .replace(/<reasoning_summary>([\s\S]*?)<\/reasoning_summary>/g, (match, content) => {
        // Convert reasoning summary to thinking block (reuse same rendering logic)
        return `\n\`\`\`thinking\n${content.trim()}\n\`\`\`\n`;
      });
  }, [throttledText]);

  // Split text into blocks to prevent re-rendering of stable content
  const blocks = useMemo(() => splitMarkdownIntoBlocks(processedText), [processedText]);

  // Note: Syntax highlighting theme is automatically handled by CSS
  // based on the .dark class applied to the document root

  return (
    <div className={`${className || ''} ${isDark ? 'dark' : ''}`}>
      {blocks.map((block, index) => (
        <MemoizedMarkdownBlock
          key={index}
          content={block}
          isStreaming={isStreaming && index === blocks.length - 1}
        />
      ))}
    </div>
  );
};
MemoizedMarkdownBlock.displayName = 'MemoizedMarkdownBlock';

export default Markdown;
