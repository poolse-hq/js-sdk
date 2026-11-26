import type { Uuid } from '@poolse/sdk';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePoolse } from './provider.js';

interface UseAttachmentUrlState {
  /** Presigned GET URL, or null while loading / on error. */
  url: string | null;
  loading: boolean;
  error: Error | null;
  /**
   * Fetch a fresh URL now — e.g. when an `<img>` / `<video>` using it
   * fails to load. The current URL stays until the new one arrives.
   * Ignored within a few seconds of the last fetch, so an `onError`
   * on a file that is really gone can't loop.
   */
  refresh: () => void;
}

/**
 * How long a presigned URL is used before it's fetched again. The
 * server signs them for an hour; a view left open longer (a desktop
 * chat) gets a fresh one before the old one stops working.
 */
export const ATTACHMENT_URL_REFRESH_MS = 50 * 60 * 1000;
const REFRESH_MIN_GAP_MS = 5000;

/**
 * Resolve an attachment's presigned download URL. Pass `null` to
 * skip the fetch — useful in routing-driven views where the id may
 * not be known yet.
 *
 * The URL is fetched again before it expires (every
 * {@link ATTACHMENT_URL_REFRESH_MS}) and on `refresh()`. When the id
 * changes, `url` is null until the new attachment's URL arrives — it
 * never shows the previous attachment.
 *
 * ```tsx
 * const { url, refresh } = useAttachmentUrl(message.attachments?.[0]?.id ?? null);
 * return url ? <img src={url} onError={refresh} /> : <Spinner />;
 * ```
 */
export function useAttachmentUrl(attachmentId: Uuid | null): UseAttachmentUrlState {
  const chat = usePoolse();
  // Tagged with the id it belongs to, so a new id never reads the old URL.
  const [state, setState] = useState<{
    id: Uuid | null;
    url: string | null;
    loading: boolean;
    error: Error | null;
  }>({ id: attachmentId, url: null, loading: attachmentId !== null, error: null });
  const [generation, setGeneration] = useState(0);
  const fetchedAt = useRef(0);
  const refresh = useCallback(() => {
    if (Date.now() - fetchedAt.current < REFRESH_MIN_GAP_MS) return;
    setGeneration((g) => g + 1);
  }, []);

  useEffect(() => {
    if (attachmentId === null) {
      setState({ id: null, url: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    // A refresh of the same attachment keeps showing the current URL.
    setState((s) =>
      s.id === attachmentId
        ? { ...s, loading: s.url === null, error: null }
        : { id: attachmentId, url: null, loading: true, error: null },
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    fetchedAt.current = Date.now();
    chat.attachments
      .one(attachmentId)
      .downloadUrl({ signal: controller.signal })
      .then((res) => {
        if (cancelled) return;
        setState({ id: attachmentId, url: res.url, loading: false, error: null });
        timer = setTimeout(() => setGeneration((g) => g + 1), ATTACHMENT_URL_REFRESH_MS);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if ((err as { name?: unknown } | null)?.name === 'AbortError') return;
        setState((s) => ({
          id: attachmentId,
          // A failed refresh keeps the URL it had; a first fetch has none.
          url: s.id === attachmentId ? s.url : null,
          loading: false,
          error: err instanceof Error ? err : new Error(String(err)),
        }));
      });
    return () => {
      cancelled = true;
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [chat, attachmentId, generation]);

  if (state.id !== attachmentId) {
    return { url: null, loading: attachmentId !== null, error: null, refresh };
  }
  return { url: state.url, loading: state.loading, error: state.error, refresh };
}
