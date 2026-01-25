/**
 * MessageEditForm - Editing form for user messages
 * Supports text editing and image upload/management
 */

import React from 'react';
import { ImagePreview, ImageUploadZone } from '../ui/ImagePreview';
import type { ImageAttachment } from '../../lib/types';

interface MessageEditFormProps {
  messageId: string;
  editingContent: string;
  editingImages: ImageAttachment[];
  actionsDisabled: boolean;
  editingTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onEditingContentChange: (content: string) => void;
  onEditingImagesChange: (files: File[]) => void;
  onRemoveEditingImage: (imageId: string) => void;
  onEditingPaste: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onEditingImageUploadClick: () => void;
  onApplyLocalEdit: (messageId: string) => void;
  onCancelEdit: () => void;
  resizeEditingTextarea: () => void;
}

export function MessageEditForm({
  messageId,
  editingContent,
  editingImages,
  actionsDisabled,
  editingTextareaRef,
  fileInputRef,
  onEditingContentChange,
  onEditingImagesChange,
  onRemoveEditingImage,
  onEditingPaste,
  onEditingImageUploadClick,
  onApplyLocalEdit,
  onCancelEdit,
  resizeEditingTextarea,
}: MessageEditFormProps) {
  const canSaveEdit = editingContent.trim().length > 0 || editingImages.length > 0;

  return (
    <ImageUploadZone
      onFiles={onEditingImagesChange}
      disabled={actionsDisabled}
      fullPage={false}
      clickToUpload={false}
    >
      <div className="space-y-2 rounded-2xl bg-white/95 dark:bg-zinc-900/95 border border-zinc-200 dark:border-zinc-800 shadow-sm p-4">
        {/* Image Previews */}
        {editingImages.length > 0 && (
          <div className="pb-2 border-b border-zinc-200 dark:border-zinc-800">
            <ImagePreview
              images={editingImages}
              uploadProgress={[]}
              onRemove={onRemoveEditingImage}
            />
          </div>
        )}

        {/* Hidden file input for image upload */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            if (files.length > 0) {
              onEditingImagesChange(files);
            }
            e.target.value = '';
          }}
        />

        <textarea
          ref={editingTextareaRef}
          value={editingContent}
          onChange={(e) => onEditingContentChange(e.target.value)}
          onInput={resizeEditingTextarea}
          onPaste={onEditingPaste}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              if (actionsDisabled) return;
              onApplyLocalEdit(messageId);
            }
          }}
          disabled={actionsDisabled}
          aria-disabled={actionsDisabled}
          className="w-full min-h-[100px] resize-vertical bg-transparent border-0 outline-none text-base leading-relaxed text-zinc-800 dark:text-zinc-200 placeholder-zinc-500 dark:placeholder-zinc-400"
          placeholder="Edit your message... (paste or drop images)"
          style={{ overflow: 'hidden' }}
        />

        <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-neutral-700">
          <button
            type="button"
            onClick={onEditingImageUploadClick}
            disabled={actionsDisabled}
            className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className="text-sm">📎</span>
            {editingImages.length > 0
              ? `${editingImages.length} image${editingImages.length > 1 ? 's' : ''}`
              : 'Add images'}
          </button>

          <div className="flex gap-2">
            <button
              onClick={onCancelEdit}
              className="px-3 py-1.5 text-xs rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => onApplyLocalEdit(messageId)}
              disabled={actionsDisabled || !canSaveEdit}
              className="px-3 py-1.5 text-xs rounded-lg bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-200 text-white dark:text-black font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </ImageUploadZone>
  );
}
