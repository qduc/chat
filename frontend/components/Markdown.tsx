"use client";
import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

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
  return (
    <div className={className}>
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
          code: function CodeRenderer(p) {
            const { inline, className: cls, children } = p as any;
            const hasLanguage = /\blanguage-/.test(cls || "");
            const match = /language-(\w+)/.exec(cls || "");
            const language = match ? match[1] : "";
            const isInline = inline ?? !hasLanguage;
            const className = ["md-code", cls].filter(Boolean).join(" ");

            // Hooks must be called unconditionally
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

            if (isInline) {
              return (
                <code className="md-inline-code px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-neutral-800 text-[0.9em] font-mono border border-slate-200 dark:border-neutral-700">
                  {children}
                </code>
              );
            }

            return (
              <div className="relative my-3" style={{ position: 'relative' }}>
                <div className="absolute inset-0 z-10 pointer-events-none">
                  <div className="sticky top-2 flex justify-end">
                    <button
                      type="button"
                      aria-label={copied ? "Copied" : "Copy code"}
                      onClick={onCopy}
                      className="pointer-events-auto mr-2 mt-2 inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-neutral-700 bg-white/80 dark:bg-neutral-900/70 backdrop-blur px-2 py-1 text-xs text-slate-700 dark:text-slate-200 shadow hover:bg-white dark:hover:bg-neutral-800 transition-colors"
                    >
                      {copied ? (
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
                          <path fillRule="evenodd" d="M2.25 12a9.75 9.75 0 1117.132 6.132l2.244 2.244a.75.75 0 11-1.06 1.06l-2.244-2.244A9.75 9.75 0 012.25 12zm13.28-2.03a.75.75 0 00-1.06-1.06l-4.72 4.72-1.44-1.44a.75.75 0 10-1.06 1.06l1.97 1.97a.75.75 0 001.06 0l5.25-5.25z" clipRule="evenodd" />
                        </svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
                          <rect x="9" y="9" width="11" height="11" rx="2" />
                          <rect x="4" y="4" width="11" height="11" rx="2" />
                        </svg>
                      )}
                      <span className="sr-only">{copied ? "Copied" : "Copy"}</span>
                    </button>
                  </div>
                </div>

                <pre ref={preRef} className="relative md-pre overflow-x-auto rounded-lg text-[0.9em] bg-slate-50 dark:bg-neutral-900 border border-slate-200 dark:border-neutral-800 shadow-sm pr-10 pt-10">
                  {language && (
                    <span className="absolute top-3 left-3 text-xs text-slate-500 dark:text-slate-400">
                      {language}
                    </span>
                  )}
                  <code className={`${className} block p-0`}>{children}</code>
                </pre>
              </div>
            );
          },
          p: ({ children }) => <p className="md-p whitespace-pre-wrap leading-relaxed">{children}</p>,
          h1: ({ children }) => <h1 className="md-h1 text-2xl font-bold mt-6 mb-4 pb-2 border-b border-slate-200 dark:border-neutral-800">{children}</h1>,
          h2: ({ children }) => <h2 className="md-h2 text-xl font-semibold mt-5 mb-3">{children}</h2>,
          h3: ({ children }) => <h3 className="md-h3 text-lg font-medium mt-4 mb-2">{children}</h3>,
          ul: ({ children }) => <ul className="list-disc ml-6 space-y-1 mb-4">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal ml-6 space-y-1 mb-4">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-slate-300 dark:border-neutral-700 pl-4 py-2 my-4 italic text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-neutral-900/50 rounded-r-lg">
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
