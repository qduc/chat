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
          code: (p) => {
            const { inline, className: cls, children, ...props } = p as any;
            // Keep classes provided by rehype-highlight (e.g., 'hljs', 'language-xyz', token spans)
            const className = ["md-code", cls].filter(Boolean).join(" ");
            if (inline) {
              return (
                <code
                  className="md-inline-code px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-neutral-800 text-[0.9em] font-mono border border-slate-200 dark:border-neutral-700"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <pre className="md-pre overflow-x-auto rounded-lg my-3 text-[0.9em] bg-slate-50 dark:bg-neutral-900 border border-slate-200 dark:border-neutral-800 shadow-sm">
                <code className={`${className} block p-0`}>{children}</code>
              </pre>
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
