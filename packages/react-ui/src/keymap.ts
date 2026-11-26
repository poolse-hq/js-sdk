// Keyboard shortcuts inside the components. Every shortcut is scoped to
// the focused component — the composer's to its textarea, the message
// list's to the list — so an app's own shortcuts (Cmd+K, Cmd+[, …)
// never collide with them, and two conversations side by side each
// answer only while focused. Override any binding with `keymap`.
//
// A binding is `'Key'` or modifiers joined with `+`: `'Mod+Enter'`,
// `'Shift+Enter'`, `'ArrowUp'`, `'j'`. `Mod` is Cmd on macOS and Ctrl
// elsewhere (either is accepted). Keys are `KeyboardEvent.key` values;
// single letters match either case. A binding without a modifier only
// matches when no Mod/Ctrl/Alt is held, so `j` never steals Cmd+J.

/** One shortcut, e.g. `'Mod+Enter'`, `'Escape'`, `'j'`. */
export type KeyBinding = string;

export interface ComposerKeymap {
  /** Send the message. Default `Enter` and `Mod+Enter`. */
  send: KeyBinding[];
  /** Insert a new line. Default `Shift+Enter`. */
  newline: KeyBinding[];
  /** In an empty composer: edit your last message. Default `ArrowUp`. */
  editLast: KeyBinding[];
  /** Cancel the reply being composed (or an edit). Default `Escape`. */
  cancel: KeyBinding[];
}

export interface MessageListKeymap {
  /** Focus the next (newer) message. Default `j`, `ArrowDown`. */
  next: KeyBinding[];
  /** Focus the previous (older) message. Default `k`, `ArrowUp`. */
  prev: KeyBinding[];
  /** Focus the newest message. Default `End`. */
  last: KeyBinding[];
  /** Focus the oldest loaded message. Default `Home`. */
  first: KeyBinding[];
  /** Quote-reply to the focused message. Default `r`. */
  reply: KeyBinding[];
  /** Open the focused message's thread. Default `t`. */
  thread: KeyBinding[];
  /** Edit the focused message (yours). Default `e`. */
  edit: KeyBinding[];
  /** Delete the focused message (yours), after a confirmation. Default `Delete`, `Backspace`. */
  delete: KeyBinding[];
  /** Back to the composer. Default `Escape`. */
  composer: KeyBinding[];
}

export interface PoolseKeymap {
  composer: ComposerKeymap;
  messageList: MessageListKeymap;
}

/** Overrides: any binding list replaces the default one; `[]` turns a shortcut off. */
export interface PoolseKeymapOverrides {
  composer?: Partial<ComposerKeymap>;
  messageList?: Partial<MessageListKeymap>;
}

export const DEFAULT_KEYMAP: PoolseKeymap = {
  composer: {
    send: ['Enter', 'Mod+Enter'],
    newline: ['Shift+Enter'],
    editLast: ['ArrowUp'],
    cancel: ['Escape'],
  },
  messageList: {
    next: ['j', 'ArrowDown'],
    prev: ['k', 'ArrowUp'],
    last: ['End'],
    first: ['Home'],
    reply: ['r'],
    thread: ['t'],
    edit: ['e'],
    delete: ['Delete', 'Backspace'],
    composer: ['Escape'],
  },
};

/**
 * The keymap with `sendOn: 'mod+enter'`: Enter makes a new line and
 * Cmd/Ctrl+Enter sends — for teams that write long messages.
 */
export const MOD_ENTER_COMPOSER: Pick<ComposerKeymap, 'send' | 'newline'> = {
  send: ['Mod+Enter'],
  newline: ['Enter', 'Shift+Enter'],
};

/** The default keymap with `overrides` (and the send mode) applied. */
export function resolveKeymap(
  overrides?: PoolseKeymapOverrides,
  sendOn: 'enter' | 'mod+enter' = 'enter',
): PoolseKeymap {
  return {
    composer: {
      ...DEFAULT_KEYMAP.composer,
      ...(sendOn === 'mod+enter' ? MOD_ENTER_COMPOSER : {}),
      ...overrides?.composer,
    },
    messageList: { ...DEFAULT_KEYMAP.messageList, ...overrides?.messageList },
  };
}

interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** Whether a keyboard event is `binding`. */
export function matchesKey(e: KeyLike, binding: KeyBinding): boolean {
  const parts = binding.split('+');
  const key = parts.pop() ?? '';
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  const wantMod = mods.has('mod');
  const wantCtrl = mods.has('ctrl');
  const wantMeta = mods.has('meta') || mods.has('cmd');
  const wantAlt = mods.has('alt') || mods.has('option');
  const wantShift = mods.has('shift');

  if (wantMod ? !(e.metaKey || e.ctrlKey) : !wantCtrl && !wantMeta && (e.metaKey || e.ctrlKey)) {
    return false;
  }
  if (wantCtrl && !e.ctrlKey) return false;
  if (wantMeta && !e.metaKey) return false;
  if (wantAlt !== e.altKey) return false;
  const letter = key.length === 1;
  // Letters: Shift is part of the case, not a modifier, unless asked for.
  if (!letter && wantShift !== e.shiftKey) return false;
  if (letter && wantShift && !e.shiftKey) return false;
  return letter ? e.key.toLowerCase() === key.toLowerCase() : e.key === key;
}

/** Whether a keyboard event is any of `bindings`. */
export function matchesAny(e: KeyLike, bindings: ReadonlyArray<KeyBinding>): boolean {
  return bindings.some((b) => matchesKey(e, b));
}

/** Whether the event comes from somewhere text is typed (the list's letters stay out of it). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== 'function') return false;
  const el = target as HTMLElement;
  if (el.isContentEditable) return true;
  return !!el.closest('input, textarea, select, [contenteditable="true"]');
}

/**
 * Whether a keydown belongs to an IME composition (Chinese, Japanese,
 * Korean input): the Enter that picks a candidate must not send or save.
 * Safari reports `isComposing` false on that last Enter, but keyCode 229.
 */
export function isImeComposing(e: {
  nativeEvent?: { isComposing?: boolean };
  isComposing?: boolean;
  keyCode?: number;
}): boolean {
  return !!(e.nativeEvent?.isComposing ?? e.isComposing) || e.keyCode === 229;
}

/** What a composer keydown means, given its keymap. */
export function composerAction(
  e: KeyLike,
  keymap: ComposerKeymap,
): 'send' | 'newline' | 'editLast' | 'cancel' | null {
  // Most specific first: `Shift+Enter` before a bare `Enter`.
  if (matchesAny(e, keymap.newline)) return 'newline';
  if (matchesAny(e, keymap.send)) return 'send';
  if (matchesAny(e, keymap.editLast)) return 'editLast';
  if (matchesAny(e, keymap.cancel)) return 'cancel';
  return null;
}
