// Pieces MessageComposer and MentionInput share: the emoji button and
// inserting text at the caret.

import { useState, type RefObject } from 'react';
import { EmojiPicker, loadEmojiData } from './EmojiPicker.js';
import { PoolseIcon } from './PoolseIcon.js';

/** Emoji button for the composer row; the picker opens above it. */
export function ComposerEmojiButton({
  disabled,
  onPick,
}: {
  disabled?: boolean;
  onPick: (emoji: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="poolse-composer__emoji">
      <button
        type="button"
        className="poolse-composer__attach poolse-composer__emoji-btn"
        onClick={() => setOpen((o) => !o)}
        onPointerEnter={() => void loadEmojiData()}
        disabled={disabled}
        aria-label="Insert emoji"
        aria-expanded={open}
        title="Insert emoji"
      >
        <PoolseIcon name="emoji" size={20} label={null} />
      </button>
      {open && (
        <div className="poolse-composer__emoji-popover">
          <EmojiPicker
            onPick={(emoji) => {
              setOpen(false);
              onPick(emoji);
            }}
            onClose={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Insert `text` at the textarea's caret (replacing a selection), then
 * put the caret after it. Returns the new value.
 */
export function insertAtCaret(
  value: string,
  text: string,
  ta: RefObject<HTMLTextAreaElement | null>,
): string {
  const el = ta.current;
  const start = el?.selectionStart ?? value.length;
  const end = el?.selectionEnd ?? value.length;
  const next = value.slice(0, start) + text + value.slice(end);
  const caret = start + text.length;
  requestAnimationFrame(() => {
    const t = ta.current;
    if (!t) return;
    t.focus();
    t.setSelectionRange(caret, caret);
  });
  return next;
}
