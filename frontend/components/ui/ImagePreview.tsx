import React from 'react';
import ReactDOM from 'react-dom';
import { X, AlertCircle, Loader2 } from 'lucide-react';
import { cn } from '../../lib/cn';
import { IconButton } from './Button';
import Modal from './Modal';
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

export function ImagePreview({ images, uploadProgress, onRemove, className }: ImagePreviewProps) {
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
      <div className={cn('flex flex-wrap gap-2', className)}>
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
      <Modal
        open={selectedImage !== null}
        onClose={handleClosePreview}
        title={selectedImage?.image.name ?? 'Image preview'}
        closeLabel="Close image preview"
        size="full"
        bodyClassName="flex items-center justify-center p-4"
      >
        {selectedImage && (
          <img
            src={selectedImage.src}
            alt={selectedImage.image.alt || selectedImage.image.name}
            className="max-h-full max-w-full object-contain"
          />
        )}
      </Modal>
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
    <div className="group relative size-20 overflow-hidden rounded-control border border-line bg-muted">
      <button
        type="button"
        onClick={handleClick}
        disabled={!canPreview}
        aria-label={`Preview ${image.name}`}
        title={`${image.name} · ${(image.size / 1024).toFixed(0)} KB`}
        className={cn(
          'block size-full focus-ring-inset',
          canPreview ? 'cursor-zoom-in' : 'cursor-not-allowed'
        )}
      >
        {src && (
          <img
            src={src}
            alt={image.alt || image.name}
            className={cn(
              'size-full object-cover transition-opacity',
              loading && 'opacity-50',
              hasError && 'opacity-30'
            )}
          />
        )}
      </button>

      {(loading || isUploading) && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="flex items-center gap-1 rounded-full bg-surface px-2 text-xs text-fg">
            <Loader2 aria-hidden="true" className="size-3 animate-spin" />
            {progress ? `${progress.progress}%` : null}
          </span>
        </div>
      )}

      {hasError && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="flex size-6 items-center justify-center rounded-full bg-danger-subtle text-danger">
            <AlertCircle aria-label="Upload failed" className="size-4" />
          </span>
        </div>
      )}

      {onRemove && !isUploading && (
        <IconButton
          label={`Remove ${image.name}`}
          variant="secondary"
          size="sm"
          onClick={() => onRemove(image.id)}
          className="absolute top-1 right-1 size-6 rounded-full opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100"
        >
          <X />
        </IconButton>
      )}
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
  fileFilter?: (file: File) => boolean;
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
  fileFilter,
}: ImageUploadZoneProps) {
  const [dragOver, setDragOver] = React.useState(false);
  const dragCounterRef = React.useRef(0);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);

    if (disabled) return;

    // Use custom fileFilter if provided, otherwise default to image files
    const defaultFilter = (file: File) => file.type.startsWith('image/');
    const filterFn = fileFilter || defaultFilter;

    const files = Array.from(e.dataTransfer.files).filter(filterFn);

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
      // Fires continuously while dragging; dragenter already toggled state.
      e.preventDefault();
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
            className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4"
          >
            <div className="flex flex-col gap-1 rounded-card border border-line bg-surface p-6 text-center shadow-popover">
              <div className="text-base font-medium text-fg">Drop files here</div>
              <div className="text-sm text-fg-muted">
                Images and text files will be uploaded and attached to your message
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
          ${dragOver && !disabled && !fullPage ? 'bg-accent-subtle' : ''}
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
