// Auto-load the brand typography (Bricolage Grotesque, Hanken Grotesk,
// JetBrains Mono — all SIL OFL, free on Google Fonts).
//
// Two ways to consume:
//
//   1. Mount <PoolseFonts /> once near the top of your tree (zero
//      props). Idempotent — adding it multiple times produces only
//      one <link> in <head>.
//
//   2. Call `usePoolseFonts()` from a custom component (we use this
//      from <ConversationView> so the brand fonts come for free
//      when a customer uses the prebuilt chat UI). Pass
//      `usePoolseFonts(false)` to opt out.
//
// Customers with strict CSP / self-hosting requirements should NOT
// mount this component and should serve the fonts themselves via
// their own <head>; the rest of the UI gracefully falls back to
// the `var(--poolse-font-body)` value (system-ui).

import { useEffect } from 'react';

const FONT_HREF =
  'https://fonts.googleapis.com/css2?' +
  'family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,800' +
  '&family=Hanken+Grotesk:wght@400;500;600;700' +
  '&family=JetBrains+Mono:wght@400;500' +
  '&display=swap';

const FONT_HREF_PRECONNECT_GOOGLE = 'https://fonts.googleapis.com';
const FONT_HREF_PRECONNECT_STATIC = 'https://fonts.gstatic.com';

// Marker so we never inject the same <link> twice across hot reloads
// or multiple mount points. Idempotent by design.
const MARKER_ATTR = 'data-poolse-fonts';

/** Inject the Google Fonts <link> + preconnect hints into <head> once. */
function injectFontLinks(): void {
  if (typeof document === 'undefined') return;
  if (document.querySelector(`link[${MARKER_ATTR}]`)) return;

  const head = document.head;

  const pre1 = document.createElement('link');
  pre1.rel = 'preconnect';
  pre1.href = FONT_HREF_PRECONNECT_GOOGLE;
  pre1.setAttribute(MARKER_ATTR, 'preconnect');
  head.appendChild(pre1);

  const pre2 = document.createElement('link');
  pre2.rel = 'preconnect';
  pre2.href = FONT_HREF_PRECONNECT_STATIC;
  pre2.crossOrigin = 'anonymous';
  pre2.setAttribute(MARKER_ATTR, 'preconnect');
  head.appendChild(pre2);

  const font = document.createElement('link');
  font.rel = 'stylesheet';
  font.href = FONT_HREF;
  font.setAttribute(MARKER_ATTR, 'stylesheet');
  head.appendChild(font);
}

/**
 * Inject the brand fonts on mount. Pass `false` to opt out (e.g. when
 * the host app already loads them, or to honor a strict CSP that
 * forbids dynamic <link> injection).
 */
export function usePoolseFonts(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    injectFontLinks();
  }, [enabled]);
}

/**
 * Mount once to opt INTO the brand fonts. Renders nothing — purely a
 * side-effect component for tree-level activation.
 */
export function PoolseFonts(): null {
  usePoolseFonts(true);
  return null;
}
