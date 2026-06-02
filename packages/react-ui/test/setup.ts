// Vitest setup — runs before every test file in @poolse/react-ui.
// Mirrors the setup in @poolse/react: globally stubs `phoenix` so
// components that mount realtime hooks (anything reading from
// `chat.realtime.*`) don't try to open a real WebSocket against
// `wss://chat.test/socket` during unit tests.

import { vi } from 'vitest';

// `@poolse/sdk` is consumed from its built `dist/` (tsup bundles
// `phoenix` inline), so the `vi.mock('phoenix', …)` below doesn't
// intercept the inlined copy that the dist ships with. To stop the
// real Phoenix client from scheduling a LongPoll setTimeout that
// fires after happy-dom is torn down (and then throws "No suitable
// XMLHttpRequest implementation found"), kill XHR up front — Phoenix
// fails its first poll synchronously and never reschedules. Mirrors
// the same trick used in `packages/react/test/setup.ts`.
(globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = undefined;

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
