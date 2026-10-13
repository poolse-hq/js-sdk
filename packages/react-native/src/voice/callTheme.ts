/**
 * The call surface's own palette.
 *
 * Deliberately NOT the app theme. Every serious calling app — phone,
 * FaceTime, WhatsApp, Meet — renders calls dark regardless of the rest
 * of the UI, for three reasons that all apply here:
 *
 *   * video is the content, and a light chrome around it washes the
 *     picture out,
 *   * a call screen is the one surface that routinely opens at 3am,
 *   * it takes over the whole screen, so it reads as a mode change
 *     rather than as a screen that has lost the app's styling.
 *
 * The brand still shows up — in the accept button and the speaking
 * ring — it just doesn't set the background.
 */
export const callColors = {
  /** Behind everything. Near-black, cooled toward the brand. */
  bg: '#0B0B14',
  /** The brand glow rising behind the identity block. */
  glow: '#5B54E8',
  /** The faint counter-glow low in the frame, for depth. */
  glowWarm: '#B16CEA',
  /** The floating control dock and the status pill. */
  glass: 'rgba(255,255,255,0.08)',
  glassBorder: 'rgba(255,255,255,0.12)',
  /** Behind a participant tile with no video. */
  tile: '#1c1c20',
  /** Scrim under the top/bottom chrome so text stays legible over video. */
  scrim: 'rgba(0,0,0,0.45)',

  text: '#ffffff',
  textDim: 'rgba(255,255,255,0.72)',
  textFaint: 'rgba(255,255,255,0.5)',

  /** A control that is off / inactive — translucent over whatever is behind. */
  control: 'rgba(255,255,255,0.16)',
  /**
   * A control that is ENGAGED (muted, speaker on, camera off).
   *
   * Inverted rather than tinted: at a glance the user needs to see
   * *which* controls are doing something, and a solid white circle is
   * unmistakable against five translucent ones in a dim room.
   */
  controlActive: '#ffffff',
  controlActiveIcon: '#101012',

  danger: '#ef4444',
  accept: '#22c55e',
  onAction: '#ffffff',
} as const;

/** Control button diameters. Hang-up is bigger; it is the one you reach for. */
export const CONTROL_SIZE = 58;
export const CONTROL_SIZE_LARGE = 68;
