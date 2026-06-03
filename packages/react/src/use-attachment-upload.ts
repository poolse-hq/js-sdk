import type { Attachment, AttachmentUploadInput } from '@poolse/sdk';
import { safeUuid } from '@poolse/sdk';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePoolse } from './provider.js';

export type UploadItemStatus = 'pending' | 'uploading' | 'ready' | 'error' | 'cancelled';

export interface UploadItem {
  /** Local-only id (random per-enqueue). Stable for keys + `cancel(localId)` / `remove(localId)`. */
  localId: string;
  filename: string;
  contentType: string;
  byteSize: number;
  status: UploadItemStatus;
  /** Bytes uploaded so far; 0 until the PUT actually begins. */
  loaded: number;
  /** Resolved attachment row once `status === 'ready'`. Null otherwise. */
  attachment: Attachment | null;
  /** Set when `status === 'error'`. */
  error: Error | null;
}

interface UseAttachmentUploadState {
  /** Every enqueued item, in enqueue order, until removed by `remove()` / `reset()`. */
  queue: UploadItem[];
  /**
   * Last attachment that reached `ready`, for the common one-file
   * "did the upload finish" check. Null after `reset()` / `remove()`
   * of the most recent ready item. Multi-file callers should iterate
   * `queue` instead.
   */
  attachment: Attachment | null;
  /** True while at least one item is `pending` or `uploading`. */
  uploading: boolean;
  /** Most recent item-level error, or null. */
  error: Error | null;
  /**
   * Enqueue a single upload. Resolves with the final attachment row.
   * Rejects with the underlying error (item's `status` becomes
   * `'error'`); aborts surface as a DOMException('AbortError') and the
   * item's status becomes `'cancelled'`.
   */
  upload: (input: AttachmentUploadInput) => Promise<Attachment>;
  /**
   * Enqueue many at once — drag-and-drop, multi-file picker. Items run
   * in parallel (the SDK is per-call independent). Resolves with the
   * attachments in the same order as the input; if any item fails the
   * whole promise rejects after the others settle.
   */
  uploadAll: (inputs: AttachmentUploadInput[]) => Promise<Attachment[]>;
  /** Abort an in-flight upload. Sets the item's status to `cancelled`. No-op if not in flight. */
  cancel: (localId: string) => void;
  /** Drop an item from the queue. Cancels first if it's still in flight. */
  remove: (localId: string) => void;
  /** Drop everything + abort any in-flight uploads. */
  reset: () => void;
}

interface InFlight {
  controller: AbortController;
}

/**
 * Stateful wrapper around `chat.attachments.upload`. Exposes a queue
 * of in-flight / completed uploads with per-item progress + per-item
 * cancel — drag-and-drop, multi-file picker, retry chips, all without
 * the host app reimplementing AbortController plumbing.
 *
 * ```tsx
 * const { upload, queue, cancel, remove } = useAttachmentUpload();
 * const onPick = async (files: File[]) => {
 *   const atts = await uploadAll(files.map(f => ({
 *     body: f, contentType: f.type, byteSize: f.size, filename: f.name
 *   })));
 *   await chat.conversations.one(convId).messages.send({
 *     body: '', attachment_ids: atts.map(a => a.id),
 *   });
 * };
 * ```
 *
 * The legacy `upload(input)` → `Promise<Attachment>` shape is preserved
 * so older callers keep working — they just won't render the queue UI.
 */
export function useAttachmentUpload(): UseAttachmentUploadState {
  const chat = usePoolse();
  const [queue, setQueue] = useState<UploadItem[]>([]);
  const inFlightRef = useRef<Map<string, InFlight>>(new Map());
  // Track mount status so async resolves don't setState on unmounted
  // components. Strict-mode double-effects re-arm this on remount.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      for (const v of inFlightRef.current.values()) v.controller.abort();
      inFlightRef.current.clear();
    };
  }, []);

  const updateItem = useCallback((localId: string, patch: Partial<UploadItem>) => {
    if (!mountedRef.current) return;
    setQueue((q) => q.map((it) => (it.localId === localId ? { ...it, ...patch } : it)));
  }, []);

  const runUpload = useCallback(
    async (localId: string, input: AttachmentUploadInput): Promise<Attachment> => {
      const controller = new AbortController();
      inFlightRef.current.set(localId, { controller });
      updateItem(localId, { status: 'uploading', loaded: 0 });
      try {
        const att = await chat.attachments.upload(input, {
          signal: controller.signal,
          onProgress: (e) => updateItem(localId, { loaded: e.loaded }),
        });
        updateItem(localId, {
          status: 'ready',
          loaded: input.byteSize,
          attachment: att,
          error: null,
        });
        return att;
      } catch (err) {
        if ((err as DOMException)?.name === 'AbortError') {
          updateItem(localId, { status: 'cancelled' });
          throw err;
        }
        const e = err instanceof Error ? err : new Error(String(err));
        updateItem(localId, { status: 'error', error: e });
        throw e;
      } finally {
        inFlightRef.current.delete(localId);
      }
    },
    [chat, updateItem],
  );

  const enqueue = useCallback((input: AttachmentUploadInput): UploadItem => {
    const localId = generateLocalId();
    const item: UploadItem = {
      localId,
      filename: input.filename ?? 'file',
      contentType: input.contentType,
      byteSize: input.byteSize,
      status: 'pending',
      loaded: 0,
      attachment: null,
      error: null,
    };
    setQueue((q) => [...q, item]);
    return item;
  }, []);

  const upload = useCallback(
    (input: AttachmentUploadInput): Promise<Attachment> => {
      const item = enqueue(input);
      return runUpload(item.localId, input);
    },
    [enqueue, runUpload],
  );

  const uploadAll = useCallback(
    (inputs: AttachmentUploadInput[]): Promise<Attachment[]> => {
      // Enqueue all first so the UI shows the full queue immediately,
      // then start the PUTs in parallel. Order in resolved array
      // matches input order regardless of which PUT finishes first.
      const items = inputs.map((inp) => ({ item: enqueue(inp), input: inp }));
      return Promise.all(items.map(({ item, input }) => runUpload(item.localId, input)));
    },
    [enqueue, runUpload],
  );

  const cancel = useCallback((localId: string) => {
    const inf = inFlightRef.current.get(localId);
    if (inf) inf.controller.abort();
  }, []);

  const remove = useCallback((localId: string) => {
    const inf = inFlightRef.current.get(localId);
    if (inf) inf.controller.abort();
    setQueue((q) => q.filter((it) => it.localId !== localId));
  }, []);

  const reset = useCallback(() => {
    for (const v of inFlightRef.current.values()) v.controller.abort();
    inFlightRef.current.clear();
    setQueue([]);
  }, []);

  const uploading = queue.some((it) => it.status === 'pending' || it.status === 'uploading');
  // Last error in queue order — pendings/readies have null, so the
  // most recently transitioned-to-error item wins.
  const error = queue.reduce<Error | null>((acc, it) => it.error ?? acc, null);
  // Last ready attachment — same convenience.
  const attachment = queue.reduce<Attachment | null>((acc, it) => it.attachment ?? acc, null);

  return { queue, attachment, uploading, error, upload, uploadAll, cancel, remove, reset };
}

function generateLocalId(): string {
  return safeUuid();
}
