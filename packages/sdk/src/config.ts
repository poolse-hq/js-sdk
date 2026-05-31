/**
 * SDK configuration passed to `new Poolse(config)`.
 */
export interface PoolseConfig {
  /**
   * Base URL of the poolse REST API, e.g. `https://chat.example.com`.
   * MUST NOT include the `/v1` path — the SDK adds that itself.
   */
  apiUrl: string;

  /**
   * Async hook the SDK calls every time it needs an `Authorization:
   * Bearer <jwt>` header. Most apps refresh the JWT from their own
   * backend here — the SDK never talks to poolse's `POST
   * /v1/users/:user_id/tokens` itself (that endpoint is API-key-authed
   * and lives on the Customer's BACKEND, not the End User's device).
   *
   * Return `null` to deliberately make an unauthenticated request — the
   * server will reject it, but the SDK won't error inside `getToken`.
   */
  getToken: () => Promise<string | null> | string | null;

  /**
   * Optional fetch override. Browsers and Node 22+ both ship a global
   * `fetch`, but tests can inject a mock here; bundlers in restricted
   * environments can supply a polyfill.
   */
  fetch?: typeof globalThis.fetch;

  /**
   * Retry budget for transient failures (network + 5xx + 429). Defaults
   * to 3 attempts after the initial request. Set to 0 to disable.
   */
  maxRetries?: number;

  /**
   * Base for the exponential backoff, in milliseconds. Each retry waits
   * `min(maxBackoffMs, baseBackoffMs * 2^attempt)` plus jitter, OR honours
   * the `Retry-After` header if present. Default 250 ms.
   */
  baseBackoffMs?: number;

  /** Hard cap on a single retry delay. Default 30_000 ms. */
  maxBackoffMs?: number;

  /**
   * Override the idempotency-key generator. Defaults to
   * `crypto.randomUUID()`. Most apps don't need to override this — the
   * generator is exposed mainly for deterministic tests.
   */
  generateIdempotencyKey?: () => string;

  /**
   * Override the WebSocket URL. Defaults to `apiUrl` with `http(s)://`
   * swapped to `ws(s)://`, suitable when the realtime gateway shares
   * its origin with the REST API. Set explicitly for split-host
   * deployments (`https://api.example.com` REST + `wss://realtime.example.com` WS).
   */
  wsUrl?: string;

  /**
   * Path the WebSocket is mounted on. Defaults to `/socket` — matches
   * `CaasRealtimeWeb.UserSocket`'s mount point.
   */
  socketPath?: string;

  /**
   * Called when the underlying socket encounters a non-fatal error
   * (Phoenix retries internally). Useful for surfacing reconnect
   * banners in the UI without coupling to socket internals.
   */
  onSocketError?: (err: Error) => void;
}

/** Internal resolved config — all the defaults filled in. */
export interface ResolvedConfig {
  apiUrl: string;
  getToken: PoolseConfig['getToken'];
  fetch: typeof globalThis.fetch;
  maxRetries: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
  generateIdempotencyKey: () => string;
  wsUrl: string | undefined;
  socketPath: string;
  onSocketError: ((err: Error) => void) | undefined;
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_BACKOFF_MS = 250;
const DEFAULT_MAX_BACKOFF_MS = 30_000;

export function resolveConfig(config: PoolseConfig): ResolvedConfig {
  if (!config.apiUrl) {
    throw new Error('Poolse: `apiUrl` is required.');
  }
  if (typeof config.getToken !== 'function') {
    throw new Error('Poolse: `getToken` is required and must be a function.');
  }

  const rawFetch = config.fetch ?? globalThis.fetch;
  if (typeof rawFetch !== 'function') {
    throw new Error(
      'Poolse: no global `fetch` found. Provide one via `config.fetch` ' +
        '(Node <18 or a sandboxed runtime).',
    );
  }
  // Bind to globalThis so the browser's `fetch` keeps its native `this`
  // (it throws "Illegal invocation" when called with any other receiver,
  // and `this.config.fetch(...)` in the RestClient strips the binding).
  // A consumer-supplied `config.fetch` is also bound the same way for
  // consistency — if they want a specific receiver they should bind it
  // themselves before passing it in.
  const fetchFn = rawFetch.bind(globalThis);

  return {
    apiUrl: trimTrailingSlash(config.apiUrl),
    getToken: config.getToken,
    fetch: fetchFn,
    maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
    baseBackoffMs: config.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS,
    maxBackoffMs: config.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS,
    generateIdempotencyKey: config.generateIdempotencyKey ?? defaultIdempotencyKey,
    wsUrl: config.wsUrl,
    socketPath: config.socketPath ?? '/socket',
    onSocketError: config.onSocketError,
  };
}

function trimTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

function defaultIdempotencyKey(): string {
  // crypto.randomUUID() is on globalThis in Node 19+ and browsers (where
  // available, in secure contexts). If a runtime lacks it, the caller
  // must supply `generateIdempotencyKey` in config.
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  throw new Error(
    'Poolse: globalThis.crypto.randomUUID() is not available; supply ' +
      '`config.generateIdempotencyKey` instead.',
  );
}
