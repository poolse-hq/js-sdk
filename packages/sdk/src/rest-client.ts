// Low-level fetch wrapper.
//
// Responsibilities:
//   * Apply the Bearer JWT from `config.getToken()`.
//   * Auto-generate an `Idempotency-Key` for non-GET requests so poolse
//     can dedupe retries safely.
//   * Retry on transient failures: network errors, 5xx, 429.
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
}

const NON_BODY_METHODS: ReadonlySet<HttpMethod> = new Set(['GET', 'DELETE']);
const IDEMPOTENT_METHODS: ReadonlySet<HttpMethod> = new Set(['GET']);

export class RestClient {
  private readonly config: ResolvedConfig;
  private readonly tokenCache: TokenCache;

  constructor(config: ResolvedConfig, tokenCache: TokenCache) {
    this.config = config;
    this.tokenCache = tokenCache;
  }

  async request<T>(opts: RequestOptions): Promise<T> {
    const url = this.buildUrl(opts.path, opts.query);
    const maxRetries = opts.maxRetries ?? this.config.maxRetries;
    const idempotencyKey = this.resolveIdempotencyKey(opts);

    let attempt = 0;
    let triedAuthRefresh = false;

    // The retry loop runs up to `maxRetries + 1` total attempts. Each
    // failed attempt either returns (giving up) or waits per the backoff.
    for (;;) {
      const body = opts.body === undefined ? undefined : JSON.stringify(opts.body);
      const headers = await this.buildHeaders(opts.method, idempotencyKey, body !== undefined);

      let response: Response;
      try {
        const init: RequestInit = { method: opts.method, headers };
        if (body !== undefined) init.body = body;
        if (opts.signal) init.signal = opts.signal;
        response = await this.config.fetch(url, init);
      } catch (err) {
        if (attempt < maxRetries && isRetryableNetworkError(err)) {
          await sleep(this.backoffDelay(attempt));
          attempt += 1;
          continue;
        }
        throw new NetworkError('Network request failed', err);
      }

      if (response.status >= 200 && response.status < 300) {
        return (await parseJsonOrNull(response)) as T;
      }

      // 401: a cached token can race a clock-skew expiry or a server
      // restart. Invalidate the token cache and retry ONCE — if the
      // refreshed token also gets 401, the credentials are genuinely
      // bad and we surface it. Doesn't count against the per-request
      // retry budget (auth refresh isn't a "transient" failure in the
      // same sense as 5xx/network).
      if (response.status === 401) {
        if (!triedAuthRefresh) {
          this.tokenCache.invalidate();
          triedAuthRefresh = true;
          continue;
        }
        throw new AuthError(await parseEnvelope(response));
      }

      // 429: retry after the larger of (Retry-After, exponential backoff).
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

      // 5xx: retry if we have budget and the method is safe to retry.
      // Non-idempotent methods (POST/PATCH/PUT/DELETE) are STILL retried
      // here because the Idempotency-Key header makes duplicates safe.
      if (response.status >= 500 && attempt < maxRetries) {
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
  ): Promise<Record<string, string>> {
    const headers: Record<string, string> = { Accept: 'application/json' };

    if (hasBody) headers['Content-Type'] = 'application/json';

    const token = await this.config.getToken();
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
  const seconds = Number.parseInt(raw, 10);
  return Number.isFinite(seconds) ? seconds * 1000 : null;
}

function isRetryableNetworkError(err: unknown): boolean {
  // Abort is caller intent — never retry.
  if (err instanceof DOMException && err.name === 'AbortError') return false;
  // Everything else (TypeError from fetch failure, etc.) is fair game.
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
