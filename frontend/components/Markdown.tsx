"use client";
import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { useTheme } from "../contexts/ThemeContext";
import { ClipboardCheck, Clipboard } from 'lucide-react';

interface MarkdownProps {
  text: string;
  className?: string;
}

// Library-based Markdown renderer with:
// - GFM support (tables, strikethrough, task lists)
// - Syntax highlighting via highlight.js (auto-detects or uses language-* class)
// - Secure by default (no raw HTML rendering)
// - Accessible links opening in a new tab
export const Markdown: React.FC<MarkdownProps> = ({ text, className }) => {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  // Note: Syntax highlighting theme is automatically handled by CSS
  // based on the .dark class applied to the document root

  return (
    <div className={`${className || ''} ${isDark ? 'dark' : ''}`}>
      <ReactMarkdown
        // Do NOT enable raw HTML to prevent XSS
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { ignoreMissing: true }]]}
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

            return (
              <pre
                ref={preRef}
                className={`md-pre relative my-3 overflow-hidden rounded-lg border border-slate-200 dark:border-neutral-800 bg-slate-50 dark:bg-neutral-900/50`}
              >
                {/* copy button container (keeps button visually above content) */}
                <div className="pointer-events-none absolute inset-0 flex justify-end p-2">
                  <div className="pointer-events-auto">
                    <button
                      type="button"
                      aria-label={copied ? "Copied" : "Copy code"}
                      onClick={onCopy}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-neutral-700 bg-white/80 dark:bg-neutral-900/70 backdrop-blur px-2 py-1 text-xs text-slate-700 dark:text-slate-200 shadow hover:bg-white dark:hover:bg-neutral-800 transition-colors"
                    >
                      {copied ? (
                        <ClipboardCheck className="h-4 w-4" />
                      ) : (
                        <Clipboard className="h-4 w-4" />
                      )}
                      <span className="sr-only">{copied ? "Copied" : "Copy"}</span>
                    </button>
                  </div>
                </div>

                {/* padded, scrollable code area */}
                <div className="p-4 overflow-auto text-sm font-mono text-slate-700 dark:text-slate-200 leading-snug">
                  {children}
                </div>
              </pre>
            );
          },
          code: function CodeRenderer({ className, children }: { className?: string; children?: React.ReactNode }) {
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
        {text}
      </ReactMarkdown>
    </div>
  );
};

export default Markdown;
