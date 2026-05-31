// PoolseIcon — render any icon from the poolse brand set.
//
// All icons follow the same conventions (24x24 grid, 1.8px stroke,
// round caps + joins, single `currentColor` path). They inherit
// `color` so theming flows automatically through the parent's
// text color.
//
// Two ways to use:
//
//   import { PoolseIcon } from '@poolse/react-ui';
//   <PoolseIcon name="send" />                  // 1.2em square by default
//   <PoolseIcon name="send" size={20} />        // explicit pixel size
//   <PoolseIcon name="presence" className="poolse-icon--presence" />
//
// Internally the SVG path data is bundled (~3KB total for the whole
// 41-icon set, tree-shaken by Rollup when only one is imported via
// the per-icon helpers in `./icons/`).

import { type ReactElement, type SVGProps } from 'react';
import { ICONS, type IconName } from './icons-data.js';

export type { IconName };

export interface PoolseIconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  /** Icon name — see {@link IconName} for the full list of 41 icons. */
  name: IconName;
  /** Width + height in pixels. Defaults to `1.2em` so the icon scales with surrounding text. */
  size?: number | string;
  /** Accessibility label. Defaults to the icon name; pass `null` to hide from AT entirely. */
  label?: string | null;
}

export function PoolseIcon({
  name,
  size,
  label,
  className,
  style,
  ...rest
}: PoolseIconProps): ReactElement {
  const def = ICONS[name];
  if (!def) {
    // Surface unknown icon names at runtime (TS catches it at compile
    // time, but a stale dynamic name from data is worth flagging).
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.warn(`PoolseIcon: unknown icon "${String(name)}"`);
    }
    return <svg aria-hidden="true" className={className} style={style} />;
  }

  const aria =
    label === null
      ? { 'aria-hidden': true as const, focusable: false as const }
      : { role: 'img' as const, 'aria-label': label ?? name };

  const dimension = size ?? '1.2em';

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={def.vb}
      width={dimension}
      height={dimension}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={['poolse-icon', className].filter(Boolean).join(' ')}
      style={style}
      {...aria}
      {...rest}
      dangerouslySetInnerHTML={{ __html: def.d }}
    />
  );
}
