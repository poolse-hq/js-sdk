import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { defaultDarkTheme, defaultLightTheme } from './default.js';
import type { PoolseRNTheme, PoolseRNThemeOverrides, ThemeMode } from './types.js';

const ThemeContext = createContext<PoolseRNTheme | null>(null);

export interface PoolseThemeProps {
  /**
   * Light or dark base palette. Overrides are merged on top of the
   * chosen base. Defaults to `light` if omitted.
   */
  mode?: ThemeMode;
  /**
   * Partial overrides — only the fields you set replace the defaults.
   * Nested groups (`colors`, `type`, `radii`, `spacing`, `shadows`)
   * deep-merge, so `{ colors: { brand: '#000' } }` keeps every other
   * color from the base theme.
   */
  theme?: PoolseRNThemeOverrides;
  children: ReactNode;
}

export function PoolseTheme({ mode, theme, children }: PoolseThemeProps) {
  const resolved = useMemo(() => {
    const base = (mode ?? theme?.mode) === 'dark' ? defaultDarkTheme : defaultLightTheme;
    if (!theme) return base;
    return {
      mode: theme.mode ?? base.mode,
      colors: { ...base.colors, ...theme.colors },
      type: { ...base.type, ...theme.type },
      radii: { ...base.radii, ...theme.radii },
      spacing: { ...base.spacing, ...theme.spacing },
      shadows: {
        sm: { ...base.shadows.sm, ...theme.shadows?.sm },
        md: { ...base.shadows.md, ...theme.shadows?.md },
        lg: { ...base.shadows.lg, ...theme.shadows?.lg },
      },
    } satisfies PoolseRNTheme;
  }, [mode, theme]);

  return <ThemeContext.Provider value={resolved}>{children}</ThemeContext.Provider>;
}

/**
 * Read the active poolse theme. Falls back to `defaultLightTheme`
 * if no `<PoolseTheme>` ancestor is mounted, so components render
 * sensibly even without explicit wiring.
 */
export function usePoolseTheme(): PoolseRNTheme {
  return useContext(ThemeContext) ?? defaultLightTheme;
}
