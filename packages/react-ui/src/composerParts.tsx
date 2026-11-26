// Pieces MessageComposer and MentionInput share: the emoji button,
// inserting text at the caret, and the attachment queue (checks,
// paste, thumbnails).

import { useAttachmentUpload, type UploadItem } from '@poolse/react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type RefObject,
} from 'react';
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

// ── Attachments: validation, paste, thumbnails ─────────────────────────

/** What the composer accepts as attachments. */
export interface AttachmentRules {
  /** Largest file accepted, in bytes. Larger files show an error chip instead of uploading. */
  maxFileSize?: number;
  /**
   * Accepted types: MIME types (`'application/pdf'`), wildcards
   * (`'image/*'`) or extensions (`'.zip'`). Others show an error chip.
   * Also sets the file picker's `accept`.
   */
  acceptFileTypes?: string[];
}

/** Why `file` can't be attached under `rules`, or null when it can. */
export function attachmentProblem(file: File, rules: AttachmentRules): string | null {
  if (rules.maxFileSize !== undefined && file.size > rules.maxFileSize) {
    return `Larger than ${formatBytes(rules.maxFileSize)}`;
  }
  const accept = rules.acceptFileTypes;
  if (accept && accept.length > 0 && !accept.some((rule) => matchesType(file, rule))) {
    return "This file type isn't allowed";
  }
  return null;
}

function matchesType(file: File, rule: string): boolean {
  const r = rule.trim().toLowerCase();
  if (!r) return false;
  if (r.startsWith('.')) return file.name.toLowerCase().endsWith(r);
  const type = (file.type || '').toLowerCase();
  if (r.endsWith('/*')) return type.startsWith(r.slice(0, -1));
  return type === r;
}

/** `25 MB`, `512 KB`, `900 B`. */
export function formatBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${trim(n / (1024 * 1024 * 1024))} GB`;
  if (n >= 1024 * 1024) return `${trim(n / (1024 * 1024))} MB`;
  if (n >= 1024) return `${trim(n / 1024)} KB`;
  return `${n} B`;
}

function trim(x: number): string {
  return x >= 10 ? String(Math.round(x)) : String(Math.round(x * 10) / 10);
}

const fileKey = (name: string, size: number, type: string) => `${name}\u0000${size}\u0000${type}`;

/**
 * The composer's attachment queue: `useAttachmentUpload` plus the
 * checks in `rules`, error chips for files refused before upload,
 * local thumbnails for images, and pasting files from the clipboard.
 */
export function useComposerAttachments(enabled: boolean, rules: AttachmentRules) {
  const { queue, uploadAll, cancel, remove } = useAttachmentUpload();
  const [rejected, setRejected] = useState<UploadItem[]>([]);
  // Object URLs for image thumbnails, by file identity (the queue item
  // doesn't keep its File).
  const thumbs = useRef(new Map<string, string>());
  useEffect(() => {
    const map = thumbs.current;
    return () => {
      for (const url of map.values()) URL.revokeObjectURL?.(url);
      map.clear();
    };
  }, []);

  const rulesRef = useRef(rules);
  rulesRef.current = rules;

  const addFiles = useCallback(
    (files: File[]) => {
      if (!enabled || files.length === 0) return;
      const ok: File[] = [];
      const refused: UploadItem[] = [];
      for (const f of files) {
        const problem = attachmentProblem(f, rulesRef.current);
        if (problem) {
          refused.push({
            localId: `rejected-${Math.random().toString(36).slice(2)}`,
            filename: f.name,
            contentType: f.type || 'application/octet-stream',
            byteSize: f.size,
            status: 'error',
            loaded: 0,
            attachment: null,
            error: new Error(problem),
          });
          continue;
        }
        ok.push(f);
        if (f.type.startsWith('image/') && typeof URL.createObjectURL === 'function') {
          const key = fileKey(f.name, f.size, f.type);
          if (!thumbs.current.has(key)) thumbs.current.set(key, URL.createObjectURL(f));
        }
      }
      if (refused.length > 0) setRejected((prev) => [...prev, ...refused]);
      if (ok.length === 0) return;
      void uploadAll(
        ok.map((f) => ({
          body: f,
          contentType: f.type || 'application/octet-stream',
          byteSize: f.size,
          filename: f.name,
        })),
      ).catch(() => {
        // Per-item error stays on its chip; the user dismisses.
      });
    },
    [enabled, uploadAll],
  );

  const dismiss = useCallback(
    (localId: string) => {
      if (localId.startsWith('rejected-')) {
        setRejected((prev) => prev.filter((it) => it.localId !== localId));
      } else {
        remove(localId);
      }
    },
    [remove],
  );

  const previewFor = useCallback(
    (item: UploadItem) =>
      thumbs.current.get(fileKey(item.filename, item.byteSize, item.contentType)) ?? null,
    [],
  );

  // Files pasted into the input (a screenshot, files copied in the OS)
  // join the queue instead of pasting their names as text.
  const onPaste = useCallback(
    (e: ClipboardEvent<HTMLTextAreaElement>) => {
      if (!enabled) return;
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length === 0) return;
      e.preventDefault();
      addFiles(files);
    },
    [enabled, addFiles],
  );

  const live = queue.filter((it) => it.status !== 'cancelled');
  return {
    queue,
    /** Every chip to show: staged uploads, then files refused before upload. */
    items: [...live, ...rejected],
    ready: queue.filter((it) => it.status === 'ready'),
    uploading: queue.some((it) => it.status === 'pending' || it.status === 'uploading'),
    addFiles,
    cancel,
    /** Remove a chip (an upload or a refused file). */
    dismiss,
    remove,
    /** Clear the refused-file chips (after a send). */
    clearRejected: () => setRejected([]),
    previewFor,
    onPaste,
    /** For the file input's `accept`. */
    accept: rules.acceptFileTypes?.join(',') || undefined,
  };
}

/** One readable line for a failed send. */
export function sendErrorText(err: unknown): string {
  const raw = err instanceof Error ? err.message : '';
  // `[422] code: message` from the REST client → `message`.
  const text = raw.replace(/^\[\d+\]\s*[^:]*:\s*/, '').trim();
  return text ? `Couldn't send: ${text}` : "Couldn't send. Try again.";
}
