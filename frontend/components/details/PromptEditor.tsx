import React, { useEffect, useLayoutEffect, useRef } from 'react';
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
  /** Done (or Esc) leaves edit mode; unsaved text stays in effect. */
  onClose: () => void;
  autoFocus?: boolean;
}

/** About five rows of text plus padding. */
const MIN_HEIGHT_PX = 116;

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

  // Focus with the caret at the end, so typing continues the prompt rather than prefixing it.
  useEffect(() => {
    const el = textareaRef.current;
    if (!autoFocus || !el) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
    el.scrollTop = el.scrollHeight;
    // Only on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
        }}
        placeholder="Write a system prompt…"
        className="scrollbar-thin resize-none px-2"
      />
      <p className="text-xs text-fg-subtle">
        {value.length} {value.length === 1 ? 'character' : 'characters'} · {note}
      </p>
      <div className="flex items-center gap-1">
        {hasChanges ? (
          <Button variant="ghost" size="xs" onClick={onRevert}>
            Revert
          </Button>
        ) : null}
        <span className="flex-1" />
        <Button variant="ghost" size="xs" onClick={onSaveAsNew} disabled={!value.trim()}>
          Save as new
        </Button>
        {canSave && onSave ? (
          <Button variant="secondary" size="xs" onClick={onSave} disabled={!hasChanges}>
            Save
          </Button>
        ) : null}
        <Button variant="ghost" size="xs" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}
