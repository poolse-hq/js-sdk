// Vitest setup — runs before every test file in @poolse/react.
//
// Globally mocks `phoenix` so the realtime hooks (useReactions,
// useThread, useTyping, useMessages, etc.) don't try to open a real
// WebSocket to `wss://chat.test/socket` during unit tests. The stub
// implements only the methods the realtime layer touches; behavior
// tests for the realtime layer itself live in @poolse/sdk and use
// their own mocking.
//
// Must live in a real test file (or setup file) so vitest hoists the
// `vi.mock` call — placing it in a `.tsx` helper that isn't itself
// loaded as a test doesn't trigger hoisting and the mock is ignored.

import { vi } from 'vitest';

// happy-dom defines a working XMLHttpRequest. The SDK's attachment
// `upload()` switches to XHR when `onProgress` is set (the React
// hook always sets it for the queue UI), which would otherwise
// bypass `scriptedFetch` and attempt a real network PUT to
// `storage.test`. Force the fetch branch in tests by removing XHR
// from the test global — the XHR path is browser-only behavior and
// is exercised end-to-end by the showcase, not these unit tests.
(globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = undefined;

// The `vi.mock('phoenix', …)` below cannot reach the copy of Phoenix
// that `@poolse/sdk`'s dist bundles inline, so that copy still builds a
// real Socket. With no WebSocket in the global, Phoenix falls back to
// LongPoll and schedules a poll timer that fires *after* happy-dom is
// torn down — surfacing as an unhandled "No suitable XMLHttpRequest
// implementation found" that fails the run even though every test
// passed. Removing XHR alone doesn't help: the timer is scheduled
// before the first poll throws.
//
// Handing Phoenix an inert WebSocket keeps it on the WS transport, so
// it never reaches the LongPoll branch and never schedules anything.
class InertWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly readyState = InertWebSocket.CLOSED;
  constructor(_url: string, _protocols?: string | string[]) {}
  send(_data: unknown): void {}
  close(_code?: number, _reason?: string): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
}
(globalThis as { WebSocket?: unknown }).WebSocket = InertWebSocket;

vi.mock('phoenix', () => {
  class StubChannel {
    on() {
      return 0;
    }
    off() {}
    join() {
      const recv = { receive: () => recv };
      return recv;
    }
    push() {
      const recv = { receive: () => recv };
      return recv;
    }
    leave() {
      const recv = { receive: () => recv };
      return recv;
    }
  }
  class StubSocket {
    constructor(_url: string, _opts: unknown) {}
    channel() {
      return new StubChannel();
    }
    onOpen() {}
    onClose() {}
    onError() {}
    connect() {}
    disconnect() {}
    isConnected() {
      return false;
    }
  }
  return { Socket: StubSocket, Channel: StubChannel, Presence: class {} };
});
