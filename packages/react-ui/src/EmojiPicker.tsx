// EmojiPicker — search, recently used and categories, with no
// dependency. The emoji list (~800, with their Unicode names as search
// keywords) is its own module, loaded the first time a picker opens.

import {
  customEmojiToken,
  findCustomEmoji,
  parseCustomEmojiToken,
  searchCustomEmoji,
  useCustomEmoji,
  type CustomEmoji,
} from '@poolse/react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { EmojiCategoryData } from './emojiData.js';
import { isImeComposing } from './keymap.js';

export interface EmojiPickerProps {
  /** An emoji was chosen. */
  onPick: (emoji: string) => void;
  /** Escape or a click outside. */
  onClose?: () => void;
  /** Focus the search field on open. Defaults to `true`. */
  autoFocus?: boolean;
  className?: string;
  /**
   * The workspace's own emoji (MS10), shown first as "Workspace" and in
   * search. Picking one gives its `:name:` token. Defaults to the nearest
   * `<CustomEmojiProvider>`.
   */
  customEmoji?: readonly CustomEmoji[];
}

/**
 * One emoji: the image of a known `:name:` custom emoji, else the text.
 * Unknown tokens show as their text.
 */
export function EmojiGlyph({
  emoji,
  size = 20,
  customEmoji,
}: {
  emoji: string;
  size?: number;
  customEmoji?: readonly CustomEmoji[];
}) {
  const scoped = useCustomEmoji();
  const custom = findCustomEmoji(emoji, customEmoji ?? scoped);
  if (!custom) return <>{emoji}</>;
  return (
    <img
      className="poolse-emoji-glyph"
      src={custom.url}
      alt={emoji}
      width={size}
      height={size}
      loading="lazy"
      draggable={false}
    />
  );
}

const RECENT_KEY = 'poolse:recent-emoji';
const RECENT_MAX = 24;
const SEARCH_MAX = 120;
const COLUMNS = 8;

let dataPromise: Promise<ReadonlyArray<EmojiCategoryData>> | null = null;
let loadedData: ReadonlyArray<EmojiCategoryData> | null = null;

/** Load the emoji list (once). Call it early to warm the picker. */
export function loadEmojiData(): Promise<ReadonlyArray<EmojiCategoryData>> {
  dataPromise ??= import('./emojiData.js').then((m) => {
    loadedData = m.EMOJI_CATEGORIES;
    return loadedData;
  });
  return dataPromise;
}

// Recently used, newest first: kept in memory for the page and in
// localStorage when it's there (it may throw, or be absent).
let recentMemory: string[] | null = null;

function readRecent(): string[] {
  if (recentMemory) return recentMemory;
  try {
    const raw = globalThis.localStorage?.getItem(RECENT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    recentMemory = Array.isArray(parsed)
      ? parsed.filter((e): e is string => typeof e === 'string').slice(0, RECENT_MAX)
      : [];
  } catch {
    recentMemory = [];
  }
  return recentMemory;
}

/** Remember an emoji as recently used (the reaction pills call this too). */
export function rememberEmoji(emoji: string): void {
  const next = [emoji, ...readRecent().filter((e) => e !== emoji)].slice(0, RECENT_MAX);
  recentMemory = next;
  try {
    globalThis.localStorage?.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Private mode / blocked storage: memory only.
  }
}

export function EmojiPicker({
  onPick,
  onClose,
  autoFocus = true,
  className,
  customEmoji,
}: EmojiPickerProps) {
  const scopedCustom = useCustomEmoji();
  const custom = customEmoji ?? scopedCustom;
  const [data, setData] = useState(loadedData);
  const [query, setQuery] = useState('');
  const [recent] = useState(readRecent);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (data) return;
    let live = true;
    void loadEmojiData().then((d) => {
      if (live) setData(d);
    });
    return () => {
      live = false;
    };
  }, [data]);

  useEffect(() => {
    if (autoFocus) searchRef.current?.focus();
  }, [autoFocus]);

  // Close on a click outside (capture, so the toggle that opened it
  // doesn't immediately reopen it).
  useEffect(() => {
    if (!onClose) return;
    const onPointer = (e: PointerEvent) => {
      const t = e.target;
      if (t instanceof Node && rootRef.current && !rootRef.current.contains(t)) onClose();
    };
    document.addEventListener('pointerdown', onPointer, true);
    return () => document.removeEventListener('pointerdown', onPointer, true);
  }, [onClose]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !data) return null;
    const words = q.split(/\s+/);
    const out: string[] = searchCustomEmoji(custom, q).map((e) => customEmojiToken(e.name));
    for (const cat of data) {
      for (const [emoji, keywords] of cat.emojis) {
        if (words.every((w) => keywords.includes(w))) out.push(emoji);
        if (out.length >= SEARCH_MAX) return out;
      }
    }
    return out;
  }, [query, data, custom]);

  const pick = (emoji: string) => {
    rememberEmoji(emoji);
    onPick(emoji);
  };

  const sections: { id: string; label: string; emojis: string[] }[] = data
    ? [
        ...(custom.length > 0
          ? [
              {
                id: 'custom',
                label: 'Workspace',
                emojis: custom.map((e) => customEmojiToken(e.name)),
              },
            ]
          : []),
        ...(recent.length > 0 ? [{ id: 'recent', label: 'Recently used', emojis: recent }] : []),
        ...data.map((c) => ({ id: c.id, label: c.label, emojis: c.emojis.map(([e]) => e) })),
      ]
    : [];

  const jumpTo = (id: string) => {
    const el = gridRef.current?.querySelector(`[data-emoji-section="${id}"]`);
    if (el instanceof HTMLElement) {
      const grid = gridRef.current!;
      grid.scrollTop = el.offsetTop - grid.offsetTop;
    }
  };

  // Arrow keys move between emoji in the grid (8 to a row).
  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: COLUMNS,
      ArrowUp: -COLUMNS,
    };
    const step = keys[e.key];
    if (step === undefined) return;
    const buttons = Array.from(
      gridRef.current?.querySelectorAll<HTMLButtonElement>('.poolse-emoji-picker__emoji') ?? [],
    );
    const idx = buttons.findIndex((b) => b === document.activeElement);
    if (idx === -1) return;
    const next = buttons[idx + step];
    if (next) {
      next.focus();
      e.preventDefault();
    } else if (step < 0) {
      searchRef.current?.focus();
      e.preventDefault();
    }
  };

  const onRootKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      onClose?.();
    }
  };

  const emojiButton = (emoji: string, key: string) => (
    <button
      key={key}
      type="button"
      className="poolse-emoji-picker__emoji"
      onClick={() => pick(emoji)}
      aria-label={emoji}
      title={parseCustomEmojiToken(emoji) ? emoji : undefined}
    >
      <EmojiGlyph emoji={emoji} customEmoji={custom} />
    </button>
  );

  return (
    <div
      ref={rootRef}
      className={['poolse-emoji-picker', className].filter(Boolean).join(' ')}
      role="dialog"
      aria-label="Emoji picker"
      onKeyDown={onRootKey}
    >
      <input
        ref={searchRef}
        type="search"
        className="poolse-emoji-picker__search"
        placeholder="Search emoji"
        aria-label="Search emoji"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (isImeComposing(e)) return;
          if (e.key === 'Enter') {
            e.preventDefault();
            const first = results?.[0];
            if (first) pick(first);
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            gridRef.current
              ?.querySelector<HTMLButtonElement>('.poolse-emoji-picker__emoji')
              ?.focus();
          }
        }}
      />
      {!results && data ? (
        <div className="poolse-emoji-picker__tabs" role="toolbar" aria-label="Emoji categories">
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              className="poolse-emoji-picker__tab"
              aria-label={s.label}
              title={s.label}
              onClick={() => jumpTo(s.id)}
            >
              {s.id === 'recent' ? (
                '🕘'
              ) : (
                <EmojiGlyph emoji={s.emojis[0] ?? ''} customEmoji={custom} size={16} />
              )}
            </button>
          ))}
        </div>
      ) : null}
      <div ref={gridRef} className="poolse-emoji-picker__scroll" onKeyDown={onGridKey}>
        {!data ? (
          <div className="poolse-emoji-picker__empty">Loading…</div>
        ) : results ? (
          results.length === 0 ? (
            <div className="poolse-emoji-picker__empty">No emoji found</div>
          ) : (
            <div className="poolse-emoji-picker__grid" role="group" aria-label="Search results">
              {results.map((e, i) => emojiButton(e, `${i}-${e}`))}
            </div>
          )
        ) : (
          sections.map((s) => (
            <section key={s.id} data-emoji-section={s.id} aria-label={s.label}>
              <div className="poolse-emoji-picker__heading">{s.label}</div>
              <div className="poolse-emoji-picker__grid">
                {s.emojis.map((e, i) => emojiButton(e, `${s.id}-${i}`))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
