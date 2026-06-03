/**
 * Hosted poolse API URL. Used as the default for `PoolseConfig.apiUrl`
 * when you don't pass one — appropriate for the vast majority of
 * integrations that target the official poolse cloud. Self-hosted /
 * staging deployments override via the `apiUrl` field.
 */
export const POOLSE_API_URL = 'https://api.poolse.dev';

import type { PoolseUserProfile } from './types.js';

/**
 * SDK configuration passed to `new Poolse(config)`.
 */
export interface PoolseConfig {
  /**
   * Base URL of the poolse REST API. Defaults to the hosted endpoint
   * at `https://api.poolse.dev`. Override only for self-hosted /
   * staging deployments. MUST NOT include the `/v1` path — the SDK
   * adds that itself.
   */
  apiUrl?: string;

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

  /**
   * Resolve the tenant's user identifier (`external_id` — same string
   * you pass when minting JWTs and referencing users in
   * `member_external_ids`) to the customer's own user metadata
   * (display name + avatar). Called by `chat.users.get(externalId)`
   * and the `useUser(externalId)` React hook whenever a UI component
   * needs to render a participant.
   *
   * The SDK caches results in-memory and dedupes concurrent calls,
   * so a busy chat with 50 messages from 5 senders fires the
   * resolver 5 times — once per unique sender — not 50.
   *
   * Customers hit their OWN backend / store here, keyed by **their own
   * user id** (no poolse uuid mapping required):
   *
   *   userResolver: async (externalId) => {
   *     const u = await fetch(`/api/users/${externalId}`).then((r) => r.json());
   *     return { displayName: u.full_name, avatarUrl: u.avatar_url };
   *   }
   *
   * Sync returns are fine when the data's already in memory:
   *
   *   userResolver: (externalId) => directory[externalId] ?? null
   *
   * Return `null` when the user can't be found — components fall back
   * to the external_id as a label and an initials avatar.
   */
  userResolver?: (
    externalId: string,
  ) => Promise<PoolseUserProfile | null> | PoolseUserProfile | null;
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
  userResolver: PoolseConfig['userResolver'];
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_BACKOFF_MS = 250;
const DEFAULT_MAX_BACKOFF_MS = 30_000;

export function resolveConfig(config: PoolseConfig): ResolvedConfig {
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
    apiUrl: trimTrailingSlash(config.apiUrl ?? POOLSE_API_URL),
    getToken: config.getToken,
    fetch: fetchFn,
    maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
    baseBackoffMs: config.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS,
    maxBackoffMs: config.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS,
    generateIdempotencyKey: config.generateIdempotencyKey ?? defaultIdempotencyKey,
    wsUrl: config.wsUrl,
    socketPath: config.socketPath ?? '/socket',
    onSocketError: config.onSocketError,
    userResolver: config.userResolver,
  };
}

function trimTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

// Delegates to `safeUuid` so the default works in every supported
// runtime — browsers, Node, Bun, Deno, React Native (with or without
// a crypto polyfill). Consumers can still override via
// `config.generateIdempotencyKey` when they need a different source.
import { safeUuid } from './uuid.js';

function defaultIdempotencyKey(): string {
  return safeUuid();
}
