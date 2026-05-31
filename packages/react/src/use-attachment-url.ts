import type { Uuid } from '@poolse/sdk';
import { useEffect, useState } from 'react';
import { usePoolse } from './provider.js';

interface UseAttachmentUrlState {
  /** Presigned GET URL, or null while loading / on error. */
  url: string | null;
  loading: boolean;
  error: Error | null;
}

/**
 * Resolve an attachment's presigned download URL. Pass `null` to
 * skip the fetch — useful in routing-driven views where the id may
 * not be known yet.
 *
 * Doesn't auto-refresh: the server's URL TTL is ~1 hour and most
 * UI lifetimes are much shorter. If you do need a refresh (long-lived
 * dashboard, etc.), remount the hook or wrap it in a parent that
 * re-keys on a timer.
 *
 * ```tsx
 * const { url } = useAttachmentUrl(message.custom_data?.attachment_id ?? null);
 * return url ? <img src={url} /> : <Spinner />;
 * ```
 */
export function useAttachmentUrl(attachmentId: Uuid | null): UseAttachmentUrlState {
  const chat = usePoolse();
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(attachmentId !== null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (attachmentId === null) {
      setUrl(null);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    chat.attachments
      .one(attachmentId)
      .downloadUrl({ signal: controller.signal })
      .then((res) => {
        if (cancelled) return;
        setUrl(res.url);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if ((err as DOMException)?.name === 'AbortError') return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [chat, attachmentId]);

  return { url, loading, error };
}
