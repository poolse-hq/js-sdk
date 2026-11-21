/**
 * A BlobTransport over the poolse server's per-user blob store (ST6), using
 * `fetch` directly so the package keeps no dependency on @poolse/sdk:
 *
 *   GET    /v1/me/blobs?prefix=&cursor=&limit=   live blobs by key
 *   GET    /v1/me/blob-changes?cursor=&limit=    writes and deletions since
 *   GET    /v1/me/blobs/:key                     bytes + ETag, 404
 *   PUT    /v1/me/blobs/:key                     If-Match / If-None-Match: *, 412
 *   DELETE /v1/me/blobs/:key                     If-Match, 204
 *
 * Versions are the ETag without its quotes; `If-Match` sends them quoted.
 * The server only ever sees ciphertext (EncryptedBlobStore encrypts first).
 */
import { BlobConflictError } from './errors';
import type {
  BlobChange,
  BlobChangesPage,
  BlobInfo,
  BlobLimits,
  BlobListOptions,
  BlobListPage,
  BlobTransport,
} from './sync';

/**
 * Why a blob request failed (other than a version conflict, which is
 * `BlobConflictError`).
 *
 * - `too_large` — the blob is over the server's per-blob limit (413).
 * - `quota_exceeded` — the user's encrypted storage is full (413).
 * - `sync_disabled` — the workspace turned encrypted sync off (403).
 * - `rate_limited` — too many requests (429); see `retryAfterMs`.
 * - `invalid_key` — the key isn't 1–128 of `a–z 0–9 .` (checked before sending, and 422).
 * - `unauthorized` — the token was refused, even after asking `getToken` again (401).
 * - `forbidden` — any other 403.
 * - `not_found` — a 404 where one isn't expected (e.g. a list endpoint).
 * - `server` — a 5xx.
 * - `network` — `fetch` itself failed (offline, DNS, CORS).
 * - `bad_response` — a success without the ETag or JSON the contract promises
 *   (in a browser, usually `ETag` missing from `Access-Control-Expose-Headers`).
 * - `http` — any other status.
 */
export type BlobTransportErrorCode =
  | 'too_large'
  | 'quota_exceeded'
  | 'sync_disabled'
  | 'rate_limited'
  | 'invalid_key'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'server'
  | 'network'
  | 'bad_response'
  | 'http';

export class BlobTransportError extends Error {
  override readonly name = 'BlobTransportError';

  constructor(
    readonly code: BlobTransportErrorCode,
    message: string,
    /** HTTP status, or 0 when no response arrived. */
    readonly status = 0,
    /** The server's own `error.code`, when it sent one. */
    readonly serverCode: string | null = null,
    /** From `Retry-After`, for `rate_limited`. */
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
  }

  /** Worth retrying later as is (rate limit, server error, network). */
  get retryable(): boolean {
    return this.code === 'rate_limited' || this.code === 'server' || this.code === 'network';
  }
}

export interface HttpBlobTransportOptions {
  /** The poolse server, e.g. `https://chat.example.com` (no trailing `/v1`). */
  apiUrl: string;
  /** The signed-in user's token (Bearer). Called per request and again once after a 401. */
  getToken: () => string | Promise<string>;
  /** Defaults to `globalThis.fetch`. */
  fetch?: typeof fetch;
}

const KEY_RE = /^[a-z0-9.]{1,128}$/;

/** True when the server accepts `key`: 1–128 of `a–z 0–9 .`, no leading/trailing dot, no `..`. */
export function isValidBlobKey(key: string): boolean {
  return KEY_RE.test(key) && !key.startsWith('.') && !key.endsWith('.') && !key.includes('..');
}

function checkKey(key: string): void {
  if (!isValidBlobKey(key)) {
    throw new BlobTransportError(
      'invalid_key',
      `Blob key "${key}" must be 1–128 of a–z, 0–9 and "." (no leading, trailing or double dot)`,
    );
  }
}

/** `"12"`, `W/"12"` or `12` → `12`. */
function parseEtag(value: string | null): string | null {
  if (!value) return null;
  const v = value
    .trim()
    .replace(/^W\//, '')
    .replace(/^"(.*)"$/, '$1');
  return v.length > 0 ? v : null;
}

function retryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

async function serverError(response: Response): Promise<{ code: string | null; message: string }> {
  try {
    const body = (await response.json()) as { error?: { code?: unknown; message?: unknown } };
    return {
      code: typeof body.error?.code === 'string' ? body.error.code : null,
      message:
        typeof body.error?.message === 'string' ? body.error.message : `HTTP ${response.status}`,
    };
  } catch {
    return { code: null, message: `HTTP ${response.status}` };
  }
}

async function toError(response: Response): Promise<BlobTransportError> {
  const { code, message } = await serverError(response);
  const s = response.status;
  const mapped: BlobTransportErrorCode =
    s === 413
      ? code === 'quota_exceeded'
        ? 'quota_exceeded'
        : 'too_large'
      : s === 403
        ? code === 'sync_disabled'
          ? 'sync_disabled'
          : 'forbidden'
        : s === 429
          ? 'rate_limited'
          : s === 422 && code === 'invalid_key'
            ? 'invalid_key'
            : s === 401
              ? 'unauthorized'
              : s === 404
                ? 'not_found'
                : s >= 500
                  ? 'server'
                  : 'http';
  return new BlobTransportError(
    mapped,
    message,
    s,
    code,
    s === 429 ? retryAfter(response.headers.get('retry-after')) : null,
  );
}

interface WireBlob {
  key?: unknown;
  version?: unknown;
  etag?: unknown;
  size?: unknown;
  size_bytes?: unknown;
  updated_at?: unknown;
  deleted?: unknown;
}

function toInfo(raw: WireBlob): BlobInfo {
  const version =
    (typeof raw.etag === 'string' ? parseEtag(raw.etag) : null) ??
    (raw.version !== undefined && raw.version !== null ? String(raw.version) : null);
  if (typeof raw.key !== 'string' || !version) {
    throw new BlobTransportError('bad_response', 'A listed blob has no key or version');
  }
  const info: BlobInfo = { key: raw.key, version };
  const size = typeof raw.size === 'number' ? raw.size : raw.size_bytes;
  if (typeof size === 'number') info.size = size;
  if (typeof raw.updated_at === 'string') info.updatedAt = raw.updated_at;
  return info;
}

function toLimits(raw: unknown): BlobLimits | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const limits: BlobLimits = {};
  if (typeof r.max_blob_bytes === 'number') limits.maxBlobBytes = r.max_blob_bytes;
  if (typeof r.max_user_bytes === 'number') limits.maxUserBytes = r.max_user_bytes;
  if (typeof r.max_blobs === 'number') limits.maxBlobs = r.max_blobs;
  return limits;
}

/**
 * The BlobTransport for `EncryptedBlobStore` against a poolse server.
 *
 * - `get`: 200 → bytes and the ETag's version; 404 → `null`.
 * - `put`: sends `If-Match: "<version>"` or `If-None-Match: *`; 200/201 →
 *   the new version (ETag, else the JSON `version`); 412/409 →
 *   `BlobConflictError`.
 * - `delete`: 204 → done; 412/409 → `BlobConflictError`; 404 → done when no
 *   `ifMatch` was given (already gone), else `BlobConflictError`.
 * - `list` / `changes`: the JSON pages, versions taken from each `etag`.
 * - Anything else throws `BlobTransportError`. Nothing is retried except one
 *   new token after a 401; on `rate_limited` wait `retryAfterMs`.
 */
export function createHttpBlobTransport(options: HttpBlobTransportOptions): BlobTransport & {
  changes(options: { cursor?: string; limit?: number }): Promise<BlobChangesPage>;
} {
  const base = options.apiUrl.replace(/\/+$/, '');
  const doFetch = (input: string, init: RequestInit): Promise<Response> => {
    const f = options.fetch ?? globalThis.fetch;
    if (typeof f !== 'function') {
      throw new BlobTransportError('network', 'fetch is not available; pass options.fetch');
    }
    return f(input, init);
  };

  async function request(
    method: string,
    path: string,
    headers: Record<string, string> = {},
    body?: Uint8Array,
  ): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const token = await options.getToken();
      const init: RequestInit = {
        method,
        headers: { Authorization: `Bearer ${token}`, ...headers },
      };
      if (body) init.body = new Uint8Array(body);
      let response: Response;
      try {
        response = await doFetch(`${base}${path}`, init);
      } catch (error) {
        if (error instanceof BlobTransportError) throw error;
        throw new BlobTransportError(
          'network',
          `Could not reach the server: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (response.status === 401 && attempt === 0) {
        await response.body?.cancel().catch(() => undefined);
        continue;
      }
      return response;
    }
  }

  function blobPath(key: string): string {
    checkKey(key);
    return `/v1/me/blobs/${encodeURIComponent(key)}`;
  }

  function query(params: Record<string, string | number | undefined>): string {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, String(v));
    const s = q.toString();
    return s ? `?${s}` : '';
  }

  async function json(response: Response): Promise<Record<string, unknown>> {
    try {
      const value = (await response.json()) as unknown;
      if (value && typeof value === 'object') return value as Record<string, unknown>;
    } catch {
      // fall through
    }
    throw new BlobTransportError(
      'bad_response',
      'The server did not answer with JSON',
      response.status,
    );
  }

  async function conflict(key: string, response: Response): Promise<BlobConflictError> {
    await response.body?.cancel().catch(() => undefined);
    return new BlobConflictError(key, parseEtag(response.headers.get('etag')));
  }

  return {
    async get(key) {
      const response = await request('GET', blobPath(key), { Accept: 'application/octet-stream' });
      if (response.status === 404) {
        await response.body?.cancel().catch(() => undefined);
        return null;
      }
      if (!response.ok) throw await toError(response);
      const version = parseEtag(response.headers.get('etag'));
      if (!version) {
        throw new BlobTransportError(
          'bad_response',
          'The blob came without an ETag (in a browser, expose it with Access-Control-Expose-Headers)',
          response.status,
        );
      }
      return { data: new Uint8Array(await response.arrayBuffer()), version };
    },

    async put(key, data, precondition) {
      const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream' };
      if (precondition.ifMatch !== undefined) headers['If-Match'] = `"${precondition.ifMatch}"`;
      if (precondition.ifNoneMatch === '*') headers['If-None-Match'] = '*';
      const response = await request('PUT', blobPath(key), headers, data);
      if (response.status === 412 || response.status === 409) throw await conflict(key, response);
      if (!response.ok) throw await toError(response);
      let version = parseEtag(response.headers.get('etag'));
      if (!version) {
        const body = await json(response);
        if (body.version !== undefined && body.version !== null) version = String(body.version);
      }
      if (!version) {
        throw new BlobTransportError(
          'bad_response',
          'The write came back without a version',
          response.status,
        );
      }
      return { version };
    },

    async delete(key, precondition) {
      const headers: Record<string, string> = {};
      if (precondition.ifMatch !== undefined) headers['If-Match'] = `"${precondition.ifMatch}"`;
      const response = await request('DELETE', blobPath(key), headers);
      if (response.status === 412 || response.status === 409) throw await conflict(key, response);
      if (response.status === 404) {
        await response.body?.cancel().catch(() => undefined);
        if (precondition.ifMatch !== undefined) throw new BlobConflictError(key, null);
        return;
      }
      if (!response.ok) throw await toError(response);
      await response.body?.cancel().catch(() => undefined);
    },

    async list(listOptions: BlobListOptions): Promise<BlobListPage> {
      const response = await request(
        'GET',
        `/v1/me/blobs${query({ prefix: listOptions.prefix, cursor: listOptions.cursor, limit: listOptions.limit })}`,
        { Accept: 'application/json' },
      );
      if (!response.ok) throw await toError(response);
      const body = await json(response);
      if (!Array.isArray(body.data))
        throw new BlobTransportError('bad_response', 'No data in the listing');
      const page: BlobListPage = {
        blobs: (body.data as WireBlob[]).map(toInfo),
        cursor: typeof body.next_cursor === 'string' ? body.next_cursor : null,
      };
      const limits = toLimits(body.limits);
      if (limits) page.limits = limits;
      return page;
    },

    async changes(changeOptions: { cursor?: string; limit?: number }): Promise<BlobChangesPage> {
      const response = await request(
        'GET',
        `/v1/me/blob-changes${query({ cursor: changeOptions.cursor, limit: changeOptions.limit })}`,
        { Accept: 'application/json' },
      );
      if (!response.ok) throw await toError(response);
      const body = await json(response);
      if (!Array.isArray(body.data))
        throw new BlobTransportError('bad_response', 'No data in the changes');
      const changes: BlobChange[] = (body.data as WireBlob[]).map((raw) => ({
        ...toInfo(raw),
        deleted: raw.deleted === true,
      }));
      const cursor =
        typeof body.next_cursor === 'string' ? body.next_cursor : (changeOptions.cursor ?? '');
      return { changes, cursor };
    },
  };
}
