import { BUILT_IN_THEMES, createTheme, toNativeTheme } from '@poolse/theme';
import { describe, expect, it } from 'vitest';
import {
  defaultDarkTheme,
  defaultLightTheme,
  legacyToNative,
  nativeToLegacy,
} from '../src/theme/default.js';
import { resolveThemeValue, selectedScheme } from '../src/theme/resolveValue.js';

describe('selectedScheme', () => {
  it('stays light by default, as before', () => {
    expect(selectedScheme({}, 'dark')).toBe('light');
    expect(selectedScheme({ theme: { colors: { brand: '#000000' } } }, 'dark')).toBe('light');
  });

  it('follows the OS by default for a named theme', () => {
    expect(selectedScheme({ theme: 'ocean' }, 'dark')).toBe('dark');
    expect(selectedScheme({ theme: createTheme({ id: 'a', name: 'A' }) }, 'light')).toBe('light');
  });

  it('takes colorScheme, then the deprecated mode', () => {
    expect(selectedScheme({ theme: 'ocean', colorScheme: 'light' }, 'dark')).toBe('light');
    expect(selectedScheme({ colorScheme: 'system' }, 'dark')).toBe('dark');
    expect(selectedScheme({ mode: 'dark' }, 'light')).toBe('dark');
    expect(selectedScheme({ theme: { mode: 'dark' } }, 'light')).toBe('dark');
    expect(selectedScheme({ theme: { mode: 'dark' }, colorScheme: 'light' }, 'dark')).toBe('light');
  });
});

describe('resolveThemeValue', () => {
  it('without a theme is the existing default palette (no visual change)', () => {
    const v = resolveThemeValue({}, 'light');
    expect(v.legacy).toBe(defaultLightTheme);
    expect(v.native.colors.accent).toBe('#ff5436');
    expect(v.native.colors.ownBubble).toBe(defaultLightTheme.colors.selfBubble);
    expect(v.native.fonts.lineHeight).toBe(defaultLightTheme.type.lineHeight);
    expect(v.native.radii.bubble).toBe(defaultLightTheme.radii.bubble);
    expect(resolveThemeValue({}, 'dark').legacy).toBe(defaultDarkTheme);
  });

  it('keeps legacy overrides working, in both shapes', () => {
    const v = resolveThemeValue(
      { theme: { colors: { brand: '#123456', unreadPill: '#00ff00' }, radii: { bubble: 4 } } },
      'light',
    );
    expect(v.legacy.colors.brand).toBe('#123456');
    expect(v.legacy.colors.ink).toBe(defaultLightTheme.colors.ink);
    expect(v.native.colors.accent).toBe('#123456');
    expect(v.native.colors.badge).toBe('#00ff00');
    expect(v.native.radii.bubble).toBe(4);
  });

  it('resolves a built-in theme, and the legacy shape follows it', () => {
    const v = resolveThemeValue({ theme: 'forest' }, 'dark');
    expect(v.native).toEqual(toNativeTheme('forest', 'dark'));
    expect(v.legacy.mode).toBe('dark');
    expect(v.legacy.colors.brand).toBe(BUILT_IN_THEMES.forest.dark.colors.accent);
    expect(v.legacy.colors.paper).toBe(BUILT_IN_THEMES.forest.dark.colors.background);
  });

  it('passes font names through for a named theme', () => {
    const v = resolveThemeValue({ theme: 'coral', fonts: { body: 'Inter' } }, 'light');
    expect(v.native.fonts.body).toBe('Inter');
    expect(v.native.fonts.mono).toBe('Menlo');
    expect(v.legacy.type.fontBody).toBe('Inter');
  });
});

describe('legacy shape conversion', () => {
  it('round-trips the default palettes', () => {
    for (const t of [defaultLightTheme, defaultDarkTheme]) {
      expect(nativeToLegacy(legacyToNative(t))).toEqual(t);
    }
  });
});
