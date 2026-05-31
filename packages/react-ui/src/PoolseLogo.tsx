// PoolseLogo — brand mark + lockup, color-aware via CSS variables.
//
// All variants use the CSS classes `.mk-tile`, `.mk-pulse`,
// `.mk-pulse-dot`, `.wm-ink`, `.wm-o` (defined in `styles.css`) so
// the logo follows the active theme automatically. Setting
// `variant="mono"` switches to a single-color rendering using
// `currentColor` — useful for muted secondary chrome, embossing,
// or print.
//
// ```tsx
// <PoolseLogo />                       // full lockup, theme-aware
// <PoolseLogo variant="mark" />        // just the chip
// <PoolseLogo variant="wordmark" />    // just the wordmark
// <PoolseLogo variant="mono" />        // single-color (currentColor)
// <PoolseLogo size={48} />             // pixel height
// ```

import { type ReactElement, type SVGProps } from 'react';

export type PoolseLogoVariant = 'lockup' | 'mark' | 'wordmark' | 'mono';

export interface PoolseLogoProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  variant?: PoolseLogoVariant;
  /** Height in pixels — width is computed from the variant's aspect ratio. */
  size?: number;
  /** Accessibility label. Defaults to "poolse"; pass `null` for decoration-only. */
  label?: string | null;
}

const MARK_PATHS = (
  <>
    <path
      className="mk-tile"
      d="M50 4 C20 4 4 20 4 50 C4 80 20 96 50 96 C80 96 96 80 96 50 C96 20 80 4 50 4 Z"
    />
    <path
      className="mk-pulse"
      d="M16 55 H34 L40 55 L47 30 L54 73 L60 55 H72"
      fill="none"
      strokeWidth={9}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle className="mk-pulse-dot" cx={72} cy={55} r={6.2} />
  </>
);

const WORDMARK_PATHS = (offsetX: number) => (
  <g transform={`translate(${offsetX},85.0) scale(0.09722222222222222,-0.09722222222222222)`}>
    <path
      className="wm-ink"
      transform="translate(0,0)"
      d="M62 -169V258V528H194L196 378L214 376Q223 432 246.0 469.0Q269 506 305.5 524.0Q342 542 389 542Q459 542 509.5 508.0Q560 474 587.0 411.0Q614 348 614 260Q614 182 590.5 120.0Q567 58 519.5 22.0Q472 -14 399 -14Q350 -14 316.0 3.5Q282 21 258.5 55.0Q235 89 219 140H200Q206 113 211.0 85.0Q216 57 219.5 31.0Q223 5 223 -19V-169ZM340 113Q373 113 396.5 131.0Q420 149 433.0 182.0Q446 215 446 259Q446 306 432.5 339.5Q419 373 394.0 391.5Q369 410 336 410Q305 410 283.5 396.5Q262 383 248.5 361.5Q235 340 229.0 316.0Q223 292 223 271V249Q223 230 228.0 211.0Q233 192 243.0 174.5Q253 157 267.0 143.0Q281 129 299.5 121.0Q318 113 340 113Z"
    />
    <path
      className="wm-o"
      transform="translate(658,0)"
      d="M305 -14Q225 -14 163.5 17.0Q102 48 67.0 110.0Q32 172 32 265Q32 358 67.0 419.5Q102 481 164.0 511.5Q226 542 306 542Q386 542 448.0 511.0Q510 480 545.0 418.5Q580 357 580 264Q580 169 544.0 107.0Q508 45 445.5 15.5Q383 -14 305 -14ZM310 103Q346 103 370.0 119.5Q394 136 406.0 170.0Q418 204 418 254Q418 307 405.0 343.5Q392 380 366.5 399.5Q341 419 301 419Q267 419 242.5 402.5Q218 386 206.0 352.0Q194 318 194 267Q194 185 224.5 144.0Q255 103 310 103Z"
    />
    <path
      className="wm-o"
      transform="translate(1280,0)"
      d="M305 -14Q225 -14 163.5 17.0Q102 48 67.0 110.0Q32 172 32 265Q32 358 67.0 419.5Q102 481 164.0 511.5Q226 542 306 542Q386 542 448.0 511.0Q510 480 545.0 418.5Q580 357 580 264Q580 169 544.0 107.0Q508 45 445.5 15.5Q383 -14 305 -14ZM310 103Q346 103 370.0 119.5Q394 136 406.0 170.0Q418 204 418 254Q418 307 405.0 343.5Q392 380 366.5 399.5Q341 419 301 419Q267 419 242.5 402.5Q218 386 206.0 352.0Q194 318 194 267Q194 185 224.5 144.0Q255 103 310 103Z"
    />
    <path className="wm-ink" transform="translate(1902,0)" d="M62 0V720H220V0Z" />
    <path
      className="wm-ink"
      transform="translate(2195,0)"
      d="M278 -14Q225 -14 182.0 -4.5Q139 5 107.0 23.0Q75 41 54.5 66.5Q34 92 26 123L146 176Q153 159 170.5 141.5Q188 124 217.5 113.0Q247 102 289 102Q329 102 351.5 113.5Q374 125 374 147Q374 163 361.5 172.5Q349 182 324.0 189.5Q299 197 262 204Q224 212 185.0 222.5Q146 233 112.0 251.5Q78 270 57.5 300.5Q37 331 37 378Q37 427 63.0 463.5Q89 500 140.5 521.0Q192 542 266 542Q332 542 382.0 525.0Q432 508 465.5 476.5Q499 445 512 401L383 355Q378 377 362.5 393.0Q347 409 323.5 417.5Q300 426 268 426Q229 426 207.5 414.0Q186 402 186 382Q186 366 200.5 355.5Q215 345 242.0 338.0Q269 331 306 323Q345 315 383.5 304.5Q422 294 453.5 276.5Q485 259 503.5 230.5Q522 202 522 157Q522 104 494.0 65.5Q466 27 411.5 6.5Q357 -14 278 -14Z"
    />
    <path
      className="wm-ink"
      transform="translate(2754,0)"
      d="M313 -14Q247 -14 195.0 3.5Q143 21 106.5 55.0Q70 89 51.0 139.0Q32 189 32 254Q32 317 50.5 370.0Q69 423 103.5 461.5Q138 500 188.5 521.0Q239 542 302 542Q366 542 414.5 521.5Q463 501 494.5 461.0Q526 421 541.0 363.5Q556 306 551 232L138 229V313L459 316L402 277Q409 327 396.0 358.5Q383 390 358.0 404.5Q333 419 304 419Q269 419 242.5 400.0Q216 381 201.0 345.0Q186 309 186 257Q186 175 221.5 138.0Q257 101 312 101Q339 101 357.0 108.5Q375 116 386.5 127.5Q398 139 404.5 153.0Q411 167 415 180L555 150Q547 113 529.5 83.0Q512 53 482.5 31.0Q453 9 411.5 -2.5Q370 -14 313 -14Z"
    />
  </g>
);

const VARIANTS: Record<
  PoolseLogoVariant,
  { vb: string; aspect: number; render: () => ReactElement }
> = {
  lockup: {
    vb: '0 0 454 100',
    aspect: 4.54,
    render: () => (
      <>
        {MARK_PATHS}
        {WORDMARK_PATHS(126)}
      </>
    ),
  },
  mark: { vb: '0 0 100 100', aspect: 1.0, render: () => MARK_PATHS },
  wordmark: { vb: '0 0 350 100', aspect: 3.5, render: () => WORDMARK_PATHS(0) },
  mono: {
    vb: '0 0 454 100',
    aspect: 4.54,
    render: () => (
      <>
        {MARK_PATHS}
        {WORDMARK_PATHS(126)}
      </>
    ),
  },
};

export function PoolseLogo({
  variant = 'lockup',
  size = 28,
  label,
  className,
  ...rest
}: PoolseLogoProps): ReactElement {
  const v = VARIANTS[variant];
  const aria =
    label === null
      ? { 'aria-hidden': true as const, focusable: false as const }
      : { role: 'img' as const, 'aria-label': label ?? 'poolse' };

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={v.vb}
      width={size * v.aspect}
      height={size}
      className={
        ['poolse-logo', variant === 'mono' ? 'poolse-logo--mono' : null, className]
          .filter(Boolean)
          .join(' ') || undefined
      }
      {...aria}
      {...rest}
    >
      {v.render()}
    </svg>
  );
}
