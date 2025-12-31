import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, FileText, FileCode, Copy, Check } from 'lucide-react';
import hljs from 'highlight.js';
import type { FileContent } from '../../lib/types';

// Map file extensions to highlight.js language identifiers
const LANGUAGE_MAP: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  rb: 'ruby',
  java: 'java',
  cpp: 'cpp',
  c: 'c',
  h: 'c',
  cs: 'csharp',
  go: 'go',
  rs: 'rust',
  php: 'php',
  swift: 'swift',
  kt: 'kotlin',
  scala: 'scala',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  json: 'json',
  xml: 'xml',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  sass: 'scss',
  less: 'less',
  sql: 'sql',
  yaml: 'yaml',
  yml: 'yaml',
  md: 'markdown',
  markdown: 'markdown',
  graphql: 'graphql',
  gql: 'graphql',
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  cmake: 'cmake',
  ini: 'ini',
  toml: 'ini',
  lua: 'lua',
  perl: 'perl',
  r: 'r',
  matlab: 'matlab',
  vue: 'xml',
  svelte: 'xml',
};

interface FileContentPreviewProps {
  files: FileContent[];
  className?: string;
}

export function FileContentPreview({ files, className = '' }: FileContentPreviewProps) {
  const [selectedFile, setSelectedFile] = useState<FileContent | null>(null);

  const handleFileClick = useCallback((file: FileContent) => {
    setSelectedFile(file);
  }, []);

  const handleClosePreview = useCallback(() => {
    setSelectedFile(null);
  }, []);

  if (files.length === 0) {
    return null;
  }

  return (
    <>
      <div className={`flex flex-wrap gap-2 ${className}`}>
        {files.map((file, index) => (
          <FileItem key={`${file.name}-${index}`} file={file} onClick={handleFileClick} />
        ))}
      </div>
      {selectedFile && <FilePreviewOverlay file={selectedFile} onClose={handleClosePreview} />}
    </>
  );
}

interface FileItemProps {
  file: FileContent;
  onClick: (file: FileContent) => void;
}

function FileItem({ file, onClick }: FileItemProps) {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const isCodeFile = [
    'js',
    'jsx',
    'ts',
    'tsx',
    'py',
    'rb',
    'java',
    'cpp',
    'go',
    'rs',
    'c',
    'h',
    'cs',
    'php',
    'swift',
    'kt',
    'scala',
  ].includes(ext);

  return (
    <button
      type="button"
      onClick={() => onClick(file)}
      className="group flex items-center gap-2 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors cursor-pointer"
      aria-label={`View ${file.name}`}
    >
      <div
        className={`flex-shrink-0 w-8 h-8 rounded flex items-center justify-center ${
          isCodeFile ? 'bg-blue-100 dark:bg-blue-900/30' : 'bg-zinc-100 dark:bg-zinc-700'
        }`}
      >
        {isCodeFile ? (
          <FileCode className="w-4 h-4 text-blue-600 dark:text-blue-400" />
        ) : (
          <FileText className="w-4 h-4 text-zinc-600 dark:text-zinc-400" />
        )}
      </div>
      <div className="text-left min-w-0">
        <div className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate max-w-[150px]">
          {file.name}
        </div>
        <div className="text-xs text-zinc-500 dark:text-zinc-400">{ext.toUpperCase()}</div>
      </div>
    </button>
  );
}

interface FilePreviewOverlayProps {
  file: FileContent;
  onClose: () => void;
}

function FilePreviewOverlay({ file, onClose }: FilePreviewOverlayProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(file.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [file.content]);

  const handleBackdropClick = () => {
    onClose();
  };

  const stopPropagation = (event: React.MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
  };

  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const isCodeFile = Object.hasOwn(LANGUAGE_MAP, ext) || Object.hasOwn(LANGUAGE_MAP, file.language);

  // Get highlighted HTML for the file content
  const highlightedHtml = useMemo(() => {
    // Try to get language from extension first, then from file.language
    const lang = LANGUAGE_MAP[ext] || LANGUAGE_MAP[file.language] || file.language;

    try {
      // Check if the language is supported by highlight.js
      if (lang && hljs.getLanguage(lang)) {
        const result = hljs.highlight(file.content, { language: lang });
        return result.value;
      }
      // Try auto-detection if no specific language
      const autoResult = hljs.highlightAuto(file.content);
      if (autoResult.relevance > 5) {
        return autoResult.value;
      }
    } catch {
      // Fall back to plain text on error
    }
    return null;
  }, [file.content, file.language, ext]);

  if (typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative w-full max-w-4xl max-h-[90vh] bg-white dark:bg-zinc-900 rounded-lg shadow-2xl flex flex-col"
        onClick={stopPropagation}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">
          <div className="flex items-center gap-3">
            <div
              className={`flex-shrink-0 w-8 h-8 rounded flex items-center justify-center ${
                isCodeFile ? 'bg-blue-100 dark:bg-blue-900/30' : 'bg-zinc-100 dark:bg-zinc-700'
              }`}
            >
              {isCodeFile ? (
                <FileCode className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              ) : (
                <FileText className="w-4 h-4 text-zinc-600 dark:text-zinc-400" />
              )}
            </div>
            <div>
              <div className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                {file.name}
              </div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                {file.language.toUpperCase()}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 transition-colors"
              aria-label="Copy file content"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4 text-green-600" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  <span>Copy</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 transition-colors"
              aria-label="Close file preview"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          <pre className="text-sm font-mono whitespace-pre-wrap break-words">
            {highlightedHtml ? (
              <code className="hljs" dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
            ) : (
              <code className="text-zinc-800 dark:text-zinc-200">{file.content}</code>
            )}
          </pre>
        </div>
      </div>
    </div>,
    document.body
  );
}
