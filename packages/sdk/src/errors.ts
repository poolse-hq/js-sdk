// Typed error classes the SDK raises. Callers can `instanceof`-check to
// decide whether to retry, prompt the user to re-login, etc. — the
// alternative (parsing error.message strings) is brittle.

import type { ErrorEnvelope } from './types.js';

/** Base for any error originating in the SDK. */
export class PoolseError extends Error {
  public override readonly name: string = 'PoolseError';

  constructor(message: string) {
    super(message);
    // Restore prototype chain across the TS down-level transform.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** fetch() rejected or the server returned no response at all. */
export class NetworkError extends PoolseError {
  public override readonly name: string = 'NetworkError';
  public override readonly cause: unknown;

  constructor(message: string, cause: unknown) {
    super(message);
    this.cause = cause;
  }
}

/**
 * Server returned a non-2xx status with the canonical error envelope.
 * `code` is poolse's snake_case error code (e.g. `"invalid_user_token"`).
 */
export class ApiError extends PoolseError {
  public override readonly name: string = 'ApiError';
  public readonly status: number;
  public readonly code: string;
  public readonly docUrl: string;
  public readonly details: Record<string, unknown> | undefined;

  constructor(status: number, envelope: ErrorEnvelope['error']) {
    super(`[${status}] ${envelope.code}: ${envelope.message}`);
    this.status = status;
    this.code = envelope.code;
    this.docUrl = envelope.doc_url;
    this.details = envelope.details;
  }
}

/**
 * 429 specifically. Surfaced as its own subclass so callers can back off
 * politely without parsing the generic ApiError.
 */
export class RateLimitedError extends ApiError {
  public override readonly name: string = 'RateLimitedError';
  public readonly retryAfterMs: number;

  constructor(envelope: ErrorEnvelope['error'], retryAfterMs: number) {
    super(429, envelope);
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Auth failure (401, including expired/revoked tokens). Callers should
 * refresh the JWT (via `getToken`) and retry — the SDK does NOT do this
 * automatically, because the failure could also mean "the user signed
 * out on another tab" and silent re-auth would hide that.
 */
export class AuthError extends ApiError {
  public override readonly name: string = 'AuthError';

  constructor(envelope: ErrorEnvelope['error']) {
    super(401, envelope);
  }
}
