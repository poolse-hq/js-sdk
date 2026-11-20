// Tokens → `--poolse-*` CSS custom properties for the web.
//
// Every token gets a variable named after it (`accentText` →
// `--poolse-accent-text`). By default the variables
// @poolse/react-ui's stylesheet has always read (`--poolse-brand`,
// `--poolse-ink`, `--poolse-paper`, …) are set too, so a theme reaches
// every component and every app stylesheet written against them.

import { parseHex } from './contrast.js';
import { resolveTheme } from './resolve.js';
import type { ColorScheme, ShadowToken, ThemeInput, ThemeTokens } from './types.js';

export interface CssVariableOptions {
  /**
   * Also set the stylesheet's original variable names. Defaults to
   * `true`; turn it off only if nothing on the page reads them.
   */
  legacy?: boolean;
}

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

function rgba(hex: string, opacity: number): string {
  const c = parseHex(hex);
  if (!c) return hex;
  const a = Math.round(c.a * opacity * 1000) / 1000;
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${a})`;
}

/** A shadow token as a `box-shadow` value. */
export function cssShadow(token: ShadowToken): string {
  return token.layers
    .map((l) => `${l.x}px ${l.y}px ${l.blur}px ${l.spread}px ${rgba(l.color, l.opacity)}`)
    .join(', ');
}

/** Tokens → variables, without resolving a theme first. */
export function tokensToCssVariables(
  t: ThemeTokens,
  options: CssVariableOptions = {},
): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(t.colors)) vars[`--poolse-${kebab(k)}`] = v;

  vars['--poolse-font-body'] = t.fonts.body;
  vars['--poolse-font-display'] = t.fonts.display;
  vars['--poolse-font-mono'] = t.fonts.mono;
  for (const size of ['Xs', 'Sm', 'Md', 'Lg', 'Xl'] as const) {
    vars[`--poolse-font-size-${size.toLowerCase()}`] = `${t.fonts[`size${size}`]}px`;
  }
  vars['--poolse-line-height'] = String(t.fonts.lineHeight);

  for (const [k, v] of Object.entries(t.radii)) vars[`--poolse-radius-${k}`] = `${v}px`;
  for (const [k, v] of Object.entries(t.spacing)) vars[`--poolse-space-${k}`] = `${v}px`;
  for (const [k, v] of Object.entries(t.shadows)) vars[`--poolse-shadow-${k}`] = cssShadow(v);

  if (options.legacy !== false) {
    const c = t.colors;
    Object.assign(vars, {
      '--poolse-brand': c.accent,
      '--poolse-brand-strong': c.accentStrong,
      '--poolse-brand-soft': c.accentSoft,
      '--poolse-on-brand': c.accentText,
      '--poolse-paper': c.background,
      '--poolse-surface-2': c.surfaceAlt,
      '--poolse-ink': c.text,
      '--poolse-ink-2': c.textMuted,
      '--poolse-ink-3': c.textSubtle,
      '--poolse-error': c.danger,
      '--poolse-color-bg': c.background,
      '--poolse-color-surface': c.surface,
      '--poolse-color-border': c.border,
      '--poolse-color-text': c.text,
      '--poolse-color-muted': c.textMuted,
      '--poolse-color-primary': c.accent,
      '--poolse-color-primary-text': c.accentText,
      '--poolse-color-self-bubble': c.ownBubble,
      '--poolse-color-self-bubble-text': c.ownBubbleText,
      '--poolse-color-other-bubble': c.otherBubble,
      '--poolse-color-other-bubble-text': c.otherBubbleText,
      '--poolse-font-family': t.fonts.body,
      '--poolse-font-size': `${t.fonts.sizeMd}px`,
      '--poolse-radius': `${t.radii.lg}px`,
      '--poolse-spacing-xs': `${t.spacing.xs}px`,
      '--poolse-spacing-sm': `${t.spacing.sm}px`,
      '--poolse-spacing-md': `${t.spacing.md}px`,
      '--poolse-spacing-lg': `${t.spacing.lg}px`,
    });
  }
  return vars;
}

/**
 * A theme's variables for one scheme, as an object — spread it into a
 * React `style` prop or set each with `style.setProperty`.
 */
export function toCssVariables(
  theme: ThemeInput,
  scheme: ColorScheme,
  options?: CssVariableOptions,
): Record<string, string> {
  return tokensToCssVariables(resolveTheme(theme, scheme), options);
}

/**
 * The same variables as a CSS rule, for a `<style>` tag or a
 * server-rendered stylesheet:
 *
 *     toCssText('ocean', 'dark', '[data-theme="dark"]')
 */
export function toCssText(
  theme: ThemeInput,
  scheme: ColorScheme,
  selector = ':root',
  options?: CssVariableOptions,
): string {
  const body = Object.entries(toCssVariables(theme, scheme, options))
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n');
  return `${selector} {\n${body}\n}`;
}
