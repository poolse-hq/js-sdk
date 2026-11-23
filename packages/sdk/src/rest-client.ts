// Low-level fetch wrapper.
//
// Responsibilities:
//   * Apply the Bearer JWT from `config.getToken()`.
//   * Auto-generate an `Idempotency-Key` for non-GET requests so poolse
//     can dedupe retries safely.
//   * Retry transient failures, only where a repeat cannot duplicate work:
//     - GET/HEAD/PUT/DELETE/OPTIONS: network errors, 502/503/504, 429.
//     - POST/PATCH: 429 (the server refused it unprocessed) and network
//       errors raised before the request left the device (connection
//       refused, DNS). Never a 5xx or a dropped connection: the server may
//       have done the work, and its Idempotency-Key cache only replays
//       2xx responses, so a retry after a half-success would duplicate.
//     - Backoff = max(Retry-After header, exponential with jitter).
//     - 401/4xx-other are NOT retried (they won't change on repeat).
//   * Translate non-2xx into typed `ApiError` subclasses.

import type { ResolvedConfig } from './config.js';
import { ApiError, AuthError, NetworkError, RateLimitedError } from './errors.js';
import type { TokenCache } from './token-cache.js';
import type { ErrorEnvelope } from './types.js';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface RequestOptions {
  method: HttpMethod;
  path: string;
  /** JSON-serialisable body for non-GETs. Omit for GET/DELETE. */
  body?: unknown;
  /** Query string params; values are stringified, nullish entries dropped. */
  query?: Record<string, string | number | boolean | null | undefined>;
  /**
   * Idempotency-Key override. Defaults to a fresh UUID for non-GETs.
   * Pass `null` to deliberately omit the header (e.g. when the caller's
   * own retry logic supplies a deterministic one).
   */
  idempotencyKey?: string | null;
  /**
   * Per-request override for total retry budget. Defaults to
   * `config.maxRetries`.
   */
  maxRetries?: number;
  /** AbortSignal for caller-driven cancellation. */
  signal?: AbortSignal;
  /**
   * Authorize with this token instead of the user's session — for the
   * endpoints a call-scoped token authorizes (a call's control token).
   * A 401 then surfaces at once: refreshing the session cannot fix a
   * token the caller supplied.
   */
  bearer?: string;
}

const NON_BODY_METHODS: ReadonlySet<HttpMethod> = new Set(['GET', 'DELETE']);
const IDEMPOTENT_METHODS: ReadonlySet<HttpMethod> = new Set(['GET']);
/** Methods a repeat cannot turn into a second action (RFC 9110 §9.2.2). */
const RETRY_SAFE_METHODS: ReadonlySet<string> = new Set([
  'GET',
  'HEAD',
  'PUT',
  'DELETE',
  'OPTIONS',
]);
/** Gateway failures: the upstream was unreachable, overloaded or slow. */
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);

export class RestClient {
  private readonly config: ResolvedConfig;
  private readonly tokenCache: TokenCache;
  /**
   * Called after every successful request (the client's timings use it).
   *
   * @internal
   */
  observer: ((method: HttpMethod, path: string) => void) | null = null;

  constructor(config: ResolvedConfig, tokenCache: TokenCache) {
    this.config = config;
    this.tokenCache = tokenCache;
  }

  async request<T>(opts: RequestOptions): Promise<T> {
    const url = this.buildUrl(opts.path, opts.query);
    const maxRetries = opts.maxRetries ?? this.config.maxRetries;
    const idempotencyKey = this.resolveIdempotencyKey(opts);
    const retrySafe = RETRY_SAFE_METHODS.has(opts.method);

    let attempt = 0;
    let triedAuthRefresh = false;

    // The retry loop runs up to `maxRetries + 1` total attempts. Each
    // failed attempt either returns (giving up) or waits per the backoff.
    for (;;) {
      const body = opts.body === undefined ? undefined : JSON.stringify(opts.body);
      const headers = await this.buildHeaders(
        opts.method,
        idempotencyKey,
        body !== undefined,
        opts.bearer,
      );

      let response: Response;
      try {
        const init: RequestInit = { method: opts.method, headers };
        if (body !== undefined) init.body = body;
        if (opts.signal) init.signal = opts.signal;
        response = await this.config.fetch(url, init);
      } catch (err) {
        // AbortError is caller intent (component unmount, conv switch,
        // StrictMode double-effect). Re-throw AS-IS so callers can
        // distinguish it from a real network failure. Wrapping it as
        // NetworkError previously caused hooks like useMembers to fall
        // into their "failed to load" branch whenever the aborted fetch
        // resolved after a newly-mounted fetcher already cleared state.
        if (err instanceof DOMException && err.name === 'AbortError') {
          throw err;
        }
        if (attempt < maxRetries && isRetryableNetworkError(err, retrySafe)) {
          await sleep(this.backoffDelay(attempt));
          attempt += 1;
          continue;
        }
        throw new NetworkError('Network request failed', err);
      }

      if (response.status >= 200 && response.status < 300) {
        const parsed = (await parseJsonOrNull(response)) as T;
        this.observer?.(opts.method, opts.path);
        return parsed;
      }

      // 401: a cached token can race a clock-skew expiry or a server
      // restart. Invalidate the token cache and retry ONCE — if the
      // refreshed token also gets 401, the credentials are genuinely
      // bad and we surface it. Doesn't count against the per-request
      // retry budget (auth refresh isn't a "transient" failure in the
      // same sense as 5xx/network).
      if (response.status === 401) {
        if (!triedAuthRefresh && opts.bearer === undefined) {
          this.tokenCache.invalidate();
          triedAuthRefresh = true;
          continue;
        }
        throw new AuthError(await parseEnvelope(response));
      }

      // 429: retry after the larger of (Retry-After, exponential backoff).
      // Any method: a rate-limited request was refused before any work.
      if (response.status === 429) {
        const envelope = await parseEnvelope(response);
        const retryAfterMs = retryAfterHeaderMs(response);
        if (attempt < maxRetries) {
          await sleep(Math.max(retryAfterMs ?? 0, this.backoffDelay(attempt)));
          attempt += 1;
          continue;
        }
        throw new RateLimitedError(envelope, retryAfterMs ?? 0);
      }

      // 502/503/504: retry idempotent methods only. A POST/PATCH that got
      // a 5xx may have half-succeeded, and the server's Idempotency-Key
      // cache keeps only 2xx responses, so a retry could duplicate it
      // (a scheduled message sent four times). Plain 500 is a server bug
      // that a repeat won't fix, so nothing retries it.
      if (retrySafe && RETRYABLE_STATUSES.has(response.status) && attempt < maxRetries) {
        await sleep(this.backoffDelay(attempt));
        attempt += 1;
        continue;
      }

      throw new ApiError(response.status, await parseEnvelope(response));
    }
  }

  // ── helpers ────────────────────────────────────────────────────────────

  private buildUrl(path: string, query?: RequestOptions['query']): string {
    const base = `${this.config.apiUrl}${path.startsWith('/') ? path : `/${path}`}`;
    if (!query) return base;

    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) {
        params.append(k, String(v));
      }
    }
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  }

  private async buildHeaders(
    method: HttpMethod,
    idempotencyKey: string | null,
    hasBody: boolean,
    bearer?: string,
  ): Promise<Record<string, string>> {
    const headers: Record<string, string> = { Accept: 'application/json' };

    if (hasBody) headers['Content-Type'] = 'application/json';

    const token = bearer ?? (await this.config.getToken());
    if (token) headers['Authorization'] = `Bearer ${token}`;

    if (!IDEMPOTENT_METHODS.has(method) && idempotencyKey) {
      headers['Idempotency-Key'] = idempotencyKey;
    }

    return headers;
  }

  private resolveIdempotencyKey(opts: RequestOptions): string | null {
    if (opts.idempotencyKey === null) return null;
    if (opts.idempotencyKey) return opts.idempotencyKey;
    if (IDEMPOTENT_METHODS.has(opts.method)) return null;
    return this.config.generateIdempotencyKey();
  }

  private backoffDelay(attempt: number): number {
    const exp = this.config.baseBackoffMs * 2 ** attempt;
    const capped = Math.min(this.config.maxBackoffMs, exp);
    // Full jitter: pick uniformly in [0, capped]. Avoids retry-storm
    // synchronization when many clients fail at once.
    return Math.floor(Math.random() * capped);
  }
}

function _unusedNonBodyMethods(): unknown {
  return NON_BODY_METHODS;
}

async function parseEnvelope(response: Response): Promise<ErrorEnvelope['error']> {
  try {
    const json = (await response.json()) as ErrorEnvelope;
    if (json?.error?.code) return json.error;
  } catch {
    // fall through to a synthetic envelope below
  }
  return {
    code: 'unknown_error',
    message: `HTTP ${response.status}`,
    doc_url: '',
  };
}

async function parseJsonOrNull(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text);
}

function retryAfterHeaderMs(response: Response): number | null {
  const raw = response.headers.get('retry-after');
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  // HTTP-date form.
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

/**
 * Error codes that mean the request never left the device (no connection
 * was made), so even a POST is safe to send again. Node/undici and React
 * Native put them on `err.cause.code` (or `err.code`).
 */
const PRE_SEND_ERROR_CODES: ReadonlySet<string> = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
]);

function errorCode(err: unknown): string | null {
  for (let e: unknown = err, depth = 0; e && typeof e === 'object' && depth < 3; depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    e = (e as { cause?: unknown }).cause;
  }
  return null;
}

function isRetryableNetworkError(err: unknown, retrySafe: boolean): boolean {
  // Abort is caller intent — never retry.
  if (err instanceof DOMException && err.name === 'AbortError') return false;
  // Idempotent methods: any failure (TypeError from fetch, reset…) is fair game.
  if (retrySafe) return true;
  // POST/PATCH: only when the request provably never reached the server.
  // A browser's opaque "Failed to fetch" could be a dropped response, so
  // it is not retried.
  const code = errorCode(err);
  return code !== null && PRE_SEND_ERROR_CODES.has(code);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
