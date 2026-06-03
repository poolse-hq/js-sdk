// Mirror of @poolse/react-ui's userColor — deterministic per-user
// color from the same 8-hue palette.

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

export function userColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(h) % PALETTE.length]!;
}
