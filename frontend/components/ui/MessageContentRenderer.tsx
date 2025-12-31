import React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { MessageContent, ImageContent, InputAudioContent } from '../../lib';
import {
  extractImagesFromContent,
  hasImages,
  extractFilesAndText,
  extractAudioFromContent,
  hasAudio,
} from '../../lib';
import { audioPartToDataUrl } from '../../lib/audioUtils';
import Markdown from '../Markdown';
import { useSecureImageUrl } from '../../hooks/useSecureImageUrl';
import { FileContentPreview } from './FileContentPreview';

interface MessageContentRendererProps {
  content: MessageContent;
  isStreaming?: boolean;
  className?: string;
  role?: 'user' | 'assistant' | 'system' | 'tool';
}

interface SelectedImage {
  image: ImageContent;
  src: string;
}

export function MessageContentRenderer({
  content,
  isStreaming = false,
  className = '',
  role = 'user',
}: MessageContentRendererProps) {
  // Extract text, images, and files from content
  const { text: textWithoutFiles, files } = extractFilesAndText(content);
  const imageContents = extractImagesFromContent(content);
  const hasImageContent = hasImages(content);
  const audioContents = extractAudioFromContent(content);
  const hasAudioContent = hasAudio(content);
  const hasFileContent = files.length > 0;
  const [selectedImage, setSelectedImage] = React.useState<SelectedImage | null>(null);

  const handleImageClick = React.useCallback((image: ImageContent, src: string) => {
    setSelectedImage({ image, src });
  }, []);

  const handleClosePreview = React.useCallback(() => {
    setSelectedImage(null);
  }, []);

  // For assistant messages, render text first then images (generated images appear after text)
  // For user messages, render images first then text (attached images appear before text)
  const imagesFirst = role === 'user';

  return (
    <>
      <div className={`space-y-3 ${className}`}>
        {/* Render file attachments as icons */}
        {hasFileContent && (
          <div className="space-y-2">
            <FileContentPreview files={files} />
          </div>
        )}

        {/* Render audio for user messages (attached audio before text) */}
        {imagesFirst && hasAudioContent && audioContents.length > 0 && (
          <div className="space-y-2">
            <MessageAudios audios={audioContents} />
          </div>
        )}

        {/* Render images for user messages (attached images before text) */}
        {imagesFirst && hasImageContent && imageContents.length > 0 && (
          <div className="space-y-2">
            <MessageImages images={imageContents} onImageClick={handleImageClick} />
          </div>
        )}

        {/* Render text content (with file blocks removed) */}
        {textWithoutFiles && <Markdown text={textWithoutFiles} isStreaming={isStreaming} />}

        {/* Render images after text for assistant messages (generated images after text) */}
        {!imagesFirst && hasImageContent && imageContents.length > 0 && (
          <div className="space-y-2">
            <MessageImages images={imageContents} onImageClick={handleImageClick} />
          </div>
        )}

        {/* Render audio after text for assistant messages */}
        {!imagesFirst && hasAudioContent && audioContents.length > 0 && (
          <div className="space-y-2">
            <MessageAudios audios={audioContents} />
          </div>
        )}

        {/* If no content at all, show placeholder */}
        {!textWithoutFiles && !hasImageContent && !hasFileContent && !hasAudioContent && (
          <span className="text-zinc-500 dark:text-zinc-400 italic">No content</span>
        )}
      </div>

      {selectedImage && (
        <ImagePreviewOverlay
          image={selectedImage.image}
          src={selectedImage.src}
          onClose={handleClosePreview}
        />
      )}
    </>
  );
}

function MessageAudios({ audios }: { audios: InputAudioContent[] }) {
  if (!audios.length) return null;

  return (
    <div className="space-y-2">
      {audios.map((audio, idx) => {
        const src = audioPartToDataUrl(audio);
        if (!src) {
          return (
            <div
              key={idx}
              className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800 p-3 text-sm text-zinc-600 dark:text-zinc-300"
            >
              Audio attachment (unavailable)
            </div>
          );
        }

        return (
          <div
            key={idx}
            className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800 p-3"
          >
            <audio controls preload="metadata" className="w-full">
              <source src={src} />
              Your browser does not support the audio element.
            </audio>
          </div>
        );
      })}
    </div>
  );
}

interface MessageImagesProps {
  images: ImageContent[];
  className?: string;
  onImageClick?: (image: ImageContent, src: string) => void;
}

function MessageImages({ images, className = '', onImageClick }: MessageImagesProps) {
  if (images.length === 0) {
    return null;
  }

  return (
    <div className={`grid gap-2 ${getGridClass(images.length)} ${className}`}>
      {images.map((image, index) => (
        <MessageImage key={index} image={image} onClick={onImageClick} />
      ))}
    </div>
  );
}

interface MessageImageProps {
  image: ImageContent;
  className?: string;
  onClick?: (image: ImageContent, src: string) => void;
}

function MessageImage({ image, className = '', onClick }: MessageImageProps) {
  const rawUrl =
    typeof (image as any)?.image_url === 'string'
      ? ((image as any).image_url as string)
      : (image.image_url?.url ?? '');
  const { src, loading: fetching, error: fetchError } = useSecureImageUrl(rawUrl);
  const [loaded, setLoaded] = React.useState(false);
  const [renderError, setRenderError] = React.useState(false);

  React.useEffect(() => {
    setLoaded(false);
    setRenderError(false);
  }, [src]);

  const combinedError = fetchError || renderError;
  const hasSource = Boolean(src);

  const handleLoad = () => {
    setLoaded(true);
    setRenderError(false);
  };

  const handleError = () => {
    setRenderError(true);
    setLoaded(false);
  };

  const handleClick = () => {
    if (!combinedError && hasSource && onClick) {
      onClick(image, src);
    }
  };

  const showSpinner = (fetching || (!loaded && hasSource)) && !combinedError;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={combinedError || !hasSource}
      className={`relative block w-full rounded-lg overflow-hidden ${
        showSpinner || combinedError ? 'bg-zinc-100 dark:bg-zinc-800' : ''
      } ${
        combinedError || !hasSource ? 'cursor-not-allowed' : 'cursor-zoom-in'
      } focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-zinc-900 ${className}`}
      aria-label="View image"
    >
      {showSpinner && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-zinc-300 dark:border-zinc-600 border-t-zinc-600 dark:border-t-zinc-300 rounded-full animate-spin" />
        </div>
      )}

      {combinedError && (
        <div className="absolute inset-0 flex items-center justify-center text-zinc-500 dark:text-zinc-400">
          <div className="text-center">
            <div className="w-8 h-8 mx-auto mb-2 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center">
              <span className="text-sm">!</span>
            </div>
            <div className="text-xs">Failed to load image</div>
          </div>
        </div>
      )}

      {hasSource && !combinedError && (
        <img
          src={src}
          alt="Chat message attachment"
          className={`max-w-full h-auto rounded-lg transition-opacity duration-200 ${
            loaded ? 'opacity-100' : 'opacity-0'
          }`}
          style={{ maxHeight: '400px', width: 'auto' }}
          onLoad={handleLoad}
          onError={handleError}
          loading="lazy"
        />
      )}
    </button>
  );
}

interface ImagePreviewOverlayProps {
  image: ImageContent;
  src: string;
  onClose: () => void;
}

function ImagePreviewOverlay({ src, onClose }: ImagePreviewOverlayProps) {
  React.useEffect(() => {
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

  const handleBackdropClick = () => {
    onClose();
  };

  const stopPropagation = (event: React.MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
  };

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
      <div className="relative max-h-full max-w-full" onClick={stopPropagation}>
        <button
          type="button"
          onClick={onClose}
          className="absolute -top-3 -right-3 md:-top-4 md:-right-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-zinc-700 shadow-lg hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          aria-label="Close image preview"
        >
          <X className="h-4 w-4" />
        </button>
        <img
          src={src}
          alt="Enlarged chat message attachment"
          className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg shadow-2xl"
        />
      </div>
    </div>,
    document.body
  );
}

// Helper function to determine grid layout based on number of images
function getGridClass(count: number): string {
  switch (count) {
    case 1:
      return 'grid-cols-1';
    case 2:
      return 'grid-cols-2';
    case 3:
      return 'grid-cols-2 lg:grid-cols-3';
    case 4:
      return 'grid-cols-2';
    default:
      return 'grid-cols-2 lg:grid-cols-3';
  }
}
