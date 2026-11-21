// EditedLabel — the "edited" mark on a message. Clicking it opens a
// small popover with the earlier versions (`messages.edits(id)`), oldest
// first. The server shows edit history to the sender and to
// conversation owners / admins; for anyone else (403) the mark stays
// plain text.

import type { MessageEdit, Uuid } from '@poolse/sdk';
import { ApiError, usePoolse } from '@poolse/react';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

export interface EditedLabelProps {
  messageId: Uuid;
  /** The label. Defaults to `"edited"`. */
  label?: string;
  className?: string;
}

type HistoryState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; edits: MessageEdit[] }
  | { status: 'error' };

const POPOVER_WIDTH = 280;

export function EditedLabel({ messageId, label = 'edited', className }: EditedLabelProps) {
  const history = useEditHistory(messageId);
  return (
    <>
      {history.label(label, className)}
      {history.popover}
    </>
  );
}

/**
 * The edit-history label and its popover as two pieces, so a layout can
 * put the label inside a styled meta line and the popover outside it.
 * The popover is `position: fixed` in the viewport, so scrollers don't
 * clip it.
 */
export function useEditHistory(messageId: Uuid): {
  /** The "edited" button (plain text once the server refused with 403). */
  label: (text?: string, className?: string) => ReactNode;
  /** The open popover, or null. */
  popover: ReactNode;
} {
  const chat = usePoolse();
  const [open, setOpen] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [history, setHistory] = useState<HistoryState>({ status: 'idle' });
  const [position, setPosition] = useState<CSSProperties | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // A new message id (a recycled row) starts over.
  useEffect(() => {
    setOpen(false);
    setForbidden(false);
    setHistory({ status: 'idle' });
  }, [messageId]);

  const load = () => {
    setHistory({ status: 'loading' });
    chat.messages
      .edits(messageId)
      .then((list) => setHistory({ status: 'ready', edits: list.data }))
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 403) {
          setForbidden(true);
          setOpen(false);
          return;
        }
        setHistory({ status: 'error' });
      });
  };

  // Above the label (below when there's no room above).
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const vw = window.innerWidth || POPOVER_WIDTH + 16;
      const left = Math.max(8, Math.min(rect.right - POPOVER_WIDTH, vw - POPOVER_WIDTH - 8));
      const below = rect.top < 200;
      setPosition(
        below
          ? { position: 'fixed', left, top: rect.bottom + 6 }
          : { position: 'fixed', left, top: rect.top - 6, transform: 'translateY(-100%)' },
      );
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open]);

  // Outside click, Escape and scrolling the feed close it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (popoverRef.current?.contains(t) || buttonRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && popoverRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  const label = (text = 'edited', className?: string) =>
    forbidden ? (
      <span className={className}>{text}</span>
    ) : (
      <button
        ref={buttonRef}
        type="button"
        className={['poolse-edited-label', className].filter(Boolean).join(' ')}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Show edit history"
        onClick={(e) => {
          e.stopPropagation();
          const next = !open;
          setOpen(next);
          if (next && (history.status === 'idle' || history.status === 'error')) load();
        }}
      >
        {text}
      </button>
    );

  const popover = open ? (
    <div
      ref={popoverRef}
      className="poolse-edit-history"
      role="dialog"
      aria-label="Edit history"
      style={position ?? { position: 'fixed', visibility: 'hidden' }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="poolse-edit-history__title">Edit history</div>
      {history.status === 'loading' || history.status === 'idle' ? (
        <div className="poolse-edit-history__empty">Loading…</div>
      ) : history.status === 'error' ? (
        <div className="poolse-edit-history__empty">Couldn&apos;t load the history.</div>
      ) : history.edits.length === 0 ? (
        <div className="poolse-edit-history__empty">No earlier versions.</div>
      ) : (
        <ol className="poolse-edit-history__list">
          {history.edits.map((v) => (
            <li key={v.version} className="poolse-edit-history__item">
              <time className="poolse-edit-history__time" dateTime={v.written_at}>
                {v.version === 1 ? 'Original · ' : ''}
                {formatWhen(v.written_at)}
              </time>
              <div className="poolse-edit-history__body">{v.body ?? <em>(no text)</em>}</div>
            </li>
          ))}
        </ol>
      )}
    </div>
  ) : null;

  return { label, popover };
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
