import { createContext, useCallback, useContext, useRef, type ReactNode } from 'react';
import { useAttachmentUpload } from '@poolse/react';

type UploadState = ReturnType<typeof useAttachmentUpload>;

/**
 * Shared upload-queue value. The SDK's `useAttachmentUpload` creates
 * a private queue per call site — without a provider, each component
 * (picker / composer / strip) ends up with its own queue and uploads
 * never reach the send-with-attachment_ids path.
 *
 * `setPreview` / `getPreview` are an RN-only side channel: the SDK
 * strips the original local file URI when it converts to a Blob, but
 * the queue strip needs the URI to render an Image thumbnail. The
 * picker stashes it here keyed by filename so the strip can read it
 * back during render.
 */
interface UploadContextValue {
  upload: UploadState;
  setPreview: (filename: string, uri: string) => void;
  getPreview: (filename: string) => string | null;
}

const UploadCtx = createContext<UploadContextValue | null>(null);

export function UploadProvider({ children }: { children: ReactNode }) {
  const upload = useAttachmentUpload();
  const previews = useRef<Map<string, string>>(new Map());

  const setPreview = useCallback((filename: string, uri: string) => {
    previews.current.set(filename, uri);
  }, []);

  const getPreview = useCallback((filename: string) => {
    return previews.current.get(filename) ?? null;
  }, []);

  return (
    <UploadCtx.Provider value={{ upload, setPreview, getPreview }}>{children}</UploadCtx.Provider>
  );
}

/**
 * Read the shared upload state. Falls back to a component-local
 * `useAttachmentUpload` when no provider is mounted so the component
 * still functions standalone (but loses preview thumbnails since
 * setPreview won't propagate).
 */
export function useSharedUpload(): UploadState {
  const fromCtx = useContext(UploadCtx);
  const fallback = useAttachmentUpload();
  return fromCtx?.upload ?? fallback;
}

/**
 * Preview-URI side channel for the queue strip's thumbnails. No-op
 * when no provider is mounted (strip falls back to icon placeholder).
 */
export function useUploadPreview() {
  const ctx = useContext(UploadCtx);
  return {
    setPreview: ctx?.setPreview ?? (() => undefined),
    getPreview: ctx?.getPreview ?? (() => null),
  };
}
