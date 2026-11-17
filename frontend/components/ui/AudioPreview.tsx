import React from 'react';
import { X, AudioLines } from 'lucide-react';
import type { AudioAttachment } from '@/lib/types';
import { cn } from '../../lib/cn';
import { IconButton } from './Button';

interface AudioPreviewProps {
  audios: AudioAttachment[];
  onRemove?: (audioId: string) => void;
  className?: string;
}

export function AudioPreview({ audios, onRemove, className }: AudioPreviewProps) {
  if (audios.length === 0) return null;

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {audios.map((audio) => (
        <div
          key={audio.id}
          className="group flex items-start gap-3 rounded-card border border-line bg-canvas-subtle p-3"
        >
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-control bg-muted text-fg-muted"
          >
            <AudioLines className="size-4" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-fg">{audio.name}</div>
              <div className="text-xs text-fg-muted">
                {(audio.size / (1024 * 1024)).toFixed(2)} MB
                {audio.format ? ` • ${audio.format.toUpperCase()}` : ''}
              </div>
            </div>
            <audio controls preload="metadata" className="w-full">
              <source src={audio.url} type={audio.type || undefined} />
              Your browser does not support the audio element.
            </audio>
          </div>
          {onRemove && (
            <IconButton
              label={`Remove ${audio.name}`}
              size="sm"
              onClick={() => onRemove(audio.id)}
              className="size-7 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100"
            >
              <X />
            </IconButton>
          )}
        </div>
      ))}
    </div>
  );
}
