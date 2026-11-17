/**
 * MessageEditForm - Editing form for user messages
 * Supports text editing and image upload/management
 */

import React from 'react';
import { Paperclip } from 'lucide-react';
import { ImagePreview, ImageUploadZone } from '../ui/ImagePreview';
import { Button } from '../ui/Button';
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
      <div className="space-y-2 rounded-card border border-line bg-surface p-4 transition-colors focus-within:border-focus">
        {/* Image Previews */}
        {editingImages.length > 0 && (
          <div className="border-b border-line pb-2">
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
          aria-label="Edit message"
          className="min-h-25 w-full resize-y bg-transparent text-base leading-relaxed text-fg outline-none placeholder:text-fg-subtle"
          placeholder="Edit your message... (paste or drop images)"
          style={{ overflow: 'hidden' }}
        />

        <div className="flex items-center justify-between gap-2 border-t border-line pt-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onEditingImageUploadClick}
            disabled={actionsDisabled}
          >
            <Paperclip />
            {editingImages.length > 0
              ? `${editingImages.length} image${editingImages.length > 1 ? 's' : ''}`
              : 'Add images'}
          </Button>

          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={onCancelEdit}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => onApplyLocalEdit(messageId)}
              disabled={actionsDisabled || !canSaveEdit}
            >
              Save
            </Button>
          </div>
        </div>
      </div>
    </ImageUploadZone>
  );
}
