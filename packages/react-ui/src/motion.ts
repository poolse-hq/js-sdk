/** Whether the user asked for reduced motion (no smooth scrolling, no animation). */
export function prefersReducedMotion(): boolean {
  try {
    return (
      typeof globalThis.matchMedia === 'function' &&
      globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  } catch {
    return false;
  }
}
