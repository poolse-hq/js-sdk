// Deterministic per-user color for the group-chat sender label.
//
// Same id always maps to the same color — no random rotation
// between sessions. The palette intentionally skips Pulse Coral
// (that's reserved for self-side bubbles), and the eight hues are
// picked for legibility on both the light surface bubble and the
// dark theme. Borrowed from the Tailwind 500-shade swatches, which
// have decent WCAG contrast against `--poolse-surface`.

const PALETTE = [
  '#6366f1', // indigo
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ec4899', // rose
  '#0ea5e9', // sky
  '#8b5cf6', // violet
  '#14b8a6', // teal
  '#d946ef', // fuchsia
];

/**
 * Hash a user_id (or any opaque string) to a color from the palette.
 * Stable across sessions — the same input always returns the same
 * color, so a user keeps their identity tint as they post over time.
 */
export function userColor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) {
    // djb2-ish, kept as |0 so the running value stays int32.
    h = (h * 31 + userId.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(h) % PALETTE.length]!;
}
