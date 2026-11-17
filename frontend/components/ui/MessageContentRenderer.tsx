import React from 'react';
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
import { Modal } from './Modal';
import { cn } from '../../lib/cn';

interface MessageContentRendererProps {
  content: MessageContent;
  isStreaming?: boolean;
  className?: string;
  role?: 'user' | 'assistant' | 'system' | 'tool';
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
  const [selectedImage, setSelectedImage] = React.useState<string | null>(null);

  const handleImageClick = React.useCallback((_image: ImageContent, src: string) => {
    setSelectedImage(src);
  }, []);

  const handleClosePreview = React.useCallback(() => {
    setSelectedImage(null);
  }, []);

  // For assistant messages, render text first then images (generated images appear after text)
  // For user messages, render images first then text (attached images appear before text)
  const imagesFirst = role === 'user';

  return (
    <>
      <div className={cn('space-y-3', className)}>
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
          <span className="text-fg-muted italic">No content</span>
        )}
      </div>

      {selectedImage && <ImagePreviewOverlay src={selectedImage} onClose={handleClosePreview} />}
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
              className="rounded-card border border-line bg-muted p-3 text-sm text-fg-muted"
            >
              Audio attachment (unavailable)
            </div>
          );
        }

        return (
          <div key={idx} className="rounded-card border border-line bg-muted p-3">
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
    <div className={cn('grid gap-2', getGridClass(images.length), className)}>
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
      className={cn(
        'relative block w-full overflow-hidden rounded-card focus-ring',
        (showSpinner || combinedError) && 'bg-muted',
        combinedError || !hasSource ? 'cursor-not-allowed' : 'cursor-zoom-in',
        className
      )}
      aria-label="View image"
    >
      {showSpinner && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="size-6 animate-spin rounded-full border-2 border-line-strong border-t-fg-muted" />
        </div>
      )}

      {combinedError && (
        <div className="absolute inset-0 flex items-center justify-center text-fg-muted">
          <div className="text-center">
            <div className="mx-auto mb-2 flex size-8 items-center justify-center rounded-full bg-emphasis">
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
          className={cn(
            'h-auto max-h-100 w-auto max-w-full rounded-card transition-opacity',
            loaded ? 'opacity-100' : 'opacity-0'
          )}
          onLoad={handleLoad}
          onError={handleError}
          loading="lazy"
        />
      )}
    </button>
  );
}

interface ImagePreviewOverlayProps {
  src: string;
  onClose: () => void;
}

function ImagePreviewOverlay({ src, onClose }: ImagePreviewOverlayProps) {
  return (
    <Modal
      open
      onClose={onClose}
      title="Image preview"
      size="full"
      closeLabel="Close image preview"
      bodyClassName="flex items-center justify-center p-4"
    >
      <img
        src={src}
        alt="Enlarged chat message attachment"
        className="max-h-full max-w-full rounded-card object-contain"
      />
    </Modal>
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
