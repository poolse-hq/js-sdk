import { Svg, Path, Circle, G } from 'react-native-svg';

import { usePoolseTheme } from '../theme/PoolseTheme.js';

export type PoolseLogoVariant = 'lockup' | 'mark' | 'wordmark' | 'mono';

export interface PoolseLogoProps {
  variant?: PoolseLogoVariant;
  /** Height in pixels — width is computed from the variant's aspect ratio. */
  size?: number;
  /** Mono variant accepts a color override; otherwise the theme drives fills. */
  color?: string;
  label?: string | null;
}

const TILE_PATH = 'M50 4 C20 4 4 20 4 50 C4 80 20 96 50 96 C80 96 96 80 96 50 C96 20 80 4 50 4 Z';
const PULSE_PATH = 'M16 55 H34 L40 55 L47 30 L54 73 L60 55 H72';
const WORDMARK_P_PATH =
  'M62 -169V258V528H194L196 378L214 376Q223 432 246.0 469.0Q269 506 305.5 524.0Q342 542 389 542Q459 542 509.5 508.0Q560 474 587.0 411.0Q614 348 614 260Q614 182 590.5 120.0Q567 58 519.5 22.0Q472 -14 399 -14Q350 -14 316.0 3.5Q282 21 258.5 55.0Q235 89 219 140H200Q206 113 211.0 85.0Q216 57 219.5 31.0Q223 5 223 -19V-169ZM340 113Q373 113 396.5 131.0Q420 149 433.0 182.0Q446 215 446 259Q446 306 432.5 339.5Q419 373 394.0 391.5Q369 410 336 410Q305 410 283.5 396.5Q262 383 248.5 361.5Q235 340 229.0 316.0Q223 292 223 271V249Q223 230 228.0 211.0Q233 192 243.0 174.5Q253 157 267.0 143.0Q281 129 299.5 121.0Q318 113 340 113Z';
const WORDMARK_O_PATH =
  'M305 -14Q225 -14 163.5 17.0Q102 48 67.0 110.0Q32 172 32 265Q32 358 67.0 419.5Q102 481 164.0 511.5Q226 542 306 542Q386 542 448.0 511.0Q510 480 545.0 418.5Q580 357 580 264Q580 169 544.0 107.0Q508 45 445.5 15.5Q383 -14 305 -14ZM310 103Q346 103 370.0 119.5Q394 136 406.0 170.0Q418 204 418 254Q418 307 405.0 343.5Q392 380 366.5 399.5Q341 419 301 419Q267 419 242.5 402.5Q218 386 206.0 352.0Q194 318 194 267Q194 185 224.5 144.0Q255 103 310 103Z';
const WORDMARK_L_PATH = 'M62 0V720H220V0Z';
const WORDMARK_S_PATH =
  'M278 -14Q225 -14 182.0 -4.5Q139 5 107.0 23.0Q75 41 54.5 66.5Q34 92 26 123L146 176Q153 159 170.5 141.5Q188 124 217.5 113.0Q247 102 289 102Q329 102 351.5 113.5Q374 125 374 147Q374 163 361.5 172.5Q349 182 324.0 189.5Q299 197 262 204Q224 212 185.0 222.5Q146 233 112.0 251.5Q78 270 57.5 300.5Q37 331 37 378Q37 427 63.0 463.5Q89 500 140.5 521.0Q192 542 266 542Q332 542 382.0 525.0Q432 508 465.5 476.5Q499 445 512 401L383 355Q378 377 362.5 393.0Q347 409 323.5 417.5Q300 426 268 426Q229 426 207.5 414.0Q186 402 186 382Q186 366 200.5 355.5Q215 345 242.0 338.0Q269 331 306 323Q345 315 383.5 304.5Q422 294 453.5 276.5Q485 259 503.5 230.5Q522 202 522 157Q522 104 494.0 65.5Q466 27 411.5 6.5Q357 -14 278 -14Z';
const WORDMARK_E_PATH =
  'M313 -14Q247 -14 195.0 3.5Q143 21 106.5 55.0Q70 89 51.0 139.0Q32 189 32 254Q32 317 50.5 370.0Q69 423 103.5 461.5Q138 500 188.5 521.0Q239 542 302 542Q366 542 414.5 521.5Q463 501 494.5 461.0Q526 421 541.0 363.5Q556 306 551 232L138 229V313L459 316L402 277Q409 327 396.0 358.5Q383 390 358.0 404.5Q333 419 304 419Q269 419 242.5 400.0Q216 381 201.0 345.0Q186 309 186 257Q186 175 221.5 138.0Q257 101 312 101Q339 101 357.0 108.5Q375 116 386.5 127.5Q398 139 404.5 153.0Q411 167 415 180L555 150Q547 113 529.5 83.0Q512 53 482.5 31.0Q453 9 411.5 -2.5Q370 -14 313 -14Z';

const VARIANT_VB: Record<
  PoolseLogoVariant,
  { vb: [number, number, number, number]; aspect: number }
> = {
  lockup: { vb: [0, 0, 454, 100], aspect: 4.54 },
  mark: { vb: [0, 0, 100, 100], aspect: 1 },
  wordmark: { vb: [0, 0, 350, 100], aspect: 3.5 },
  mono: { vb: [0, 0, 454, 100], aspect: 4.54 },
};

export function PoolseLogo({ variant = 'lockup', size = 28, color, label }: PoolseLogoProps) {
  const theme = usePoolseTheme();
  const mono = variant === 'mono';
  const monoColor = color ?? theme.colors.ink;

  const tileFill = mono ? 'none' : theme.colors.brand;
  const tileStroke = mono ? monoColor : 'transparent';
  const tileStrokeWidth = mono ? 5 : 0;
  const pulseStroke = mono ? monoColor : theme.colors.onBrand;
  const pulseDotFill = mono ? monoColor : theme.colors.onBrand;
  const inkFill = mono ? monoColor : theme.colors.ink;
  const oFill = mono ? monoColor : theme.colors.brand;

  const { vb, aspect } = VARIANT_VB[variant];
  const width = size * aspect;
  const showMark = variant === 'lockup' || variant === 'mark' || variant === 'mono';
  const showWordmark = variant === 'lockup' || variant === 'wordmark' || variant === 'mono';
  const wordmarkOffsetX = variant === 'wordmark' ? 0 : 126;

  const a11y = label === null ? {} : { accessibilityLabel: label ?? 'poolse' };
  return (
    <Svg viewBox={vb.join(' ')} width={width} height={size} {...a11y}>
      {showMark ? (
        <>
          <Path d={TILE_PATH} fill={tileFill} stroke={tileStroke} strokeWidth={tileStrokeWidth} />
          <Path
            d={PULSE_PATH}
            fill="none"
            stroke={pulseStroke}
            strokeWidth={9}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Circle cx={72} cy={55} r={6.2} fill={pulseDotFill} />
        </>
      ) : null}
      {showWordmark ? (
        <G transform={`translate(${wordmarkOffsetX},85.0) scale(0.097222 -0.097222)`}>
          <Path d={WORDMARK_P_PATH} fill={inkFill} transform="translate(0,0)" />
          <Path d={WORDMARK_O_PATH} fill={oFill} transform="translate(658,0)" />
          <Path d={WORDMARK_O_PATH} fill={oFill} transform="translate(1280,0)" />
          <Path d={WORDMARK_L_PATH} fill={inkFill} transform="translate(1902,0)" />
          <Path d={WORDMARK_S_PATH} fill={inkFill} transform="translate(2195,0)" />
          <Path d={WORDMARK_E_PATH} fill={inkFill} transform="translate(2754,0)" />
        </G>
      ) : null}
    </Svg>
  );
}
