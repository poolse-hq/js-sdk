# Changelog

All notable changes to `@poolse/sdk` are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[semver](https://semver.org).

## [Unreleased]

### Added

- `Poolse` client class with REST resources: `me`, `conversations`
  (list/create/get/update + members), `messages` (send/list/mark-read +
  edit/delete/replies/reactions on per-id handle).
- `RestClient` low-level wrapper:
  - Bearer JWT via `config.getToken` (async or sync; nullable for
    deliberate unauthenticated calls).
  - Auto-generated `Idempotency-Key` for non-GET requests
    (`crypto.randomUUID()` by default; overrideable).
  - Exponential backoff with full jitter for transient failures.
  - `Retry-After` header honoured on 429.
  - Network errors retried (except `AbortError`).
  - 401 → `AuthError`, 429 → `RateLimitedError`, other 4xx/5xx → `ApiError`,
    network failures → `NetworkError`. All `instanceof`-checkable.
- Initial scaffold: TypeScript, dual ESM+CJS build via tsup, vitest,
  eslint, prettier, Node 22 Docker dev environment.

## [0.0.1] — scaffolding only

Placeholder release. The real `Poolse` client class (REST + Channels +
offline queue) lands in subsequent SDK tasks under Phase 1F.
