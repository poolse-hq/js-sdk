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
