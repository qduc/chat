import React from 'react';
import type { MessageContent, ImageContent } from '../../lib/chat/types';
import { extractTextFromContent, extractImagesFromContent, hasImages } from '../../lib/chat/content-utils';
import Markdown from '../Markdown';

interface MessageContentRendererProps {
  content: MessageContent;
  isStreaming?: boolean;
  className?: string;
}

export function MessageContentRenderer({ content, isStreaming = false, className = '' }: MessageContentRendererProps) {
  // Extract text and images from content
  const textContent = extractTextFromContent(content);
  const imageContents = extractImagesFromContent(content);
  const hasImageContent = hasImages(content);

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Render images first if they exist */}
      {hasImageContent && imageContents.length > 0 && (
        <div className="space-y-2">
          <MessageImages images={imageContents} />
        </div>
      )}

      {/* Render text content */}
      {textContent && (
        <Markdown text={textContent} isStreaming={isStreaming} />
      )}

      {/* If no content at all, show placeholder */}
      {!textContent && !hasImageContent && (
        <span className="text-slate-500 dark:text-slate-400 italic">No content</span>
      )}
    </div>
  );
}

interface MessageImagesProps {
  images: ImageContent[];
  className?: string;
}

function MessageImages({ images, className = '' }: MessageImagesProps) {
  if (images.length === 0) {
    return null;
  }

  return (
    <div className={`grid gap-2 ${getGridClass(images.length)} ${className}`}>
      {images.map((image, index) => (
        <MessageImage key={index} image={image} />
      ))}
    </div>
  );
}

interface MessageImageProps {
  image: ImageContent;
  className?: string;
}

function MessageImage({ image, className = '' }: MessageImageProps) {
  const [loaded, setLoaded] = React.useState(false);
  const [error, setError] = React.useState(false);

  const handleLoad = () => {
    setLoaded(true);
    setError(false);
  };

  const handleError = () => {
    setError(true);
    setLoaded(false);
  };

  return (
    <div className={`relative rounded-lg overflow-hidden bg-slate-100 dark:bg-neutral-800 ${className}`}>
      {!loaded && !error && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-slate-300 dark:border-neutral-600 border-t-slate-600 dark:border-t-neutral-300 rounded-full animate-spin" />
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center text-slate-500 dark:text-slate-400">
          <div className="text-center">
            <div className="w-8 h-8 mx-auto mb-2 rounded-full bg-slate-200 dark:bg-neutral-700 flex items-center justify-center">
              <span className="text-sm">!</span>
            </div>
            <div className="text-xs">Failed to load image</div>
          </div>
        </div>
      )}

      <img
        src={image.image_url.url}
        alt="Image"
        className={`max-w-full h-auto rounded-lg transition-opacity duration-200 ${
          loaded ? 'opacity-100' : 'opacity-0'
        } ${error ? 'hidden' : ''}`}
        style={{ maxHeight: '400px', width: 'auto' }}
        onLoad={handleLoad}
        onError={handleError}
        loading="lazy"
      />
    </div>
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