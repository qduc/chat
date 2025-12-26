import React from 'react';
import { X, AlertCircle, Loader2, FileText, FileCode } from 'lucide-react';
import type { FileAttachment, FileUploadProgress } from '@/lib/types';

interface FilePreviewProps {
  files: FileAttachment[];
  uploadProgress?: FileUploadProgress[];
  onRemove?: (fileId: string) => void;
  className?: string;
}

export function FilePreview({ files, uploadProgress, onRemove, className = '' }: FilePreviewProps) {
  const getProgressForFile = (fileId: string) => {
    return uploadProgress?.find((p) => p.fileId === fileId);
  };

  if (files.length === 0) {
    return null;
  }

  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
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
    <div className="relative group rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800 p-3 min-w-[200px] max-w-[300px]">
      <div className="flex items-start gap-3">
        {/* File Icon */}
        <div
          className={`flex-shrink-0 w-10 h-10 rounded flex items-center justify-center ${
            hasError
              ? 'bg-red-100 dark:bg-red-900/20'
              : isCodeFile
                ? 'bg-blue-100 dark:bg-blue-900/20'
              : 'bg-zinc-100 dark:bg-zinc-700'
          }`}
        >
          {hasError ? (
            <AlertCircle className="w-5 h-5 text-red-500" />
          ) : isUploading ? (
              <Loader2 className="w-5 h-5 text-zinc-500 animate-spin" />
          ) : isCodeFile ? (
            <FileCode className={`w-5 h-5 text-blue-600 dark:text-blue-400`} />
          ) : (
                  <FileText className="w-5 h-5 text-zinc-600 dark:text-zinc-400" />
          )}
        </div>

        {/* File Info */}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">
            {file.name}
          </div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            {(file.size / 1024).toFixed(1)} KB
            {file.type && ` • ${ext.toUpperCase()}`}
          </div>
          {isUploading && progress && (
            <div className="mt-2">
              <div className="w-full bg-zinc-200 dark:bg-zinc-700 rounded-full h-1">
                <div
                  className="bg-blue-600 dark:bg-blue-500 h-1 rounded-full transition-all duration-300"
                  style={{ width: `${progress.progress}%` }}
                />
              </div>
            </div>
          )}
          {hasError && progress?.error && (
            <div className="text-xs text-red-600 dark:text-red-400 mt-1">{progress.error}</div>
          )}
        </div>

        {/* Remove Button */}
        {onRemove && !isUploading && (
          <button
            type="button"
            onClick={() => onRemove(file.id)}
            className="flex-shrink-0 w-6 h-6 rounded-full bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 text-zinc-600 dark:text-zinc-300 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            aria-label={`Remove ${file.name}`}
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
