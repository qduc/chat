import React, { useMemo, useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import {
  ClipboardCheck,
  Clipboard,
  ChevronDown,
  ChevronUp,
  WrapText,
  Brain,
  Eye,
} from 'lucide-react';
import { Modal } from './ui/Modal';
import { IconButton } from './ui/Button';
import { cn } from '../lib/cn';

interface MarkdownProps {
  text: string;
  className?: string;
  isStreaming?: boolean;
}

const CODE_FENCE_PATTERN = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`]*`)/g;
const BLOCK_LATEX_PATTERN = /(^|[^\\])\\\[((?:\\.|[\s\S])*?)\\\]/g;
const INLINE_LATEX_PATTERN = /(^|[^\\])\\\(([\s\S]*?)\\\)/g;

const DEFAULT_FENCE_LENGTH = 3;

function getMaxFenceRun(text: string, fenceChar: '`' | '~'): number {
  if (!text) return 0;
  const regex = fenceChar === '`' ? /`+/g : /~+/g;
  let maxRun = 0;
  let match: RegExpExecArray | null = null;

  while ((match = regex.exec(text))) {
    if (match[0].length > maxRun) {
      maxRun = match[0].length;
    }
  }

  return maxRun;
}

function buildThinkingFence(content: string): { opening: string; closing: string } {
  const maxBackticks = getMaxFenceRun(content, '`');
  const maxTildes = getMaxFenceRun(content, '~');
  const backtickLength = Math.max(DEFAULT_FENCE_LENGTH, maxBackticks + 1);
  const tildeLength = Math.max(DEFAULT_FENCE_LENGTH, maxTildes + 1);
  const useBackticks = backtickLength <= tildeLength;
  const fenceChar = useBackticks ? '`' : '~';
  const fenceLength = useBackticks ? backtickLength : tildeLength;
  const fence = fenceChar.repeat(fenceLength);

  return {
    opening: `${fence}thinking`,
    closing: fence,
  };
}
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
      return false; // Mathematical block closed, DO NOT escape
    }

    if ('+=<>\\^'.includes(char)) {
      return false; // Mathematical operator found!
    }

    if (char === '/') {
      const match = remainder.slice(index + 1).match(/^[a-zA-Z]+/);
      if (match) {
        const word = match[0].toLowerCase();
        const currencyUnits = [
          'month',
          'mo',
          'year',
          'yr',
          'week',
          'wk',
          'day',
          'hr',
          'user',
          'person',
          'token',
          'tokens',
          'gb',
          'mb',
          'tb',
          's',
        ];
        if (currencyUnits.includes(word)) {
          return true;
        }
      }
      return false; // Likely math division
    }

    if (char === '-' || char === '–' || char === '—' || char === '*' || char === '_') {
      const nextChar = remainder[index + 1] || '';
      if (nextChar === char) return true; // --, **, __
      if (/[0-9]/.test(nextChar) || nextChar === '$') return true; // Range like $10-20 or $10-$20
      if (!nextChar || ' \t,.;:!?)]'.includes(nextChar)) return true; // End of string or punctuation
      return false; // Likely math (e.g. $2-x, $2*x)
    }

    if (char === ' ' || char === '\t') {
      const trimmed = remainder.slice(index).trimStart();

      if (!trimmed) {
        return hasDigit;
      }

      if (trimmed[0] === '\n') {
        return hasDigit;
      }

      // Check for math operator after space
      if (/^[-+/*=<>^\\_]/.test(trimmed)) {
        // If it's * or _, check if it's potentially markdown (e.g. $20 *word*)
        if (/^[*_]{1,2}[a-zA-Z0-9]/.test(trimmed)) {
          // Check if there's a matching closing tag later in the string
          // This is a heuristic, but often reliable for markdown vs math
          return true;
        }

        if (trimmed.startsWith('/')) {
          const match = trimmed
            .slice(1)
            .trimStart()
            .match(/^[a-zA-Z]+/);
          if (match) {
            const word = match[0].toLowerCase();
            const currencyUnits = [
              'month',
              'mo',
              'year',
              'yr',
              'week',
              'wk',
              'day',
              'hr',
              'user',
              'person',
              'token',
              'tokens',
              'gb',
              'mb',
              'tb',
              's',
            ];
            if (currencyUnits.includes(word)) {
              return true;
            }
          }
        }
        return false;
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
      } else if (fence[0] === codeBlockFence[0]) {
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

/**
 * Process table cell content to render <br> tags as actual line breaks
 */
function processTableCellContent(content: any): React.ReactNode {
  if (typeof content === 'string') {
    // Split by <br> and insert real <br /> elements
    const parts = content.split('<br>');
    return parts.map((part: string, index: number, arr: string[]) => (
      <React.Fragment key={index}>
        {part}
        {index < arr.length - 1 && <br />}
      </React.Fragment>
    ));
  }

  if (Array.isArray(content)) {
    return content.map((child) => processTableCellContent(child));
  }

  // Pass through React elements and other types
  return content;
}

/**
 * Recursively extract text content from React children
 */
function getTextFromChildren(children: any): string {
  if (!children) return '';
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return children.toString();
  if (Array.isArray(children)) return children.map(getTextFromChildren).join('');
  if (React.isValidElement(children)) return getTextFromChildren((children.props as any).children);
  return '';
}

const MarkdownComponents: any = {
  a: ({ href, children, ...props }: any) => (
    <a
      {...props}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-accent underline underline-offset-2 transition-colors hover:text-accent-hover"
    >
      {children}
    </a>
  ),
  pre: function PreRenderer(p: any) {
    const { children } = p;
    const codeRef = React.useRef<HTMLDivElement | null>(null);
    const [copied, setCopied] = React.useState(false);
    const [isCollapsed, setIsCollapsed] = React.useState(false);
    const [isWrapped, setIsWrapped] = React.useState(false);
    const [showHtmlPreview, setShowHtmlPreview] = React.useState(false);

    // Helper function to check if code is a full HTML page
    const isFullHtmlPage = (code: string): boolean => {
      if (!code) return false;
      const trimmed = code.trim().toLowerCase();
      // Check for DOCTYPE, html tag, or both head and body tags
      return (
        /^<!doctype\s+html/i.test(trimmed) ||
        (trimmed.includes('<html') && trimmed.includes('</html>')) ||
        (trimmed.includes('<head') && trimmed.includes('<body'))
      );
    };

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
    const childEl = Array.isArray(children) ? children[0] : children;
    if (childEl?.props?.className?.includes('language-thinking')) {
      return childEl;
    }

    // Extract language from code element's className
    const codeClassName = childEl?.props?.className || '';
    const languageMatch = codeClassName.match(/language-(\w+)/);
    const language = languageMatch ? languageMatch[1] : null;

    // Get code content for HTML detection
    const codeContent = getTextFromChildren(childEl?.props?.children);
    const isHtml =
      (language === 'html' || language === 'xml' || !language) && isFullHtmlPage(codeContent);
    const wrappedChild = React.isValidElement(childEl)
      ? React.cloneElement(childEl as React.ReactElement<any>, {
          className: `${codeClassName} ${
            isWrapped ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'
          }`.trim(),
        })
      : childEl;

    return (
      <>
        <pre className="relative my-3 rounded-card border border-line bg-muted overflow-visible!">
          {/* Header with language and toolbar */}
          <div className="sticky top-0 z-10 flex items-center gap-2 rounded-t-card border-b border-line bg-muted py-1 pr-1 pl-3">
            {language && <span className="text-xs text-fg-subtle">{language}</span>}
            <div className="ml-auto flex items-center gap-1">
              <IconButton
                size="sm"
                label={isWrapped ? 'Disable word wrap' : 'Enable word wrap'}
                aria-pressed={isWrapped}
                onClick={() => setIsWrapped((prev) => !prev)}
                className={cn(isWrapped && 'bg-emphasis text-fg')}
              >
                <WrapText />
              </IconButton>
              <IconButton size="sm" label={copied ? 'Copied' : 'Copy code'} onClick={onCopy}>
                {copied ? <ClipboardCheck /> : <Clipboard />}
              </IconButton>
              {isHtml && (
                <IconButton size="sm" label="Preview HTML" onClick={() => setShowHtmlPreview(true)}>
                  <Eye />
                </IconButton>
              )}
              <IconButton
                size="sm"
                label={isCollapsed ? 'Expand code block' : 'Collapse code block'}
                aria-expanded={!isCollapsed}
                onClick={() => setIsCollapsed((prev) => !prev)}
              >
                {isCollapsed ? <ChevronDown /> : <ChevronUp />}
              </IconButton>
            </div>
          </div>

          {/* padded, scrollable code area */}
          <div
            ref={codeRef}
            tabIndex={isCollapsed ? -1 : 0}
            role="region"
            aria-label={language ? `${language} code` : 'Code'}
            className={cn(
              'overflow-auto px-4 py-3 font-mono text-sm leading-snug text-fg transition-opacity focus-ring-inset',
              isCollapsed && 'pointer-events-none select-none',
              isWrapped ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'
            )}
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

        {/* HTML Preview Modal */}
        {isHtml && (
          <Modal
            open={showHtmlPreview}
            onClose={() => setShowHtmlPreview(false)}
            title="HTML Preview"
            size="full"
            bodyClassName="flex p-0"
          >
            <iframe
              srcDoc={codeContent}
              title="HTML Preview"
              className="h-full w-full flex-1 bg-document"
              sandbox="allow-scripts allow-same-origin"
            />
          </Modal>
        )}
      </>
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
    const isThinkingBlock = className?.includes('language-thinking');
    const isCodeBlock = className?.startsWith('language-');

    // State for thinking blocks - must be called unconditionally
    const [isExpanded, setIsExpanded] = useState(!shouldHighlight);
    const prevShouldHighlightRef = React.useRef(shouldHighlight);

    useEffect(() => {
      if (!isThinkingBlock) {
        prevShouldHighlightRef.current = shouldHighlight;
        return;
      }

      const wasStreaming = !prevShouldHighlightRef.current && shouldHighlight;

      if (wasStreaming) {
        setIsExpanded(false);
      }

      prevShouldHighlightRef.current = shouldHighlight;
    }, [isThinkingBlock, shouldHighlight]);

    // Handle thinking/reasoning blocks
    if (isThinkingBlock) {
      const isStreaming = !shouldHighlight;

      return (
        <div className="my-3 overflow-hidden rounded-card border border-line bg-surface">
          <button
            type="button"
            aria-expanded={isExpanded}
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex w-full items-center gap-2 px-4 py-3 text-fg-muted transition-colors select-none hover:bg-muted focus-ring-inset"
          >
            <Brain
              aria-hidden="true"
              className={cn(
                'size-4 shrink-0',
                isStreaming ? 'animate-pulse text-fg-muted' : 'text-fg-subtle'
              )}
            />
            <span className="text-xs font-medium text-fg-muted">Thought Process</span>
            <ChevronDown
              aria-hidden="true"
              className={cn('ml-auto size-4 text-fg-subtle', isExpanded && 'rotate-180')}
            />
          </button>

          {isExpanded && (
            <div className="border-t border-line px-3 py-3 text-sm leading-relaxed whitespace-pre-wrap text-fg-muted">
              {children}
            </div>
          )}
        </div>
      );
    }

    // Handle regular code blocks (triple backticks)
    if (isCodeBlock || (typeof children === 'string' && children.includes('\n'))) {
      return <code className={className}>{children}</code>;
    }

    // Handle inline code (single backticks)
    return (
      <code className={cn(className, 'rounded-control bg-muted px-1 font-mono text-sm')}>
        {children}
      </code>
    );
  },
  hr: () => <hr className="my-4 border-line" />,
  p: ({ children }: any) => <p className="md-p mt-4 leading-relaxed first:mt-0">{children}</p>,
  h1: ({ children }: any) => (
    <h1 className="md-h1 mt-6 mb-4 border-b border-line pb-2 text-xl font-medium first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }: any) => (
    <h2 className="md-h2 mt-6 mb-3 text-lg font-medium first:mt-0">{children}</h2>
  ),
  h3: ({ children }: any) => (
    <h3 className="md-h3 mt-4 mb-2 text-base font-medium first:mt-0">{children}</h3>
  ),
  ul: ({ children }: any) => <ul className="mb-4 ml-6 list-disc space-y-2">{children}</ul>,
  ol: ({ children }: any) => <ol className="mb-4 ml-6 list-decimal space-y-2">{children}</ol>,
  li: ({ children }: any) => <li className="leading-relaxed">{children}</li>,
  blockquote: ({ children }: any) => (
    <blockquote className="my-4 border-l-2 border-line-strong py-2 pl-4 leading-relaxed text-fg-muted italic">
      {children}
    </blockquote>
  ),
  table: ({ children }: any) => (
    <div
      tabIndex={0}
      role="region"
      aria-label="Table"
      className="my-6 w-full overflow-x-auto rounded-card border border-line focus-ring"
    >
      <table className="min-w-full border-collapse text-sm">{children}</table>
    </div>
  ),

  th: ({ children }: any) => (
    <th className="border-b border-line bg-muted px-4 py-3 text-left font-medium text-fg">
      {processTableCellContent(children)}
    </th>
  ),
  td: ({ children }: any) => (
    <td className="border-b border-line px-4 py-3 align-top [tr:last-child>&]:border-b-0">
      {processTableCellContent(children)}
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
        const timer = setTimeout(() => setShouldHighlight(false), 0);
        return () => clearTimeout(timer);
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
  // Throttling for streaming content to improve performance and selection stability
  const [throttledText, setThrottledText] = useState(text);
  const lastUpdateRef = React.useRef<number>(0);
  const timeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!isStreaming) {
      const timer = setTimeout(() => {
        setThrottledText(text);
      }, 0);
      return () => {
        clearTimeout(timer);
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
      };
    }

    const now = Date.now();
    const lastUpdate = lastUpdateRef.current || now - 100; // Default to 100ms ago to trigger first update
    const timeSinceLastUpdate = now - lastUpdate;
    const throttleMs = 50; // 50ms = 20fps, good balance between smoothness and performance

    if (timeSinceLastUpdate >= throttleMs) {
      const timer = setTimeout(() => {
        setThrottledText(text);
      }, 0);
      lastUpdateRef.current = now;
      return () => clearTimeout(timer);
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
    let textToProcess = normalizeLatexDelimiters(escapeCurrencyDollarSigns(throttledText));

    // Convert single newlines to hard breaks for better text formatting
    // Split by code blocks and inline code to avoid affecting them
    const parts = textToProcess.split(CODE_FENCE_PATTERN);
    textToProcess = parts
      .map((part) => {
        if (
          part.startsWith('```') ||
          part.startsWith('~~~') ||
          (part.startsWith('`') && part.endsWith('`'))
        ) {
          // This is a code block or inline code, leave as-is
          return part;
        } else {
          // This is regular text, convert single newlines to hard breaks
          return part.replace(/\n/g, '  \n');
        }
      })
      .join('');

    return textToProcess;
  }, [throttledText]);

  // Split text into blocks to prevent re-rendering of stable content
  const blocks = useMemo(() => splitMarkdownIntoBlocks(processedText), [processedText]);

  return (
    <div className={cn('md-content', className)}>
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
