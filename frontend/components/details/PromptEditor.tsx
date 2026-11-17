import React, { useLayoutEffect, useRef } from 'react';
import { Button } from '../ui/Button';
import { Textarea } from '../ui/Input';

interface PromptEditorProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** Note under the textarea, e.g. "Applies to new messages". */
  note: string;
  /** Show "Save" (editable custom prompts only). */
  canSave: boolean;
  hasChanges: boolean;
  onRevert: () => void;
  onSaveAsNew: () => void;
  onSave?: () => void;
  /** Esc leaves edit mode without discarding the text. */
  onClose: () => void;
  autoFocus?: boolean;
}

/** About six rows of 20px text plus padding. */
const MIN_HEIGHT_PX = 136;

/** Grow the textarea with its content, up to half the panel, then scroll. */
function useAutoGrow(ref: React.RefObject<HTMLTextAreaElement | null>, value: string) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const panel = el.closest('aside');
    const max = panel ? Math.max(MIN_HEIGHT_PX, panel.clientHeight / 2) : 0;
    el.style.height = 'auto';
    const wanted = Math.max(MIN_HEIGHT_PX, el.scrollHeight + 2);
    const height = max > 0 ? Math.min(wanted, max) : wanted;
    el.style.height = `${height}px`;
    el.style.overflowY = max > 0 && wanted > max ? 'auto' : 'hidden';
  }, [ref, value]);
}

export function PromptEditor({
  id,
  value,
  onChange,
  note,
  canSave,
  hasChanges,
  onRevert,
  onSaveAsNew,
  onSave,
  onClose,
  autoFocus = false,
}: PromptEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(textareaRef, value);

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="sr-only">
        Prompt content
      </label>
      <Textarea
        ref={textareaRef}
        id={id}
        value={value}
        rows={6}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
        }}
        placeholder="Write a system prompt…"
        className="scrollbar-thin resize-none"
      />
      <div className="flex items-center justify-between gap-2 text-xs text-fg-subtle">
        <span>
          {value.length} {value.length === 1 ? 'character' : 'characters'}
        </span>
        <span>{note}</span>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onRevert}>
          Revert
        </Button>
        <span className="flex-1" />
        <Button variant="secondary" size="sm" onClick={onSaveAsNew} disabled={!value.trim()}>
          Save as new
        </Button>
        {canSave && onSave ? (
          <Button variant="secondary" size="sm" onClick={onSave} disabled={!hasChanges}>
            Save
          </Button>
        ) : null}
      </div>
    </div>
  );
}
