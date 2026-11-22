// Pure helpers behind the composers in @poolse/react-ui and
// @poolse/react-native: the Markdown formatting toolbar (MS4), slash
// command suggestions (IN3) and media playback helpers (MS15, MS16).
// No React, so both platforms share one implementation and tests.

/** A text selection: `start === end` is a caret. */
export interface TextSelection {
  start: number;
  end: number;
}

/** The text after a change and where the selection goes. */
export interface TextEdit {
  value: string;
  selection: TextSelection;
}

/** What the formatting toolbar can do. Every format is plain Markdown (GFM). */
export type FormatKind =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'code'
  | 'link'
  | 'quote'
  | 'bulletList'
  | 'numberedList'
  | 'checklist'
  | 'codeBlock'
  | 'table';

/** The toolbar's buttons in their default order, with labels and icon names. */
export const FORMAT_ACTIONS: ReadonlyArray<{
  kind: FormatKind;
  label: string;
  /** Short glyph for toolbars without icons. */
  glyph: string;
  /** Web shortcut, if any (Cmd on macOS, Ctrl elsewhere). */
  shortcut?: string;
}> = [
  { kind: 'bold', label: 'Bold', glyph: 'B', shortcut: 'Mod+B' },
  { kind: 'italic', label: 'Italic', glyph: 'I', shortcut: 'Mod+I' },
  { kind: 'strike', label: 'Strikethrough', glyph: 'S', shortcut: 'Mod+Shift+X' },
  { kind: 'code', label: 'Code', glyph: '<>', shortcut: 'Mod+E' },
  { kind: 'link', label: 'Link', glyph: '🔗', shortcut: 'Mod+K' },
  { kind: 'quote', label: 'Quote', glyph: '❝' },
  { kind: 'bulletList', label: 'Bulleted list', glyph: '•' },
  { kind: 'numberedList', label: 'Numbered list', glyph: '1.' },
  { kind: 'checklist', label: 'Checklist', glyph: '☐' },
  { kind: 'codeBlock', label: 'Code block', glyph: '{}' },
  { kind: 'table', label: 'Table', glyph: '▦' },
];

const INLINE: Partial<Record<FormatKind, string>> = {
  bold: '**',
  italic: '_',
  strike: '~~',
  code: '`',
};

const LINE_PREFIX: Partial<Record<FormatKind, string>> = {
  quote: '> ',
  bulletList: '- ',
  checklist: '- [ ] ',
};

function clampSelection(value: string, sel: TextSelection): TextSelection {
  const start = Math.max(0, Math.min(sel.start, sel.end, value.length));
  const end = Math.max(start, Math.min(Math.max(sel.start, sel.end), value.length));
  return { start, end };
}

/**
 * Apply one toolbar format to `value` at `selection`.
 *
 * - Inline formats (bold, italic, strike, code) wrap the selection, or
 *   unwrap it when it is already wrapped; with a caret they insert the
 *   pair and put the caret between.
 * - Line formats (quote, lists, checklist) prefix every selected line,
 *   or remove the prefix when every line already has it. Numbered lists
 *   count from 1.
 * - `link` makes `[text](url)` and selects `url`; `codeBlock` fences the
 *   selection; `table` inserts a two-column table on its own lines.
 */
export function applyFormat(value: string, selection: TextSelection, kind: FormatKind): TextEdit {
  const { start, end } = clampSelection(value, selection);
  const selected = value.slice(start, end);
  const before = value.slice(0, start);
  const after = value.slice(end);

  const marker = INLINE[kind];
  if (marker) {
    const m = marker.length;
    // Already wrapped around the selection: unwrap.
    if (before.endsWith(marker) && after.startsWith(marker)) {
      return {
        value: before.slice(0, -m) + selected + after.slice(m),
        selection: { start: start - m, end: end - m },
      };
    }
    if (selected.length > 2 * m && selected.startsWith(marker) && selected.endsWith(marker)) {
      const inner = selected.slice(m, -m);
      return { value: before + inner + after, selection: { start, end: start + inner.length } };
    }
    return {
      value: before + marker + selected + marker + after,
      selection: { start: start + m, end: end + m },
    };
  }

  if (kind === 'link') {
    const text = selected || 'text';
    const url = 'https://';
    const next = `${before}[${text}](${url})${after}`;
    const urlStart = start + text.length + 3;
    return { value: next, selection: { start: urlStart, end: urlStart + url.length } };
  }

  if (kind === 'codeBlock') {
    const lead = before === '' || before.endsWith('\n') ? '' : '\n';
    const tail = after === '' || after.startsWith('\n') ? '' : '\n';
    const block = `${lead}\`\`\`\n${selected}\n\`\`\`${tail}`;
    const innerStart = start + lead.length + 4;
    return {
      value: before + block + after,
      selection: { start: innerStart, end: innerStart + selected.length },
    };
  }

  if (kind === 'table') {
    const lead = before === '' || before.endsWith('\n') ? '' : '\n';
    const header = selected.trim() || 'Column';
    const table = `${lead}| ${header} | Column |\n| --- | --- |\n|  |  |\n`;
    const cell = start + table.length - 6; // the first empty body cell
    return { value: before + table + after, selection: { start: cell, end: cell } };
  }

  // Line formats: operate on whole lines touched by the selection.
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const nl = value.indexOf('\n', end);
  const lineEnd = nl === -1 ? value.length : nl;
  const lines = value.slice(lineStart, lineEnd).split('\n');
  const numbered = /^\d+\. /;
  const prefix = LINE_PREFIX[kind];
  const has = (line: string) =>
    kind === 'numberedList' ? numbered.test(line) : line.startsWith(prefix!);
  const allHave = lines.every(has);
  const nextLines = lines.map((line, i) => {
    if (allHave)
      return kind === 'numberedList' ? line.replace(numbered, '') : line.slice(prefix!.length);
    // Swap a different list marker instead of stacking two.
    const bare = line.replace(/^(\d+\. |- \[[ xX]\] |- |\* |> )/, '');
    return (kind === 'numberedList' ? `${i + 1}. ` : prefix!) + bare;
  });
  const block = nextLines.join('\n');
  const next = value.slice(0, lineStart) + block + value.slice(lineEnd);
  if (start === end) {
    // Keep the caret at the end of its line's content.
    const caret = lineStart + nextLines[0]!.length;
    return { value: next, selection: { start: caret, end: caret } };
  }
  return { value: next, selection: { start: lineStart, end: lineStart + block.length } };
}

/** Map a web keyboard shortcut to a format, or `null`. `mod` is Cmd on macOS, Ctrl elsewhere. */
export function formatForShortcut(e: {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}): FormatKind | null {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return null;
  const key = e.key.toLowerCase();
  if (e.shiftKey) return key === 'x' ? 'strike' : null;
  switch (key) {
    case 'b':
      return 'bold';
    case 'i':
      return 'italic';
    case 'e':
      return 'code';
    case 'k':
      return 'link';
    default:
      return null;
  }
}

// ── Slash commands (IN3) ──────────────────────────────────────

/** One command the composer can suggest after `/`. */
export interface SlashCommand {
  /** The command without the slash, e.g. `jira`. Lowercase letters, digits, `-` and `_`. */
  name: string;
  /** One line: what it does. */
  description?: string;
  /** Argument hint shown after the name, e.g. `[issue key]`. */
  usage?: string;
  /** Who provides it (an app's display name), shown muted. Never an id. */
  source?: string;
}

/**
 * The `/command` being typed: only at the very start of the message, before
 * the first space. `null` otherwise (a slash mid-sentence, a URL).
 */
export function slashQuery(value: string, caret: number): { query: string } | null {
  if (!value.startsWith('/')) return null;
  const head = value.slice(1, caret);
  if (caret < 1 || /\s/.test(head)) return null;
  const end = value.search(/\s/);
  if (end !== -1 && caret > end) return null;
  return { query: head.toLowerCase() };
}

/** Commands matching `query`: name prefix first, then name or description containing it. */
export function filterSlashCommands<T extends SlashCommand>(
  commands: readonly T[],
  query: string,
  limit = 8,
): T[] {
  const q = query.toLowerCase();
  const prefix: T[] = [];
  const contains: T[] = [];
  for (const c of commands) {
    const name = c.name.toLowerCase();
    if (name.startsWith(q)) prefix.push(c);
    else if (q && (name.includes(q) || c.description?.toLowerCase().includes(q))) contains.push(c);
  }
  prefix.sort((a, b) => a.name.localeCompare(b.name));
  return [...prefix, ...contains].slice(0, limit);
}

/** Replace the typed `/que` with `/name ` and put the caret after it. */
export function applySlashCommand(value: string, name: string): TextEdit {
  const end = value.search(/\s/);
  const rest = end === -1 ? '' : value.slice(end).replace(/^\s+/, '');
  const head = `/${name} `;
  return { value: head + rest, selection: { start: head.length, end: head.length } };
}

/**
 * The composer's suggestions from the Workspace's `GET /workspace/v1/commands`
 * (`{commands: [{command, description, usage, app: {id, name}}]}`): the app's
 * name becomes `source`. Run a sent command with `POST /workspace/v1/commands/run`.
 */
export function slashCommandsFromWorkspace(
  commands: ReadonlyArray<{
    command: string;
    description?: string | null;
    usage?: string | null;
    app?: { id?: string; name?: string | null } | null;
  }>,
): SlashCommand[] {
  return commands.map((c) => ({
    name: c.command,
    ...(c.description ? { description: c.description } : {}),
    ...(c.usage ? { usage: c.usage } : {}),
    ...(c.app?.name ? { source: c.app.name } : {}),
  }));
}

/** Split a sent `/name args` into its parts, or `null` for a normal message. */
export function parseSlashCommand(value: string): { name: string; args: string } | null {
  const m = /^\/([a-z0-9_-]+)(?:\s+([\s\S]*))?$/i.exec(value.trim());
  if (!m) return null;
  return { name: m[1]!.toLowerCase(), args: (m[2] ?? '').trim() };
}

// ── Group mentions (MS9) ──────────────────────────────────────

/** A user group offered in the @ menu next to members. */
export interface MentionGroup {
  /** What is typed after `@`: lowercase letters, digits, `-`, `_`. */
  handle: string;
  /** Shown name, e.g. "Design team". */
  name: string;
  /** Shown as "12 people". */
  memberCount?: number;
  /** Shown muted instead of the count, e.g. "On call: Ana". */
  description?: string;
}

/** Groups whose handle or name matches `query`: handle prefix, then name word prefix, then anywhere. */
export function rankMentionGroups<T extends MentionGroup>(
  groups: readonly T[],
  query: string,
  limit = 8,
): T[] {
  const q = query.toLowerCase();
  const scored: { g: T; score: number }[] = [];
  for (const g of groups) {
    const handle = g.handle.toLowerCase();
    const name = g.name.toLowerCase();
    const score =
      q === ''
        ? 1
        : handle.startsWith(q)
          ? 3
          : name.split(/\s+/).some((w) => w.startsWith(q))
            ? 2
            : handle.includes(q) || name.includes(q)
              ? 1
              : 0;
    if (score > 0) scored.push({ g, score });
  }
  scored.sort((a, b) => b.score - a.score || a.g.handle.localeCompare(b.g.handle));
  return scored.slice(0, limit).map((s) => s.g);
}

/** "12 people", "1 person", or the description. `null` when there's neither. */
export function mentionGroupMeta(g: MentionGroup): string | null {
  if (g.description) return g.description;
  if (g.memberCount === undefined) return null;
  return `${g.memberCount} ${g.memberCount === 1 ? 'person' : 'people'}`;
}

// ── Playback (MS15, MS16) ─────────────────────────────────────

/**
 * The speeds a voice or video message cycles through (recordings of calls
 * use the SDK's `PLAYBACK_RATES`, which add 1.25×). Times format with the
 * SDK's `formatClock`.
 */
export const MESSAGE_PLAYBACK_RATES = [1, 1.5, 2] as const;
export type MessagePlaybackRate = (typeof MESSAGE_PLAYBACK_RATES)[number];

/** The next speed after `rate` (wraps 2× → 1×). */
export function nextPlaybackRate(rate: number): MessagePlaybackRate {
  const i = MESSAGE_PLAYBACK_RATES.indexOf(rate as MessagePlaybackRate);
  return MESSAGE_PLAYBACK_RATES[(i + 1) % MESSAGE_PLAYBACK_RATES.length]!;
}

/** `1×`, `1.5×`, `2×`. */
export function playbackRateLabel(rate: number): string {
  return `${rate}×`;
}

/**
 * Downsample raw amplitude samples (0–1) to `bars` bars for a waveform,
 * taking each bucket's peak. Empty input gives flat bars.
 */
export function waveformBars(samples: readonly number[], bars: number): number[] {
  if (bars <= 0) return [];
  if (samples.length === 0) return new Array<number>(bars).fill(0.08);
  const out: number[] = [];
  for (let i = 0; i < bars; i++) {
    const from = Math.floor((i * samples.length) / bars);
    const to = Math.max(from + 1, Math.floor(((i + 1) * samples.length) / bars));
    let peak = 0;
    for (let j = from; j < to && j < samples.length; j++) peak = Math.max(peak, samples[j]!);
    out.push(Math.max(0.08, Math.min(1, peak)));
  }
  return out;
}

/** A timed line of a media transcript (voice and video messages). */
export interface MediaTranscriptSegment {
  start_ms: number;
  end_ms: number;
  text: string;
  /** Speaker label, when the transcript has more than one. */
  speaker?: string | null;
}
