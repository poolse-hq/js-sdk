import type { Attachment, AttachmentUploadInput } from '@poolse/sdk';
import { useCallback, useRef, useState } from 'react';
import { usePoolse } from './provider.js';

interface UseAttachmentUploadState {
  /** Last successfully uploaded attachment, or null. */
  attachment: Attachment | null;
  uploading: boolean;
  error: Error | null;
  /**
   * Run the upload pipeline (presigned-URL request + PUT). Updates
   * local state with the resolved attachment on success; sets `error`
   * and rethrows on failure so callers can surface a toast.
   */
  upload: (input: AttachmentUploadInput) => Promise<Attachment>;
  /** Reset state (clears `attachment`, `error`). */
  reset: () => void;
}

/**
 * Stateful wrapper around `chat.attachments.upload`. Provides
 * `uploading` + `error` flags for the common "show a spinner while
 * the PUT is in flight" UI, plus retention of the last attachment
 * so the caller can reference its id when sending a message.
 *
 * ```tsx
 * const { upload, uploading, attachment } = useAttachmentUpload();
 * const onPick = async (file: File) => {
 *   const att = await upload({
 *     body: file, contentType: file.type, byteSize: file.size, filename: file.name
 *   });
 *   await chat.conversations.one(convId).messages.send({
 *     body: 'attached',
 *     custom_data: { attachment_id: att.id },
 *   });
 * };
 * ```
 */
export function useAttachmentUpload(): UseAttachmentUploadState {
  const chat = usePoolse();
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  // Track an in-flight upload's AbortController so unmount cancels it.
  const inFlightRef = useRef<AbortController | null>(null);

  const upload = useCallback(
    async (input: AttachmentUploadInput): Promise<Attachment> => {
      // Cancel any prior in-flight upload — last-write-wins on intent.
      inFlightRef.current?.abort();
      const controller = new AbortController();
      inFlightRef.current = controller;

      setUploading(true);
      setError(null);
      try {
        const att = await chat.attachments.upload(input, { signal: controller.signal });
        if (inFlightRef.current === controller) {
          setAttachment(att);
        }
        return att;
      } catch (err) {
        if ((err as DOMException)?.name === 'AbortError') throw err;
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        throw e;
      } finally {
        if (inFlightRef.current === controller) {
          setUploading(false);
          inFlightRef.current = null;
        }
      }
    },
    [chat],
  );

  const reset = useCallback(() => {
    inFlightRef.current?.abort();
    inFlightRef.current = null;
    setAttachment(null);
    setError(null);
    setUploading(false);
  }, []);

  return { attachment, uploading, error, upload, reset };
}
