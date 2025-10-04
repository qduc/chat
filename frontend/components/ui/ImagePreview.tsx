import React from 'react';
import { X, AlertCircle, Loader2 } from 'lucide-react';
import type { ImageAttachment, ImageUploadProgress } from '../../lib/chat/types';

interface ImagePreviewProps {
  images: ImageAttachment[];
  uploadProgress?: ImageUploadProgress[];
  onRemove?: (imageId: string) => void;
  className?: string;
}

export function ImagePreview({ images, uploadProgress, onRemove, className = '' }: ImagePreviewProps) {
  if (images.length === 0) {
    return null;
  }

  const getProgressForImage = (imageId: string) => {
    return uploadProgress?.find(p => p.imageId === imageId);
  };

  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {images.map((image) => {
        const progress = getProgressForImage(image.id);
        const isUploading = progress?.state === 'uploading' || progress?.state === 'processing';
        const hasError = progress?.state === 'error';

        return (
          <div
            key={image.id}
            className="relative group rounded-lg overflow-hidden border border-slate-200 dark:border-neutral-700 bg-slate-50 dark:bg-neutral-800"
            style={{ width: '80px', height: '80px' }}
          >
            {/* Image */}
            <img
              src={image.url}
              alt={image.alt || image.name}
              className={`w-full h-full object-cover transition-opacity ${
                isUploading ? 'opacity-50' : 'opacity-100'
              } ${hasError ? 'opacity-30' : ''}`}
            />

            {/* Upload Progress Overlay */}
            {isUploading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                <div className="flex flex-col items-center gap-1">
                  <Loader2 className="w-4 h-4 text-white animate-spin" />
                  {progress && (
                    <div className="text-xs text-white font-medium">
                      {progress.progress}%
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Error Overlay */}
            {hasError && (
              <div className="absolute inset-0 flex items-center justify-center bg-red-500/20">
                <AlertCircle className="w-4 h-4 text-red-500" />
              </div>
            )}

            {/* Remove Button */}
            {onRemove && !isUploading && (
              <button
                type="button"
                onClick={() => onRemove(image.id)}
                className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label={`Remove ${image.name}`}
              >
                <X className="w-3 h-3" />
              </button>
            )}

            {/* File Info Tooltip */}
            <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs px-1 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <div className="truncate">{image.name}</div>
              <div>{(image.size / 1024).toFixed(0)} KB</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface ImageUploadZoneProps {
  onFiles: (files: File[]) => void;
  maxFiles?: number;
  accept?: string;
  disabled?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export function ImageUploadZone({
  onFiles,
  maxFiles = 5,
  accept = 'image/*',
  disabled = false,
  className = '',
  children,
}: ImageUploadZoneProps) {
  const [dragOver, setDragOver] = React.useState(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);

    if (disabled) return;

    const files = Array.from(e.dataTransfer.files).filter(file =>
      file.type.startsWith('image/')
    );

    if (files.length > 0) {
      onFiles(files.slice(0, maxFiles));
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) {
      setDragOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      onFiles(files.slice(0, maxFiles));
    }
    // Reset input value so same file can be selected again
    e.target.value = '';
  };

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      className={`
        relative
        ${dragOver && !disabled ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-600' : ''}
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        ${className}
      `}
    >
      <input
        type="file"
        accept={accept}
        multiple
        disabled={disabled}
        onChange={handleFileInput}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
      />
      {children}
    </div>
  );
}