import React, { useMemo, useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { useTheme } from "../contexts/ThemeContext";
import { ClipboardCheck, Clipboard } from 'lucide-react';

interface MarkdownProps {
  text: string;
  className?: string;
  isStreaming?: boolean;
}

const CODE_FENCE_PATTERN = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`]*`)/g;
const BLOCK_LATEX_PATTERN = /(^|[^\\])\\\[((?:\\.|[\s\S])*?)\\\]/g;
const INLINE_LATEX_PATTERN = /(^|[^\\])\\\(([\s\S]*?)\\\)/g;

// Normalize common LaTeX delimiters from \(…\)/\[…\] to $…$/$$…$$.
// Some providers emit the escaped forms by default, and remark-math only parses dollar delimiters.
function normalizeLatexDelimiters(input: string): string {
  if (!input) return input;

  const segments = input.split(CODE_FENCE_PATTERN);
  return segments
    .map((segment) => {
      if (!segment) return segment;
      if (segment.startsWith("```") || segment.startsWith("~~~") || segment.startsWith("`")) {
        return segment;
      }

      const withBlocks = segment.replace(
        BLOCK_LATEX_PATTERN,
        (match, prefix, body) => {
          const hasLineBreak = body.includes("\n");
          const trimmed = body.trim();
          const normalized = hasLineBreak ? `\n${trimmed}\n` : trimmed;
          return `${prefix}$$${normalized}$$`;
        }
      );

      return withBlocks.replace(
        INLINE_LATEX_PATTERN,
        (match, prefix, body) => {
          const normalized = body.trim();
          return `${prefix}$${normalized}$`;
        }
      );
    })
    .join("");
}

// Library-based Markdown renderer with:
// - GFM support (tables, strikethrough, task lists)
// - Syntax highlighting via highlight.js (auto-detects or uses language-* class)
// - Secure by default (no raw HTML rendering)
// - Accessible links opening in a new tab
export const Markdown: React.FC<MarkdownProps> = ({ text, className, isStreaming = false }) => {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  // Defer syntax highlighting until streaming completes
  const [shouldHighlight, setShouldHighlight] = useState(!isStreaming);

  useEffect(() => {
    if (!isStreaming && !shouldHighlight) {
      // Stream just finished, enable highlighting after brief delay
      const timer = setTimeout(() => setShouldHighlight(true), 50);
      return () => clearTimeout(timer);
    } else if (isStreaming && shouldHighlight) {
      // Started streaming again, disable highlighting
      setShouldHighlight(false);
    }
  }, [isStreaming, shouldHighlight]);

  // Transform thinking blocks and reasoning summaries into collapsible sections
  // First, handle incomplete thinking blocks by temporarily adding closing tags
  const processedText = useMemo(() => {
    let textToProcess = normalizeLatexDelimiters(text);

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
      textToProcess = textToProcess.replace(/<thinking>(?![\s\S]*<\/thinking>)([\s\S]*)$/, '<thinking>$1</thinking>');
    }

    if (hasIncompleteThink) {
      // Only add closing tag if we have unmatched opening tags
      // Find the last <think> without a matching </think>
      textToProcess = textToProcess.replace(/<think>(?![\s\S]*<\/think>)([\s\S]*)$/, '<think>$1</think>');
    }

    return textToProcess
      .replace(
        /<thinking>([\s\S]*?)<\/thinking>/g,
        (match, content) => {
          // Convert to a custom code block that we can detect
          return `\n\`\`\`thinking\n${content.trim()}\n\`\`\`\n`;
        }
      )
      .replace(
        /<think>([\s\S]*?)<\/think>/g,
        (match, content) => {
          // Convert to a custom code block that we can detect (same as thinking)
          return `\n\`\`\`thinking\n${content.trim()}\n\`\`\`\n`;
        }
      )
      .replace(
        /<reasoning_summary>([\s\S]*?)<\/reasoning_summary>/g,
        (match, content) => {
          // Convert reasoning summary to thinking block (reuse same rendering logic)
          return `\n\`\`\`thinking\n${content.trim()}\n\`\`\`\n`;
        }
      );
  }, [text]);

  // Conditional syntax highlighting
  const rehypePlugins = useMemo(() =>
    shouldHighlight
      ? [[rehypeHighlight, { ignoreMissing: true }] as any, rehypeKatex]
      : [rehypeKatex], // Skip expensive highlighting during stream
    [shouldHighlight]
  );

  // Note: Syntax highlighting theme is automatically handled by CSS
  // based on the .dark class applied to the document root

  return (
    <div className={`${className || ''} ${isDark ? 'dark' : ''}`}>
      <ReactMarkdown
        // Do NOT enable raw HTML to prevent XSS
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={rehypePlugins}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="md-link underline decoration-slate-300 hover:decoration-slate-400 text-slate-700 dark:text-slate-300"
            >
              {children}
            </a>
          ),
          pre: function PreRenderer(p) {
            const { children } = p as any;
            const preRef = React.useRef<HTMLPreElement | null>(null);
            const [copied, setCopied] = React.useState(false);

            const onCopy = async () => {
              try {
                const text = preRef.current?.innerText ?? "";
                if (!text) return;
                if (navigator.clipboard?.writeText) {
                  await navigator.clipboard.writeText(text);
                } else {
                  const ta = document.createElement("textarea");
                  ta.value = text;
                  ta.style.position = "fixed";
                  ta.style.opacity = "0";
                  document.body.appendChild(ta);
                  ta.select();
                  document.execCommand("copy");
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

            return (
              <pre
                ref={preRef}
                className={`md-pre relative my-3 overflow-hidden rounded-lg border border-slate-200 dark:border-neutral-800 bg-slate-50 dark:bg-neutral-900/50`}
              >
                {/* Header with language and copy button */}
                <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 dark:border-neutral-800 bg-slate-100 dark:bg-neutral-800/50">
                  {language && (
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-400 tracking-wide">
                      {language}
                    </span>
                  )}
                  <button
                    type="button"
                    aria-label={copied ? "Copied" : "Copy code"}
                    onClick={onCopy}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-neutral-700 bg-white/95 dark:bg-neutral-900/90 px-2 py-1 text-xs text-slate-700 dark:text-slate-200 shadow hover:bg-white dark:hover:bg-neutral-800 transition-colors"
                  >
                    {copied ? (
                      <ClipboardCheck className="h-4 w-4" />
                    ) : (
                      <Clipboard className="h-4 w-4" />
                    )}
                    <span className="sr-only">{copied ? "Copied" : "Copy"}</span>
                  </button>
                </div>

                {/* padded, scrollable code area */}
                <div className="p-4 overflow-auto text-sm font-mono text-slate-700 dark:text-slate-200 leading-snug">
                  {children}
                </div>
              </pre>
            );
          },
          code: function CodeRenderer({ className, children }: { className?: string; children?: React.ReactNode }) {
            const [isExpanded, setIsExpanded] = React.useState(false);
            
            if (className?.includes('language-thinking')) {

              // Height for ~3 lines. Do NOT subtract padding; we remove padding from the height-bearing box.
              const collapsedHeight = 69; // px

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
                      className={isExpanded ? "px-4 py-3" : "px-4"}
                      style={
                        isExpanded
                          ? {}
                          : {
                              height: `${collapsedHeight}px`,
                              overflow: "hidden",
                              display: "flex",
                              flexDirection: "column",
                              justifyContent: "flex-end"
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
                <code className={`${className} bg-slate-100 dark:bg-neutral-800 text-slate-700 dark:text-slate-300 px-1 rounded`}>
                  {children}
                </code>
              );
            }

            return <code className={`${className} bg-slate-50 dark:bg-neutral-900/50`}>{children}</code>;
          },
          hr: () => <hr className="my-4 border-slate-200 dark:border-neutral-800" />,
          p: ({ children }) => <p className="md-p whitespace-pre-wrap leading-relaxed mt-4 first:mt-0">{children}</p>,
          h1: ({ children }) => <h1 className="md-h1 text-2xl font-bold leading-tight mt-6 mb-4 pb-2 border-b border-slate-200 dark:border-neutral-800 first:mt-0">{children}</h1>,
          h2: ({ children }) => <h2 className="md-h2 text-xl font-semibold leading-snug mt-5 mb-3 first:mt-0">{children}</h2>,
          h3: ({ children }) => <h3 className="md-h3 text-lg font-medium leading-normal mt-4 mb-2 first:mt-0">{children}</h3>,
          ul: ({ children }) => <ul className="list-disc ml-6 space-y-2 mb-4">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal ml-6 space-y-2 mb-4">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-slate-300 dark:border-neutral-700 pl-4 py-2 my-4 italic text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-neutral-900/50 rounded-r-lg leading-relaxed">
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto my-4 rounded-lg border border-slate-200 dark:border-neutral-800">
              <table className="min-w-full text-sm border-collapse bg-white dark:bg-neutral-950">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="text-left px-4 py-3 border-b border-slate-200 dark:border-neutral-800 font-semibold bg-slate-50 dark:bg-neutral-900 first:rounded-tl-lg last:rounded-tr-lg">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-4 py-3 border-b border-slate-100 dark:border-neutral-900 align-top last:border-b-0">{children}</td>
          ),
        }}
      >
        {processedText}
      </ReactMarkdown>
    </div>
  );
};

export default Markdown;
