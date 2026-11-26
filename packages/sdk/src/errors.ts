// Typed error classes the SDK raises. Callers can `instanceof`-check to
// decide whether to retry, prompt the user to re-login, etc. — the
// alternative (parsing error.message strings) is brittle.

import type { ApiErrorCode, ErrorEnvelope } from './types.js';

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
  public readonly code: ApiErrorCode;
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
 * Auth failure (401, including expired/revoked tokens). The SDK already
 * asked `getToken` for a fresh token once and retried; this error means
 * the fresh one was refused too (or the request carried a caller-supplied
 * `bearer` token), so the session is really gone: sign the user in again.
 */
export class AuthError extends ApiError {
  public override readonly name: string = 'AuthError';

  constructor(envelope: ErrorEnvelope['error']) {
    super(401, envelope);
  }
}

/**
 * A request pushed over the realtime channel (e.g. `presence:get`) was
 * refused or timed out. `reason` is the server's (`rate_limited`,
 * `too_many`, `invalid_state`, …) or `timeout`.
 */
export class ChannelReplyError extends PoolseError {
  public override readonly name: string = 'ChannelReplyError';
  public readonly event: string;
  public readonly reason: string;
  public readonly response: Record<string, unknown>;

  constructor(event: string, response: unknown) {
    const body =
      typeof response === 'object' && response !== null
        ? (response as Record<string, unknown>)
        : {};
    const reason = typeof body['reason'] === 'string' ? body['reason'] : 'error';
    super(`${event}: ${reason}`);
    this.event = event;
    this.reason = reason;
    this.response = body;
  }
}

/**
 * Whether `err` is a cancellation (`AbortError`), from fetch, an XHR or
 * a timer. Checks the name only: `instanceof DOMException` throws where
 * the runtime has no `DOMException` global (older React Native/Hermes).
 */
export function isAbortError(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError'
  );
}

/** An `AbortError`, as a `DOMException` where the runtime has one. @internal */
export function abortError(message = 'Aborted'): Error {
  const D = (globalThis as { DOMException?: new (m: string, n: string) => Error }).DOMException;
  if (typeof D === 'function') return new D(message, 'AbortError');
  return Object.assign(new Error(message), { name: 'AbortError' });
}
