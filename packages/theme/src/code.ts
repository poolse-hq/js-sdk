// Shareable theme codes: a custom theme as one short string someone
// can paste into another app.
//
//     pt1.eyJpIjoiYWNtZSIsIm4iOiJBY21lIiwiYiI6Im9jZWFuIiwibCI6eyJjIjp7…
//
// `pt` + format version + `.` + base64url(JSON). The JSON holds only
// the tokens that differ from the built-in theme it extends (a change
// both schemes share is stored once), so a theme that changes an
// accent is a few dozen characters. Decoding validates
// every field — a code is user input, and font names end up in CSS.

import { parseHex } from './contrast.js';
import { BUILT_IN_THEMES, DEFAULT_THEME_ID, isBuiltInThemeId } from './themes.js';
import type {
  BuiltInThemeId,
  ShadowToken,
  Theme,
  ThemeColors,
  ThemeFonts,
  ThemeRadii,
  ThemeShadows,
  ThemeSpacing,
  ThemeTokens,
} from './types.js';

const VERSION = 1;
const MAX_CODE_LENGTH = 8192;

export class ThemeCodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ThemeCodeError';
  }
}

// Wire shape. Short keys keep the code short.
interface TokenDiff {
  c?: Partial<Record<keyof ThemeColors, string>>;
  f?: Partial<ThemeFonts>;
  r?: Partial<ThemeRadii>;
  s?: Partial<ThemeSpacing>;
  h?: Partial<ThemeShadows>;
}
interface Payload {
  i: string;
  n: string;
  b: BuiltInThemeId;
  /** Both schemes. */
  a?: TokenDiff;
  l?: TokenDiff;
  d?: TokenDiff;
}

const GROUPS = [
  ['c', 'colors'],
  ['f', 'fonts'],
  ['r', 'radii'],
  ['s', 'spacing'],
  ['h', 'shadows'],
] as const;

const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
// Family names, commas, quotes and spaces — nothing that can end a CSS
// declaration or open another.
const FONT_RE = /^[\p{L}\p{N} ,'_-]{1,200}$/u;

// ── Encode ────────────────────────────────────────────────────

function normalizeHex(hex: string, where: string): string {
  const c = parseHex(hex);
  if (!c) throw new ThemeCodeError(`${where}: not a hex colour: ${hex}`);
  const h2 = (v: number) => v.toString(16).padStart(2, '0');
  const alpha = c.a < 1 ? h2(Math.round(c.a * 255)) : '';
  return `${h2(c.r)}${h2(c.g)}${h2(c.b)}${alpha}`;
}

function diffTokens(t: ThemeTokens, base: ThemeTokens, scheme: string): TokenDiff | undefined {
  const out: TokenDiff = {};
  for (const [short, group] of GROUPS) {
    const changed: Record<string, unknown> = {};
    const values = t[group] as unknown as Record<string, unknown>;
    const baseValues = base[group] as unknown as Record<string, unknown>;
    for (const key of Object.keys(baseValues)) {
      const v = values[key];
      if (group === 'colors') {
        const hex = normalizeHex(String(v), `${scheme}.colors.${key}`);
        if (hex !== normalizeHex(String(baseValues[key]), 'base')) changed[key] = hex;
      } else if (JSON.stringify(v) !== JSON.stringify(baseValues[key])) {
        changed[key] = v;
      }
    }
    if (Object.keys(changed).length > 0) (out as Record<string, unknown>)[short] = changed;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

// Moves the changes the two schemes have in common out of both diffs.
function splitShared(l: TokenDiff, d: TokenDiff): TokenDiff | undefined {
  const shared: Record<string, Record<string, unknown>> = {};
  const ld = l as Record<string, Record<string, unknown> | undefined>;
  const dd = d as Record<string, Record<string, unknown> | undefined>;
  for (const [short] of GROUPS) {
    const lg = ld[short];
    const dg = dd[short];
    if (!lg || !dg) continue;
    for (const key of Object.keys(lg)) {
      if (!(key in dg) || JSON.stringify(lg[key]) !== JSON.stringify(dg[key])) continue;
      (shared[short] ??= {})[key] = lg[key];
      delete lg[key];
      delete dg[key];
    }
    if (Object.keys(lg).length === 0) delete ld[short];
    if (Object.keys(dg).length === 0) delete dd[short];
  }
  return Object.keys(shared).length > 0 ? (shared as TokenDiff) : undefined;
}

/**
 * A theme as a shareable code. Built-in themes encode to just their
 * id and name; custom ones to their differences from the built-in
 * theme they extend (`theme.extends`, else `coral`).
 */
export function encodeTheme(theme: Theme): string {
  if (!ID_RE.test(theme.id)) throw new ThemeCodeError(`invalid theme id: ${theme.id}`);
  const b = isBuiltInThemeId(theme.extends) ? theme.extends : DEFAULT_THEME_ID;
  const base = BUILT_IN_THEMES[b];
  const payload: Payload = { i: theme.id, n: theme.name, b };
  const l = diffTokens(theme.light, base.light, 'light') ?? {};
  const d = diffTokens(theme.dark, base.dark, 'dark') ?? {};
  const a = splitShared(l, d);
  if (a) payload.a = a;
  if (Object.keys(l).length > 0) payload.l = l;
  if (Object.keys(d).length > 0) payload.d = d;
  validateName(payload.n);
  return `pt${VERSION}.${base64UrlEncode(utf8Encode(JSON.stringify(payload)))}`;
}

// ── Decode ────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function validateName(name: unknown): asserts name is string {
  if (
    typeof name !== 'string' ||
    name.trim().length === 0 ||
    name.length > 60 ||
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u001f\u007f]/.test(name)
  ) {
    throw new ThemeCodeError('invalid theme name');
  }
}

function num(v: unknown, min: number, max: number, where: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
    throw new ThemeCodeError(`${where}: expected a number from ${min} to ${max}`);
  }
  return v;
}

function onlyKeys(v: Record<string, unknown>, allowed: readonly string[], where: string): void {
  for (const k of Object.keys(v)) {
    if (!allowed.includes(k)) throw new ThemeCodeError(`${where}: unknown field "${k}"`);
  }
}

function shadowToken(v: unknown, where: string): ShadowToken {
  if (!isRecord(v)) throw new ThemeCodeError(`${where}: expected a shadow`);
  onlyKeys(v, ['layers', 'elevation'], where);
  if (!Array.isArray(v.layers) || v.layers.length > 4) {
    throw new ThemeCodeError(`${where}.layers: expected up to 4 layers`);
  }
  return {
    layers: v.layers.map((l: unknown, i: number) => {
      const at = `${where}.layers[${i}]`;
      if (!isRecord(l)) throw new ThemeCodeError(`${at}: expected a layer`);
      onlyKeys(l, ['x', 'y', 'blur', 'spread', 'color', 'opacity'], at);
      return {
        x: num(l.x, -100, 100, `${at}.x`),
        y: num(l.y, -100, 100, `${at}.y`),
        blur: num(l.blur, 0, 200, `${at}.blur`),
        spread: num(l.spread, -100, 100, `${at}.spread`),
        color: `#${hexValue(l.color, `${at}.color`)}`,
        opacity: num(l.opacity, 0, 1, `${at}.opacity`),
      };
    }),
    elevation: num(v.elevation, 0, 24, `${where}.elevation`),
  };
}

function hexValue(v: unknown, where: string): string {
  if (typeof v !== 'string' || !/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(v)) {
    throw new ThemeCodeError(`${where}: expected a hex colour`);
  }
  return v.toLowerCase();
}

function applyDiff(base: ThemeTokens, diff: unknown, scheme: string): ThemeTokens {
  if (diff === undefined) return base;
  if (!isRecord(diff)) throw new ThemeCodeError(`${scheme}: expected an object`);
  onlyKeys(
    diff,
    GROUPS.map(([s]) => s),
    scheme,
  );
  const out: ThemeTokens = {
    colors: { ...base.colors },
    fonts: { ...base.fonts },
    radii: { ...base.radii },
    spacing: { ...base.spacing },
    shadows: { ...base.shadows },
  };
  for (const [short, group] of GROUPS) {
    const values = diff[short];
    if (values === undefined) continue;
    const where = `${scheme}.${group}`;
    if (!isRecord(values)) throw new ThemeCodeError(`${where}: expected an object`);
    onlyKeys(values, Object.keys(base[group]), where);
    const target = out[group] as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(values)) {
      const at = `${where}.${k}`;
      if (group === 'colors') target[k] = `#${hexValue(v, at)}`;
      else if (group === 'fonts') {
        if (k === 'body' || k === 'display' || k === 'mono') {
          if (typeof v !== 'string' || !FONT_RE.test(v)) {
            throw new ThemeCodeError(`${at}: expected a font-family list`);
          }
          target[k] = v;
        } else if (k === 'lineHeight') target[k] = num(v, 1, 3, at);
        else target[k] = num(v, 8, 48, at);
      } else if (group === 'radii') target[k] = num(v, 0, 999, at);
      else if (group === 'spacing') target[k] = num(v, 0, 64, at);
      else target[k] = shadowToken(v, at);
    }
  }
  return out;
}

/**
 * The theme a code describes. Throws `ThemeCodeError` with a reason
 * when the code is malformed, from an unknown format version, or holds
 * a value outside what a theme allows.
 */
export function decodeTheme(code: string): Theme {
  if (typeof code !== 'string') throw new ThemeCodeError('expected a string');
  const trimmed = code.trim();
  if (trimmed.length > MAX_CODE_LENGTH) throw new ThemeCodeError('code is too long');
  const m = /^pt(\d{1,3})\.([A-Za-z0-9_-]+)$/.exec(trimmed);
  if (!m) throw new ThemeCodeError('not a poolse theme code');
  const version = Number(m[1]);
  if (version !== VERSION) {
    throw new ThemeCodeError(`unsupported theme code version ${version}; update @poolse/theme`);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(utf8Decode(base64UrlDecode(m[2]!)));
  } catch {
    throw new ThemeCodeError('the code is damaged');
  }
  if (!isRecord(payload)) throw new ThemeCodeError('the code is damaged');
  onlyKeys(payload, ['i', 'n', 'b', 'a', 'l', 'd'], 'theme');
  if (typeof payload.i !== 'string' || !ID_RE.test(payload.i)) {
    throw new ThemeCodeError('invalid theme id');
  }
  validateName(payload.n);
  if (!isBuiltInThemeId(payload.b)) throw new ThemeCodeError(`unknown base theme`);

  const base = BUILT_IN_THEMES[payload.b];
  return {
    id: payload.i,
    name: payload.n,
    extends: payload.b,
    light: applyDiff(applyDiff(base.light, payload.a, 'all'), payload.l, 'light'),
    dark: applyDiff(applyDiff(base.dark, payload.a, 'all'), payload.d, 'dark'),
  };
}

// ── UTF-8 + base64url, without relying on TextEncoder / btoa ──
// (not on every React Native runtime).

function utf8Encode(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 63),
        0x80 | ((cp >> 6) & 63),
        0x80 | (cp & 63),
      );
  }
  return out;
}

function utf8Decode(bytes: number[]): string {
  let s = '';
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i]!;
    const n = b < 0x80 ? 0 : b >= 0xf0 ? 3 : b >= 0xe0 ? 2 : b >= 0xc0 ? 1 : -1;
    if (n < 0 || i + n >= bytes.length) throw new Error('bad utf-8');
    let cp = n === 0 ? b : b & (0x3f >> n);
    for (let k = 1; k <= n; k++) {
      const c = bytes[i + k];
      if (c === undefined || (c & 0xc0) !== 0x80) throw new Error('bad utf-8');
      cp = (cp << 6) | (c & 63);
    }
    s += String.fromCodePoint(cp);
    i += n + 1;
  }
  return s;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function base64UrlEncode(bytes: number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = i + 2 < bytes.length ? 4 : i + 1 < bytes.length ? 3 : 2;
    for (let k = 0; k < chars; k++) out += B64[(n >> (18 - 6 * k)) & 63];
  }
  return out;
}

function base64UrlDecode(s: string): number[] {
  if (s.length % 4 === 1) throw new Error('bad base64');
  const out: number[] = [];
  for (let i = 0; i < s.length; i += 4) {
    const chunk = s.slice(i, i + 4);
    let n = 0;
    for (let k = 0; k < 4; k++) {
      const v = k < chunk.length ? B64.indexOf(chunk[k]!) : 0;
      if (v < 0) throw new Error('bad base64');
      n = (n << 6) | v;
    }
    out.push((n >> 16) & 255);
    if (chunk.length > 2) out.push((n >> 8) & 255);
    if (chunk.length > 3) out.push(n & 255);
  }
  return out;
}
