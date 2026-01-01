import React from 'react';
import { X, AudioLines } from 'lucide-react';
import type { AudioAttachment } from '@/lib/types';

interface AudioPreviewProps {
  audios: AudioAttachment[];
  onRemove?: (audioId: string) => void;
  className?: string;
}

export function AudioPreview({ audios, onRemove, className = '' }: AudioPreviewProps) {
  if (audios.length === 0) return null;

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {audios.map((audio) => (
        <div
          key={audio.id}
          className="relative group rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800 p-3"
        >
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-10 h-10 rounded flex items-center justify-center bg-purple-100 dark:bg-purple-900/20">
              <AudioLines className="w-5 h-5 text-purple-700 dark:text-purple-300" />
            </div>

            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">
                {audio.name}
              </div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                {(audio.size / (1024 * 1024)).toFixed(2)} MB
                {audio.format ? ` • ${audio.format.toUpperCase()}` : ''}
              </div>
              <div className="mt-2">
                <audio controls preload="metadata" className="w-full">
                  <source src={audio.url} type={audio.type || undefined} />
                  Your browser does not support the audio element.
                </audio>
              </div>
            </div>

            {onRemove && (
              <button
                type="button"
                onClick={() => onRemove(audio.id)}
                className="flex-shrink-0 w-6 h-6 rounded-full bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 text-zinc-600 dark:text-zinc-300 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label={`Remove ${audio.name}`}
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
