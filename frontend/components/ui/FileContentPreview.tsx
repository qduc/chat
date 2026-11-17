import React, { useState, useCallback, useMemo } from 'react';
import { FileText, FileCode, Copy, Check } from 'lucide-react';
import hljs from 'highlight.js';
import type { FileContent } from '../../lib/types';
import { Dialog, DialogContent } from './Dialog';
import { Button } from './Button';
import { cn } from '../../lib/cn';

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
      <div className={cn('flex flex-wrap gap-2', className)}>
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
      className="flex items-center gap-2 rounded-card border border-line bg-surface px-3 py-2 transition-colors hover:bg-muted focus-ring"
      aria-label={`View ${file.name}`}
    >
      <FileTypeIcon isCodeFile={isCodeFile} />
      <div className="min-w-0 text-left">
        <div className="max-w-38 truncate text-sm font-medium text-fg">{file.name}</div>
        <div className="text-xs text-fg-subtle">{ext.toUpperCase()}</div>
      </div>
    </button>
  );
}

/** Neutral file-type chip (file types never use status or accent colors). */
function FileTypeIcon({ isCodeFile }: { isCodeFile: boolean }) {
  const Icon = isCodeFile ? FileCode : FileText;
  return (
    <span
      aria-hidden="true"
      className="flex size-8 shrink-0 items-center justify-center rounded-control bg-muted text-fg-muted"
    >
      <Icon className="size-4" />
    </span>
  );
}

interface FilePreviewOverlayProps {
  file: FileContent;
  onClose: () => void;
}

export function FilePreviewOverlay({ file, onClose }: FilePreviewOverlayProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(file.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [file.content]);

  const ext = file.name.split('.').pop()?.toLowerCase() || '';

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

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        title={file.name}
        description={file.language.toUpperCase()}
        size="xl"
        closeLabel="Close file preview"
        bodyClassName="flex flex-col p-0"
        footer={
          <Button onClick={handleCopy} aria-label="Copy file content">
            {copied ? <Check /> : <Copy />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        }
      >
        <div
          tabIndex={0}
          role="region"
          aria-label={`${file.name} contents`}
          className="min-h-0 flex-1 overflow-auto bg-muted p-4 focus-ring-inset"
        >
          <pre className="font-mono text-sm break-words whitespace-pre-wrap text-fg">
            {highlightedHtml ? (
              <code className="hljs" dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
            ) : (
              <code>{file.content}</code>
            )}
          </pre>
        </div>
      </DialogContent>
    </Dialog>
  );
}
