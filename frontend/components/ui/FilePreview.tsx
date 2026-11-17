import React from 'react';
import { X, AlertCircle, Loader2, FileText, FileCode } from 'lucide-react';
import type { FileAttachment, FileUploadProgress } from '@/lib/types';
import { cn } from '../../lib/cn';
import { IconButton } from './Button';

interface FilePreviewProps {
  files: FileAttachment[];
  uploadProgress?: FileUploadProgress[];
  onRemove?: (fileId: string) => void;
  className?: string;
}

export function FilePreview({ files, uploadProgress, onRemove, className }: FilePreviewProps) {
  const getProgressForFile = (fileId: string) => {
    return uploadProgress?.find((p) => p.fileId === fileId);
  };

  if (files.length === 0) {
    return null;
  }

  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {files.map((file) => (
        <PreviewItem
          key={file.id}
          file={file}
          progress={getProgressForFile(file.id)}
          onRemove={onRemove}
        />
      ))}
    </div>
  );
}

interface PreviewItemProps {
  file: FileAttachment;
  progress?: FileUploadProgress;
  onRemove?: (id: string) => void;
}

function PreviewItem({ file, progress, onRemove }: PreviewItemProps) {
  const isUploading = progress?.state === 'uploading' || progress?.state === 'processing';
  const hasError = progress?.state === 'error';

  // Get file extension for icon selection
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
  ].includes(ext);

  return (
    <div className="group flex w-64 max-w-full items-start gap-3 rounded-card border border-line bg-canvas-subtle p-3">
      <span
        aria-hidden="true"
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-control [&_svg]:size-4',
          hasError ? 'bg-danger-subtle text-danger' : 'bg-muted text-fg-muted'
        )}
      >
        {hasError ? (
          <AlertCircle />
        ) : isUploading ? (
          <Loader2 className="animate-spin" />
        ) : isCodeFile ? (
          <FileCode />
        ) : (
          <FileText />
        )}
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="truncate text-sm font-medium text-fg">{file.name}</div>
        <div className="text-xs text-fg-muted">
          {(file.size / 1024).toFixed(1)} KB
          {file.type && ` • ${ext.toUpperCase()}`}
        </div>
        {isUploading && progress && (
          <div
            role="progressbar"
            aria-label={`Uploading ${file.name}`}
            aria-valuenow={progress.progress}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-1 w-full overflow-hidden rounded-full bg-emphasis"
          >
            <div
              className="h-full rounded-full bg-accent transition-[width]"
              style={{ width: `${progress.progress}%` }}
            />
          </div>
        )}
        {hasError && progress?.error && <div className="text-xs text-danger">{progress.error}</div>}
      </div>

      {onRemove && !isUploading && (
        <IconButton
          label={`Remove ${file.name}`}
          size="sm"
          onClick={() => onRemove(file.id)}
          className="size-7 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100"
        >
          <X />
        </IconButton>
      )}
    </div>
  );
}
