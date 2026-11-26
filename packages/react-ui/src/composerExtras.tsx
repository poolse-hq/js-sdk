// Extras MessageComposer and MentionInput share: the formatting toolbar
// (MS4), slash-command suggestions (IN3) and the data-loss-prevention
// warning (AD6). The text logic lives in @poolse/react (composer-tools,
// dlp) so @poolse/react-native behaves the same.

import {
  FORMAT_ACTIONS,
  applyFormat,
  applySlashCommand,
  filterSlashCommands,
  formatForShortcut,
  readDlpError,
  slashQuery,
  type DlpOutcome,
  type FormatKind,
  type SlashCommand,
} from '@poolse/react';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react';

/** A row of Markdown formatting buttons above the input. */
export function FormattingToolbar({
  onFormat,
  disabled,
  actions = FORMAT_ACTIONS.map((a) => a.kind),
}: {
  onFormat: (kind: FormatKind) => void;
  disabled?: boolean;
  /** Which buttons, in order. Defaults to all of `FORMAT_ACTIONS`. */
  actions?: readonly FormatKind[];
}) {
  return (
    <div className="poolse-format-toolbar" role="toolbar" aria-label="Formatting">
      {actions.map((kind) => {
        const a = FORMAT_ACTIONS.find((x) => x.kind === kind);
        if (!a) return null;
        const hint = a.shortcut ? ` (${shortcutLabel(a.shortcut)})` : '';
        return (
          <button
            key={kind}
            type="button"
            className={`poolse-format-toolbar__btn poolse-format-toolbar__btn--${kind}`}
            // mousedown keeps the textarea's selection.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onFormat(kind)}
            disabled={disabled}
            aria-label={a.label}
            title={a.label + hint}
          >
            <span aria-hidden="true">{a.glyph}</span>
          </button>
        );
      })}
    </div>
  );
}

function shortcutLabel(s: string): string {
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '');
  return s.replace('Mod', mac ? '⌘' : 'Ctrl').replace(/\+/g, mac ? '' : '+');
}

/**
 * State and handlers for the formatting toolbar, Mod+B/I/E/K shortcuts
 * and the `/command` menu, around a textarea the composer owns.
 */
export function useComposerExtras({
  value,
  setValue,
  taRef,
  formatting,
  commands,
}: {
  value: string;
  setValue: (v: string) => void;
  taRef: RefObject<HTMLTextAreaElement | null>;
  formatting: boolean;
  commands: readonly SlashCommand[] | undefined;
}) {
  const [caret, setCaret] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const menuId = useId();

  const query = commands && caret !== null ? slashQuery(value, caret) : null;
  const matches =
    query && commands && dismissed !== value ? filterSlashCommands(commands, query.query) : [];
  const open = matches.length > 0;

  useEffect(() => setActive(0), [query?.query]);

  const place = (start: number, end: number) =>
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(start, end);
    });

  const format = (kind: FormatKind) => {
    const ta = taRef.current;
    const sel = {
      start: ta?.selectionStart ?? value.length,
      end: ta?.selectionEnd ?? value.length,
    };
    const r = applyFormat(value, sel, kind);
    setValue(r.value);
    place(r.selection.start, r.selection.end);
  };

  const pick = (c: SlashCommand) => {
    const r = applySlashCommand(value, c.name);
    setValue(r.value);
    setCaret(r.selection.start);
    place(r.selection.start, r.selection.end);
  };

  /** Call first in the textarea's onKeyDown; `true` means it handled the key. */
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const d = e.key === 'ArrowDown' ? 1 : -1;
        setActive((i) => (i + d + matches.length) % matches.length);
        return true;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pick(matches[active] ?? matches[0]!);
        return true;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setDismissed(value);
        return true;
      }
    }
    if (formatting) {
      const kind = formatForShortcut(e);
      if (kind) {
        e.preventDefault();
        format(kind);
        return true;
      }
    }
    return false;
  };

  /** Call from onChange / onSelect so the menu follows the caret. */
  const track = (el: HTMLTextAreaElement) => setCaret(el.selectionStart ?? el.value.length);

  const textareaProps = open
    ? {
        'aria-controls': menuId,
        'aria-activedescendant': `${menuId}-cmd-${active}`,
      }
    : {};

  const menu = open ? (
    <div
      id={menuId}
      className="poolse-mention-menu poolse-command-menu"
      role="listbox"
      aria-label="Commands"
    >
      {matches.map((c, i) => (
        <div
          key={c.name}
          id={`${menuId}-cmd-${i}`}
          role="option"
          aria-selected={i === active}
          className={`poolse-mention-menu__item${i === active ? ' poolse-mention-menu__item--active' : ''}`}
          onMouseEnter={() => setActive(i)}
          onMouseDown={(e) => {
            e.preventDefault();
            pick(c);
          }}
        >
          <span className="poolse-command-menu__name">/{c.name}</span>
          {c.usage ? <span className="poolse-command-menu__usage">{c.usage}</span> : null}
          {c.description ? (
            <span className="poolse-command-menu__desc">{c.description}</span>
          ) : null}
          {c.source ? <span className="poolse-command-menu__source">{c.source}</span> : null}
        </div>
      ))}
    </div>
  ) : null;

  return { format, onKeyDown, track, menu, textareaProps, commandMenuOpen: open };
}

// ── Data loss prevention (AD6) ─────────────────────────────────

export interface DlpWarningDialogProps {
  outcome: DlpOutcome;
  /** "Send anyway" (only offered for a warning, never for a block). */
  onSendAnyway?: () => void;
  /** "Edit message": back to the composer with the text kept. */
  onEdit: () => void;
}

/**
 * The dialog the composer shows when the server's data-loss-prevention
 * check warns about (or blocks) a message: which rules matched, and
 * "Edit message" / "Send anyway".
 */
export function DlpWarningDialog({ outcome, onSendAnyway, onEdit }: DlpWarningDialogProps) {
  const titleId = useId();
  const editRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => editRef.current?.focus(), []);
  const blocked = outcome.action === 'block';
  return (
    <div
      className="poolse-dlp-dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onEdit();
        }
      }}
    >
      <div className="poolse-dlp-dialog__card">
        <h2 id={titleId} className="poolse-dlp-dialog__title">
          {blocked ? "This message can't be sent" : 'Check this message before sending'}
        </h2>
        <p className="poolse-dlp-dialog__text">
          {outcome.message ??
            (blocked
              ? 'It contains something your workspace does not allow in messages.'
              : 'It looks like it contains something sensitive.')}
        </p>
        {outcome.matches.length > 0 && (
          <ul className="poolse-dlp-dialog__matches">
            {outcome.matches.map((m, i) => (
              <li key={i}>
                <span className="poolse-dlp-dialog__rule">{m.rule}</span>
                {m.excerpt ? <code className="poolse-dlp-dialog__excerpt">{m.excerpt}</code> : null}
              </li>
            ))}
          </ul>
        )}
        <div className="poolse-dlp-dialog__actions">
          <button ref={editRef} type="button" className="poolse-dlp-dialog__edit" onClick={onEdit}>
            Edit message
          </button>
          {!blocked && onSendAnyway && (
            <button type="button" className="poolse-dlp-dialog__send" onClick={onSendAnyway}>
              Send anyway
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Run a send; when the server answers with a data-loss-prevention
 * warning or block, keep it so the composer can show the dialog, and
 * `retry` sends again with the warning acknowledged.
 */
export function useDlpGuard() {
  const [pending, setPending] = useState<{
    outcome: DlpOutcome;
    /** The text that was held back. */
    body: string;
    /** Sends again, acknowledged; resolves `true` when it went through. */
    retry: () => Promise<boolean>;
  } | null>(null);
  /** Returns `true` when the send went through, `false` when the dialog is now showing. */
  const guard = async (
    body: string,
    send: (acknowledged: boolean) => Promise<unknown> | void,
    acknowledged = false,
  ): Promise<boolean> => {
    try {
      await send(acknowledged);
      return true;
    } catch (err) {
      const outcome = readDlpError(err);
      if (!outcome) throw err;
      setPending({
        outcome,
        body,
        retry: async () => {
          setPending(null);
          return guard(body, send, true);
        },
      });
      return false;
    }
  };
  return { pending, guard, dismiss: () => setPending(null) };
}
