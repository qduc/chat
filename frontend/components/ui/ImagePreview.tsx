import React from 'react';
import ReactDOM from 'react-dom';
import { X, AlertCircle, Loader2 } from 'lucide-react';
import type { ImageAttachment, ImageUploadProgress } from '@/lib/types';
import { useSecureImageUrl } from '@/hooks/useSecureImageUrl';

interface ImagePreviewProps {
  images: ImageAttachment[];
  uploadProgress?: ImageUploadProgress[];
  onRemove?: (imageId: string) => void;
  className?: string;
}

interface SelectedPreview {
  image: ImageAttachment;
  src: string;
}

export function ImagePreview({
  images,
  uploadProgress,
  onRemove,
  className = '',
}: ImagePreviewProps) {
  const [selectedImage, setSelectedImage] = React.useState<SelectedPreview | null>(null);

  const handleClosePreview = () => setSelectedImage(null);

  const getProgressForImage = (imageId: string) => {
    return uploadProgress?.find((p) => p.imageId === imageId);
  };

  if (images.length === 0) {
    // ← Move after hooks
    return null;
  }

  return (
    <>
      <div className={`flex flex-wrap gap-2 ${className}`}>
        {images.map((image) => (
          <PreviewItem
            key={image.id}
            image={image}
            progress={getProgressForImage(image.id)}
            onRemove={onRemove}
            onPreview={(img, src) => setSelectedImage({ image: img, src })}
          />
        ))}
      </div>
      {selectedImage &&
        typeof document !== 'undefined' &&
        ReactDOM.createPortal(
          <div
            className="fixed inset-0 z-[999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={handleClosePreview}
            role="dialog"
            aria-modal="true"
          >
            <div className="relative max-h-full max-w-full" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={handleClosePreview}
                className="absolute -top-3 -right-3 md:-top-4 md:-right-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-slate-700 shadow-lg hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                aria-label="Close image preview"
              >
                <X className="h-4 w-4" />
              </button>
              <img
                src={selectedImage.src}
                alt={selectedImage.image.alt || selectedImage.image.name}
                className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg shadow-2xl"
              />
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

interface PreviewItemProps {
  image: ImageAttachment;
  progress?: ImageUploadProgress;
  onRemove?: (id: string) => void;
  onPreview: (image: ImageAttachment, src: string) => void;
}

function PreviewItem({ image, progress, onRemove, onPreview }: PreviewItemProps) {
  const preferredUrl = image.downloadUrl ?? image.url;
  const { src, loading, error } = useSecureImageUrl(preferredUrl);
  const isUploading = progress?.state === 'uploading' || progress?.state === 'processing';
  const hasError = progress?.state === 'error' || error;
  const canPreview = !isUploading && !hasError && Boolean(src);

  const handleClick = () => {
    if (canPreview) {
      onPreview(image, src);
    }
  };

  return (
    <div
      className="relative group rounded-lg overflow-hidden border border-slate-200 dark:border-neutral-700 bg-slate-50 dark:bg-neutral-800"
      style={{ width: '80px', height: '80px' }}
    >
      <button
        type="button"
        onClick={handleClick}
        disabled={!canPreview}
        aria-label={`Preview ${image.name}`}
        className={`w-full h-full block p-0 m-0 border-0 bg-transparent ${canPreview ? 'cursor-zoom-in' : 'cursor-not-allowed'}`}
      >
        {src && (
          <img
            src={src}
            alt={image.alt || image.name}
            className={`w-full h-full object-cover transition-opacity ${
              loading ? 'opacity-50' : 'opacity-100'
            } ${hasError ? 'opacity-30' : ''}`}
          />
        )}
      </button>

      {(loading || isUploading) && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/20">
          <div className="flex flex-col items-center gap-1">
            <Loader2 className="w-4 h-4 text-white animate-spin" />
            {progress && <div className="text-xs text-white font-medium">{progress.progress}%</div>}
          </div>
        </div>
      )}

      {hasError && (
        <div className="absolute inset-0 flex items-center justify-center bg-red-500/20">
          <AlertCircle className="w-4 h-4 text-red-500" />
        </div>
      )}

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

      <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs px-1 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="truncate">{image.name}</div>
        <div>{(image.size / 1024).toFixed(0)} KB</div>
      </div>
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
  fullPage?: boolean;
  clickToUpload?: boolean;
}

export function ImageUploadZone({
  onFiles,
  maxFiles = 5,
  accept = 'image/*',
  disabled = false,
  className = '',
  children,
  fullPage = false,
  clickToUpload = true,
}: ImageUploadZoneProps) {
  const [dragOver, setDragOver] = React.useState(false);
  const dragCounterRef = React.useRef(0);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);

    if (disabled) return;

    const files = Array.from(e.dataTransfer.files).filter((file) => file.type.startsWith('image/'));

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

  // When using fullPage mode we want the overlay to appear when dragging
  // anywhere on the window and prevent the browser's default drop behaviour
  // (which opens images). We add global listeners while fullPage is true.
  React.useEffect(() => {
    if (!fullPage) return;

    const onWindowDragEnter = (e: DragEvent) => {
      e.preventDefault();
      dragCounterRef.current += 1;
      setDragOver(true);
    };

    const onWindowDragOver = (e: DragEvent) => {
      e.preventDefault();
      setDragOver(true);
    };

    const onWindowDragLeave = (e: DragEvent) => {
      e.preventDefault();
      // decrement counter and only hide when we've left completely
      dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
      if (dragCounterRef.current === 0) {
        setDragOver(false);
      }
    };

    const onWindowDrop = (e: DragEvent) => {
      // prevent default browser behaviour (opening the file)
      e.preventDefault();
      dragCounterRef.current = 0;
      setDragOver(false);
      // Do not call onFiles here. The portal overlay (when visible)
      // will receive the drop and call `onFiles`. This handler only
      // prevents the browser from opening the dropped file when dropping
      // outside the overlay.
    };

    window.addEventListener('dragenter', onWindowDragEnter);
    window.addEventListener('dragover', onWindowDragOver);
    window.addEventListener('dragleave', onWindowDragLeave);
    window.addEventListener('drop', onWindowDrop);

    return () => {
      window.removeEventListener('dragenter', onWindowDragEnter);
      window.removeEventListener('dragover', onWindowDragOver);
      window.removeEventListener('dragleave', onWindowDragLeave);
      window.removeEventListener('drop', onWindowDrop);
      dragCounterRef.current = 0;
      setDragOver(false);
    };
  }, [fullPage]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      onFiles(files.slice(0, maxFiles));
    }
    // Reset input value so same file can be selected again
    e.target.value = '';
  };

  return (
    <>
      {fullPage &&
        dragOver &&
        ReactDOM.createPortal(
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            className="fixed inset-0 z-[9999] flex items-center justify-center pointer-events-auto"
            style={{ backgroundColor: 'rgba(2,6,23,0.35)' }}
          >
            <div className="text-center p-6 rounded-lg bg-white/90 dark:bg-neutral-900/90 border border-slate-200 dark:border-neutral-700 shadow-lg">
              <div className="text-lg font-medium text-slate-900 dark:text-slate-100">
                Drop images here
              </div>
              <div className="text-sm text-slate-600 dark:text-slate-300 mt-1">
                They will be uploaded and attached to your message
              </div>
            </div>
          </div>,
          document.body
        )}

      <div
        onDrop={!fullPage ? handleDrop : undefined}
        onDragOver={!fullPage ? handleDragOver : undefined}
        onDragLeave={!fullPage ? handleDragLeave : undefined}
        className={`
          relative
          ${dragOver && !disabled && !fullPage ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-600' : ''}
          ${disabled ? 'opacity-50 cursor-not-allowed' : clickToUpload ? 'cursor-pointer' : ''}
          ${className}
        `}
      >
        {clickToUpload && (
          <input
            type="file"
            accept={accept}
            multiple
            disabled={disabled}
            onChange={handleFileInput}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
          />
        )}
        {children}
      </div>
    </>
  );
}
