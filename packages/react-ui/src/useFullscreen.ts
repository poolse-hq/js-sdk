import { useCallback, useEffect, useState, type RefObject } from 'react';

/**
 * Full screen for one element, the way a call app does it: the page's
 * own element fills the monitor, with the call's controls still on it.
 *
 * Safari before 16.4 only has the `webkit` prefix. iPhone Safari has no
 * element full screen at all, only a `<video>`'s native player; pass
 * that video as `fallbackVideo` and it is used there, without the
 * call's controls (a phone has the call controls one swipe away).
 * `supported` is false when neither works, so the button can be hidden.
 */

interface WebkitDocument {
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
  webkitExitFullscreen?: () => void;
}
interface WebkitElement {
  webkitRequestFullscreen?: () => void;
}
interface WebkitVideo {
  webkitEnterFullscreen?: () => void;
  webkitSupportsFullscreen?: boolean;
}

function fullscreenElement(): Element | null {
  return document.fullscreenElement ?? (document as WebkitDocument).webkitFullscreenElement ?? null;
}

function elementFullscreenEnabled(): boolean {
  if (typeof document === 'undefined') return false;
  return Boolean(
    document.fullscreenEnabled || (document as WebkitDocument).webkitFullscreenEnabled,
  );
}

/** The browser has the element full-screen API at all (enabled or not). */
function elementFullscreenApi(): boolean {
  if (typeof document === 'undefined') return false;
  return 'fullscreenEnabled' in document || 'webkitFullscreenEnabled' in document;
}

/**
 * Whether `video`'s native player can take the screen: only where the
 * element API is missing altogether (iPhone). Where it exists but is
 * disabled (an iframe without `allowfullscreen`, a browser setting), the
 * page is not allowed full screen and the video can't do it either.
 */
function videoFallbackWorks(video: HTMLVideoElement | null | undefined): boolean {
  if (!video || elementFullscreenApi()) return false;
  return typeof (video as WebkitVideo).webkitEnterFullscreen === 'function';
}

export function useFullscreen(
  target: RefObject<HTMLElement | null>,
  fallbackVideo?: RefObject<HTMLVideoElement | null>,
): { active: boolean; supported: boolean; toggle: () => void } {
  const [active, setActive] = useState(false);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    setSupported(elementFullscreenEnabled() || videoFallbackWorks(fallbackVideo?.current));
    const sync = () => setActive(target.current != null && fullscreenElement() === target.current);
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
    };
  }, [target, fallbackVideo]);

  const toggle = useCallback(() => {
    const el = target.current;
    if (!el) return;
    if (fullscreenElement() === el) {
      if (document.exitFullscreen) void document.exitFullscreen().catch(() => {});
      else (document as WebkitDocument).webkitExitFullscreen?.();
      return;
    }
    if (elementFullscreenEnabled()) {
      if (el.requestFullscreen) void el.requestFullscreen().catch(() => {});
      else (el as WebkitElement).webkitRequestFullscreen?.();
      return;
    }
    (fallbackVideo?.current as WebkitVideo | null | undefined)?.webkitEnterFullscreen?.();
  }, [target, fallbackVideo]);

  return { active, supported, toggle };
}
