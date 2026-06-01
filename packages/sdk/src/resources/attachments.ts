// Attachment uploads use a presigned-URL flow:
//
//   1. POST /v1/attachments/upload-url  → server returns a presigned
//      PUT URL + the headers the storage backend will require, plus a
//      `:pending` attachment row that the user can reference when
//      sending a message.
//   2. The client PUTs the bytes directly to the storage backend
//      (Cloudflare R2 / S3). The bytes never touch poolse's API
//      server — this is fast AND keeps large blobs off the app tier.
//   3. The PUT response Status 2xx flips the attachment row from
//      `:pending` to `:ready` (via a webhook the server subscribes
//      to, OR opportunistically on first download — implementation
//      detail).
//   4. The client now sends a message referencing the attachment id.
//
// This module exposes that flow at two levels:
//   * `requestUpload(attrs)` — low-level, returns the presigned URL.
//     Use when you want full control of the PUT (custom progress,
//     resumable uploads, chunked transfers, RN's FileSystem API).
//   * `upload(input)` — high-level convenience that does step 1 + the
//     PUT in one call, returning the (now-ready) attachment row.
//     Works with browser File/Blob and any BodyInit-compatible value.

import type { RestClient } from '../rest-client.js';
import type {
  Attachment,
  AttachmentDownloadResponse,
  AttachmentUploadRequest,
  AttachmentUploadResponse,
  Uuid,
} from '../types.js';

/** Input accepted by {@link AttachmentsResource.upload}. */
export interface AttachmentUploadInput {
  /**
   * The bytes to upload. Browser: pass a `File` or `Blob`. Node /
   * Workers / Deno: a `Uint8Array`, `ArrayBuffer`, or any
   * `BodyInit`-compatible value the runtime's `fetch` accepts as a
   * PUT body.
   */
  body: BodyInit;
  /**
   * MIME type. MUST match what you pass as `content_type` on the
   * upload-URL request (the storage backend signs it into the URL —
   * a mismatch makes the PUT fail with 403).
   */
  contentType: string;
  /** Total bytes — must match the bytes you actually PUT. */
  byteSize: number;
  /** Surfaced in download UX so saved files keep a sensible name. */
  filename?: string;
}

/** Options accepted by every attachment method. */
export interface AttachmentOptions {
  signal?: AbortSignal;
  /**
   * Progress callback for `upload()`. Called periodically during the
   * PUT phase (NOT during the presigned-URL request — that's a small
   * JSON round-trip). When set, the SDK switches to XHR for the PUT
   * since the standard `fetch` doesn't expose upload progress events.
   *
   * Customers using a custom `config.fetch` (e.g. node-fetch polyfill)
   * lose progress reporting and the callback never fires — XHR is
   * a browser-only API.
   */
  onProgress?: (event: AttachmentProgressEvent) => void;
}

export interface AttachmentProgressEvent {
  /** Bytes uploaded so far. */
  loaded: number;
  /** Total bytes — equals `input.byteSize` (passed back for convenience). */
  total: number;
}

/** Top-level `/v1/attachments` collection. */
export class AttachmentsResource {
  /**
   * The PUT to the presigned URL bypasses the SDK's authenticated
   * REST client (presigned URLs encode their own auth and MUST NOT
   * receive an `Authorization` header). It still respects
   * `config.fetch` if the customer provided one — required for tests
   * with a mock fetch, and for runtimes where `globalThis.fetch` is
   * not the right transport.
   */
  constructor(
    private readonly client: RestClient,
    private readonly fetchFn: typeof globalThis.fetch,
  ) {}

  /**
   * Step 1 of an upload — request a presigned PUT URL. Use this when
   * you want to drive the PUT yourself (e.g. resumable uploads,
   * React Native FileSystem). For the common case prefer
   * {@link upload}, which does both steps for you.
   */
  requestUpload(
    attrs: AttachmentUploadRequest,
    opts: AttachmentOptions = {},
  ): Promise<AttachmentUploadResponse> {
    return this.client.request<AttachmentUploadResponse>({
      method: 'POST',
      path: '/v1/attachments/upload-url',
      body: attrs,
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  }

  /**
   * One-call upload: request a presigned URL, PUT the bytes to it,
   * return the attachment row. After this resolves the attachment is
   * ready to be referenced from a message send.
   *
   * ```ts
   * // Browser <input type="file">:
   * const file = inputEl.files![0]!;
   * const att = await chat.attachments.upload({
   *   body: file,
   *   contentType: file.type,
   *   byteSize: file.size,
   *   filename: file.name,
   * });
   * await chat.conversations.one(convId).messages.send({
   *   body: 'Look at this!',
   *   custom_data: { attachment_id: att.id },
   * });
   * ```
   *
   * Note: the PUT uses the runtime's bare `fetch` (NOT the SDK's
   * authenticated REST client) — presigned URLs already encode their
   * own auth and MUST NOT receive an `Authorization` header.
   */
  async upload(input: AttachmentUploadInput, opts: AttachmentOptions = {}): Promise<Attachment> {
    const req: AttachmentUploadRequest = {
      content_type: input.contentType,
      byte_size: input.byteSize,
      ...(input.filename !== undefined ? { original_filename: input.filename } : {}),
    };

    const { attachment, upload } = await this.requestUpload(req, opts);

    // Progress reporting requires XHR — `fetch` doesn't expose upload
    // events. Drop to XHR only when the caller actually wants progress;
    // otherwise stick with `fetch` (handles streams + Node polyfills
    // that XHR doesn't).
    if (opts.onProgress && typeof XMLHttpRequest !== 'undefined') {
      await xhrPut(upload.url, upload.method.toUpperCase(), upload.headers, input.body, {
        byteSize: input.byteSize,
        onProgress: opts.onProgress,
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      return attachment;
    }

    const putInit: RequestInit = {
      method: upload.method.toUpperCase(),
      headers: upload.headers,
      body: input.body,
      ...(opts.signal ? { signal: opts.signal } : {}),
    };

    const res = await this.fetchFn(upload.url, putInit);
    if (!res.ok) {
      throw new Error(
        `Poolse: presigned upload PUT failed (${res.status}) for attachment ${attachment.id}`,
      );
    }
    return attachment;
  }

  /** Returns a handle for further operations on a single attachment. */
  one(id: Uuid): AttachmentHandle {
    return new AttachmentHandle(this.client, id);
  }
}

/** Wraps an attachment id for download-url + delete. */
export class AttachmentHandle {
  constructor(
    private readonly client: RestClient,
    public readonly id: Uuid,
  ) {}

  /**
   * Request a presigned GET URL (~1h TTL). Conversation-member-gated
   * server-side. Useful when rendering files in chat: cache the URL
   * client-side until close to expiry, then re-fetch.
   */
  downloadUrl(opts: AttachmentOptions = {}): Promise<AttachmentDownloadResponse> {
    return this.client.request<AttachmentDownloadResponse>({
      method: 'GET',
      path: `/v1/attachments/${this.id}/download-url`,
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  }

  /**
   * Delete the attachment row + best-effort bucket object delete.
   * Authz: uploader (while still `:pending`) or message-sender / conv
   * owner-admin (once linked).
   */
  delete(opts: AttachmentOptions = {}): Promise<void> {
    return this.client.request<void>({
      method: 'DELETE',
      path: `/v1/attachments/${this.id}`,
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  }
}

/**
 * XHR-based PUT with upload progress events. Used by `upload()` when
 * the caller passes an `onProgress` callback — `fetch` doesn't
 * expose upload progress.
 *
 * Browser-only: tests + Node polyfills don't define XMLHttpRequest,
 * so the caller path that selects XHR vs fetch checks
 * `typeof XMLHttpRequest !== 'undefined'` upstream.
 */
function xhrPut(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: BodyInit,
  opts: {
    byteSize: number;
    onProgress: (e: AttachmentProgressEvent) => void;
    signal?: AbortSignal;
  },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    for (const [k, v] of Object.entries(headers)) {
      try {
        xhr.setRequestHeader(k, v);
      } catch {
        // Some browsers refuse to set forbidden headers (Content-Length,
        // etc.). The presigned URL still works without them.
      }
    }
    xhr.upload.onprogress = (e) => {
      // `lengthComputable` is true on R2 / S3; fall back to byteSize
      // for older browsers that don't expose `total`.
      const total = e.lengthComputable ? e.total : opts.byteSize;
      opts.onProgress({ loaded: e.loaded, total });
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else
        reject(new Error(`Poolse: presigned upload PUT failed (${xhr.status} ${xhr.statusText})`));
    };
    xhr.onerror = () => reject(new Error('Poolse: presigned upload PUT failed (network error)'));
    xhr.onabort = () => {
      // Surface as DOMException('AbortError') so callers can detect.
      reject(new DOMException('Upload aborted', 'AbortError'));
    };
    if (opts.signal) {
      if (opts.signal.aborted) {
        xhr.abort();
        return;
      }
      opts.signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
    // body must be XHR-compatible: Blob, File, FormData, string,
    // ArrayBufferView. Customers using a streaming body via fetch
    // wouldn't pass `onProgress` (we'd be on the fetch path).
    xhr.send(body as XMLHttpRequestBodyInit);
  });
}

