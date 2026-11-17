import React, { useState } from 'react';
import { FileText, ImageOff } from 'lucide-react';
import { DetailsSection } from './DetailsSection';
import { useSecureImageUrl } from '../../hooks/useSecureImageUrl';
import { ImagePreviewOverlay } from '../ui/ImagePreviewOverlay';
import { FilePreviewOverlay } from '../ui/FileContentPreview';
import type { ConversationFile } from '../../lib/conversationFiles';
import type { FileContent } from '../../lib/types';
import { cn } from '../../lib/cn';

interface FilesSectionProps {
  files: ConversationFile[];
  open: boolean;
  onToggle: () => void;
}

const tileClasses =
  'flex aspect-square w-full min-w-0 overflow-hidden rounded-control border border-line transition-colors focus-ring';

function ImageTile({ url, onOpen }: { url: string; onOpen: (src: string) => void }) {
  const { src, error } = useSecureImageUrl(url);
  const ready = Boolean(src) && !error;
  return (
    <button
      type="button"
      onClick={() => ready && onOpen(src)}
      disabled={!ready}
      aria-label={error ? 'Image unavailable' : 'View image'}
      className={cn(
        tileClasses,
        'items-center justify-center bg-muted disabled:cursor-not-allowed'
      )}
    >
      {ready ? (
        <img src={src} alt="" className="size-full object-cover" loading="lazy" />
      ) : error ? (
        <ImageOff aria-hidden="true" className="size-4 text-fg-subtle" />
      ) : null}
    </button>
  );
}

function FileTile({ name, onOpen }: { name: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`View ${name}`}
      className={cn(
        tileClasses,
        'flex-col justify-between bg-surface p-1 text-left text-xs text-fg-muted hover:bg-muted'
      )}
    >
      <FileText aria-hidden="true" className="size-4" />
      <span className="w-full truncate">{name}</span>
    </button>
  );
}

/** Images and files in the conversation, opened in the same previews as in messages. */
export function FilesSection({ files, open, onToggle }: FilesSectionProps) {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [file, setFile] = useState<FileContent | null>(null);

  return (
    <>
      <DetailsSection title="Files" count={files.length} open={open} onToggle={onToggle}>
        <ul className="grid grid-cols-3 gap-2 px-1 pt-1 pb-2">
          {files.map((item) => (
            <li key={item.key} className="min-w-0">
              {item.kind === 'image' ? (
                <ImageTile url={item.url} onOpen={setImageSrc} />
              ) : (
                <FileTile
                  name={item.name}
                  onOpen={() =>
                    setFile({
                      type: 'file',
                      name: item.name,
                      language: item.language,
                      content: item.content,
                    })
                  }
                />
              )}
            </li>
          ))}
        </ul>
      </DetailsSection>
      {imageSrc ? <ImagePreviewOverlay src={imageSrc} onClose={() => setImageSrc(null)} /> : null}
      {file ? <FilePreviewOverlay file={file} onClose={() => setFile(null)} /> : null}
    </>
  );
}
