// Caches the JWT returned by the consumer's `getToken` callback so the
// SDK doesn't call back on every REST request and every WebSocket
// connect. Without this, mounting a single conversation view fires
// ~4-5 `getToken` calls per render — and every parent re-render that
// (accidentally) hands the provider a new config object multiplies
// that out, turning a passive UI into a token-fetch storm.
//
// The cache:
//   * Decodes the `exp` claim (no signature verification — that's the
//     server's job) and returns the cached token until `exp - 30s`.
//   * Coalesces concurrent calls: if a refresh is in flight, every
//     caller awaits the same promise — one network round-trip even
//     when 4 hooks mount simultaneously.
//   * Can be `invalidate()`-d from the outside (e.g. by the REST client
//     after a 401) so the next call always re-fetches.
//   * Treats opaque (non-JWT) tokens as cacheable for `FALLBACK_TTL_MS`
//     — long enough to absorb a mount burst, short enough that opaque
//     rotations still land within a few seconds.
//   * NEVER caches `null` (an unauthenticated request is a choice the
//     consumer makes per call, not a state to memoise).

import type { PoolseConfig } from './config.js';

type Fetcher = PoolseConfig['getToken'];

interface GetTokenOptions {
  /** Bypass the cache and force a fresh call to the consumer's `getToken`. */
  forceRefresh?: boolean;
}

const REFRESH_BUFFER_MS = 30_000;
const FALLBACK_TTL_MS = 60_000;

export class TokenCache {
  private token: string | null = null;
  private expMs: number | null = null;
  private inFlight: Promise<string | null> | null = null;

  constructor(private readonly fetcher: Fetcher) {}

  /**
   * Synchronously return the cached token without triggering a fetch.
   * Returns `null` if the cache is empty OR if the cached token is
   * within the refresh window (treating near-expiry tokens as stale
   * keeps the realtime layer from handshaking with an about-to-expire
   * JWT when a refresh is already due).
   *
   * Exists for callers like Phoenix.js's `params` callback that the
   * library invokes synchronously and does NOT await — see
   * `phoenix/priv/static/phoenix.mjs::endPointURL()`.
   */
  peekToken(): string | null {
    if (this.token === null || this.expMs === null) return this.token;
    return Date.now() < this.expMs - REFRESH_BUFFER_MS ? this.token : null;
  }

  async getToken(opts: GetTokenOptions = {}): Promise<string | null> {
    if (opts.forceRefresh) this.invalidate();

    const now = Date.now();
    if (this.token && this.expMs !== null && now < this.expMs - REFRESH_BUFFER_MS) {
      return this.token;
    }

    if (this.inFlight) return this.inFlight;

    this.inFlight = this.fetchAndStore().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  invalidate(): void {
    this.token = null;
    this.expMs = null;
    // Don't clear `inFlight` — let the existing fetch resolve normally;
    // its result just won't be cached (the freshness check above will
    // miss it). The next call after `invalidate()` will be served by
    // that same in-flight promise if it's still pending.
  }

  private async fetchAndStore(): Promise<string | null> {
    const token = await this.fetcher();
    if (!token) {
      this.token = null;
      this.expMs = null;
      return null;
    }

    const expSec = parseJwtExp(token);
    if (expSec !== null) {
      const expMs = expSec * 1000;
      // Already expired by the time it reached us — cache for a short
      // fallback so the burst doesn't hammer, but don't trust the exp.
      // The next REST 401 will invalidate and we'll re-fetch.
      this.expMs = expMs <= Date.now() ? Date.now() + FALLBACK_TTL_MS : expMs;
    } else {
      this.expMs = Date.now() + FALLBACK_TTL_MS;
    }
    this.token = token;
    return token;
  }
}

// JWT payload base64url-decode → JSON parse → pluck `exp`. Returns
// null if the token isn't a JWT, the payload is unreadable, or `exp`
// is missing/non-numeric. Never throws — bad tokens just go uncached.
function parseJwtExp(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const json = decodeBase64Url(parts[1] as string);
    const payload = JSON.parse(json) as { exp?: unknown };
    return typeof payload.exp === 'number' && Number.isFinite(payload.exp)
      ? payload.exp
      : null;
  } catch {
    return null;
  }
}

function decodeBase64Url(s: string): string {
  // JWT uses base64url (RFC 7515 §2): `-` and `_` instead of `+` and
  // `/`, no padding. Translate back to standard base64 and re-pad.
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  if (typeof atob === 'function') return atob(padded);
  // Node fallback (older runtimes without global atob). The SDK's
  // minimum target is Node 18 where atob is global, but keep this for
  // safety / SSR environments that polyfill differently.
  const g = globalThis as { Buffer?: { from(s: string, e: string): { toString(e: string): string } } };
  if (g.Buffer) return g.Buffer.from(padded, 'base64').toString('binary');
  throw new Error('No base64 decoder available');
}
