// Keep the call while you work (CL11, web): float the call over other
// tabs and apps. Document Picture-in-Picture (Chrome, Edge) moves real
// React UI — video tiles and the controls — into a small always-on-top
// window; elsewhere (Safari, Firefox) the browser's video PiP shows one
// video element instead.
//
//     const pip = usePictureInPicture();
//     <button onClick={() => pip.open({ video: speakerVideoEl })}>Pop out</button>
//     <CallPictureInPicture pip={pip}>
//       <CallVideoGrid … /> <CallControls … />
//     </CallPictureInPicture>

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Which kind of picture-in-picture this browser offers. */
export type PictureInPictureKind = 'document' | 'video' | 'none';

interface DocumentPiP {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
  window: Window | null;
}

const documentPiP = (): DocumentPiP | null =>
  typeof window !== 'undefined'
    ? ((window as unknown as { documentPictureInPicture?: DocumentPiP }).documentPictureInPicture ??
      null)
    : null;

/** What this browser can do: `document` (any UI), `video` (one video element) or `none`. */
export function pictureInPictureSupport(): PictureInPictureKind {
  if (documentPiP()) return 'document';
  if (typeof document !== 'undefined' && document.pictureInPictureEnabled) return 'video';
  return 'none';
}

/** Copy the page's styles into the PiP window, so the UI there looks the same. */
function copyStyles(target: Window): void {
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const css = Array.from(sheet.cssRules)
        .map((r) => r.cssText)
        .join('\n');
      const style = target.document.createElement('style');
      style.textContent = css;
      target.document.head.appendChild(style);
    } catch {
      // A cross-origin sheet: link it instead of reading it.
      if (sheet.href) {
        const link = target.document.createElement('link');
        link.rel = 'stylesheet';
        link.href = sheet.href;
        target.document.head.appendChild(link);
      }
    }
  }
  // Theme attributes (data-theme, classes) travel with the root element.
  const root = document.documentElement;
  for (const attr of Array.from(root.attributes)) {
    if (attr.name === 'class' || attr.name.startsWith('data-')) {
      target.document.documentElement.setAttribute(attr.name, attr.value);
    }
  }
}

export interface UsePictureInPicture {
  kind: PictureInPictureKind;
  /** The call is floating. */
  active: boolean;
  /** The PiP window's body while Document PiP is open — portal target for `<CallPictureInPicture>`. */
  container: HTMLElement | null;
  /**
   * Float the call. Document PiP opens a window of `width` × `height`
   * (default 360 × 240); video PiP floats `video` (required there).
   * Must run from a click. Resolves false when nothing could be opened.
   */
  open: (opts?: {
    video?: HTMLVideoElement | null;
    width?: number;
    height?: number;
  }) => Promise<boolean>;
  close: () => void;
}

/** Picture-in-picture for a call screen. Closes itself on unmount. */
export function usePictureInPicture(): UsePictureInPicture {
  const [kind] = useState(pictureInPictureSupport);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [videoActive, setVideoActive] = useState(false);
  const win = useRef<Window | null>(null);

  const close = useCallback(() => {
    win.current?.close();
    win.current = null;
    setContainer(null);
    if (typeof document !== 'undefined' && document.pictureInPictureElement) {
      void document.exitPictureInPicture().catch(() => {});
    }
    setVideoActive(false);
  }, []);

  const open = useCallback<UsePictureInPicture['open']>(async (opts = {}) => {
    const dpip = documentPiP();
    if (dpip) {
      try {
        const w = await dpip.requestWindow({
          width: opts.width ?? 360,
          height: opts.height ?? 240,
        });
        copyStyles(w);
        w.document.body.classList.add('poolse-pip-body');
        w.addEventListener('pagehide', () => {
          win.current = null;
          setContainer(null);
        });
        win.current = w;
        setContainer(w.document.body);
        return true;
      } catch {
        // Refused (no user gesture): fall through to video PiP.
      }
    }
    const video = opts.video;
    if (video && typeof document !== 'undefined' && document.pictureInPictureEnabled) {
      try {
        await video.requestPictureInPicture();
        setVideoActive(true);
        video.addEventListener('leavepictureinpicture', () => setVideoActive(false), {
          once: true,
        });
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }, []);

  useEffect(() => close, [close]);

  return { kind, active: !!container || videoActive, container, open, close };
}

export interface CallPictureInPictureProps {
  pip: UsePictureInPicture;
  /** What floats: the tiles and controls. Rendered only while Document PiP is open. */
  children: ReactNode;
}

/** Renders `children` into the Document PiP window while it is open; nothing otherwise. */
export function CallPictureInPicture({ pip, children }: CallPictureInPictureProps) {
  if (!pip.container) return null;
  return createPortal(<div className="poolse-pip">{children}</div>, pip.container);
}
