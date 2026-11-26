// PoolseTheme — applies a @poolse/theme theme to everything inside it.
//
// The theme's tokens become `--poolse-*` CSS variables on a wrapper
// element (`display: contents`, so it takes no part in layout). They
// are scoped to that element, not set on :root, so two differently
// themed chats can share a page. Changing `theme` or `colorScheme`
// rewrites the variables on the same element: children never remount.
//
// Without `theme`, no variables are set and the stylesheet's defaults
// apply (today's look); `colorScheme` still picks light or dark.

import {
  resolveTheme,
  tokensToCssVariables,
  type ColorScheme,
  type ColorSchemePreference,
  type ResolvedTheme,
  type ThemeInput,
} from '@poolse/theme';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

export interface PoolseThemeProps {
  /**
   * A built-in theme's id (`'coral'`, `'ocean'`, `'forest'`, `'grape'`,
   * `'slate'`, `'sunset'`, `'rose'`, `'mono'`) or a whole `Theme` from
   * `@poolse/theme` (`createTheme`, `decodeTheme`). Omit it to keep
   * the stylesheet's own colours.
   */
  theme?: ThemeInput;
  /** `'system'` (default) follows the OS and updates when it changes. */
  colorScheme?: ColorSchemePreference;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

export interface PoolseThemeValue {
  /** The applied theme for the active scheme, or `null` when no `theme` was given. */
  theme: ResolvedTheme | null;
  colorScheme: ColorScheme;
}

const ThemeContext = createContext<PoolseThemeValue | null>(null);

const DARK_QUERY = '(prefers-color-scheme: dark)';

function systemScheme(): ColorScheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light';
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

/** The OS colour scheme, kept current. `'light'` during server rendering. */
export function useSystemColorScheme(): ColorScheme {
  const [scheme, setScheme] = useState<ColorScheme>(systemScheme);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(DARK_QUERY);
    const onChange = () => setScheme(mql.matches ? 'dark' : 'light');
    onChange();
    // Safari < 14 only has the deprecated listener API.
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, []);
  return scheme;
}

export function PoolseTheme({
  theme,
  colorScheme = 'system',
  className,
  style,
  children,
}: PoolseThemeProps) {
  const system = useSystemColorScheme();
  const scheme: ColorScheme = colorScheme === 'system' ? system : colorScheme;

  const value = useMemo<PoolseThemeValue>(
    () => ({ theme: theme ? resolveTheme(theme, scheme) : null, colorScheme: scheme }),
    [theme, scheme],
  );
  const vars = useMemo(
    () => (value.theme ? tokensToCssVariables(value.theme) : null),
    [value.theme],
  );

  return (
    <ThemeContext.Provider value={value}>
      <div
        className={className ? `poolse-theme ${className}` : 'poolse-theme'}
        data-theme={scheme}
        data-poolse-theme={value.theme?.id}
        style={vars || style ? ({ ...vars, ...style } as CSSProperties) : undefined}
      >
        {children}
      </div>
    </ThemeContext.Provider>
  );
}

/**
 * The nearest `<PoolseTheme>`'s value, or null outside one. Internal: for
 * content portalled out of the wrapper (the PiP window), which does not
 * inherit its CSS variables or `data-theme`.
 */
export function usePoolseThemeScope(): PoolseThemeValue | null {
  return useContext(ThemeContext);
}

/**
 * The nearest `<PoolseTheme>`'s theme and scheme. Outside one, `theme`
 * is `null` and the scheme is the OS's.
 */
export function useTheme(): PoolseThemeValue {
  const value = useContext(ThemeContext);
  const system = useSystemColorScheme();
  return value ?? { theme: null, colorScheme: system };
}
