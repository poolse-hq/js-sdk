import { SvgXml } from 'react-native-svg';

import { usePoolseTheme } from '../theme/PoolseTheme.js';
import { ICONS, type IconName } from './icons-data.js';

export type { IconName };

export interface PoolseIconProps {
  /** Icon name — see {@link IconName} for the full list. */
  name: IconName;
  /** Width + height in pixels. Defaults to `20` (matches a body-line). */
  size?: number;
  /** Stroke color. Defaults to the theme's `ink` color. */
  color?: string;
  /** Accessibility label. Defaults to the icon name. */
  label?: string | null;
}

export function PoolseIcon({ name, size = 20, color, label }: PoolseIconProps) {
  const theme = usePoolseTheme();
  const def = ICONS[name];
  if (!def) return null;
  const stroke = color ?? theme.colors.ink;
  const xml = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${def.vb}" fill="none" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${def.d}</svg>`;
  const a11y =
    label === null
      ? { accessibilityRole: 'none' as const }
      : { accessibilityRole: 'image' as const, accessibilityLabel: label ?? name };
  return <SvgXml xml={xml} width={size} height={size} {...a11y} />;
}
