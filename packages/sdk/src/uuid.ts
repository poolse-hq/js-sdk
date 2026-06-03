// Cross-runtime UUID v4 generator. Used internally for idempotency
// keys, client-side message ids, and upload queue local ids — all
// places that need a unique-per-call opaque string but NOT cryptographic
// strength (the server enforces real auth and dedup; collisions here
// only matter for in-process bookkeeping).
//
// Resolution order:
//   1. `globalThis.crypto.randomUUID()` if present (browsers in secure
//      contexts, Node ≥ 19, Bun, Deno, Hermes ≥ 0.74 — modern path).
//   2. `globalThis.crypto.getRandomValues()` + RFC 4122 v4 framing
//      (covers RN apps that ship `react-native-get-random-values`).
//   3. `Math.random()` byte fill + RFC 4122 v4 framing (last resort —
//      enough entropy for in-process keys, never used as a security
//      primitive).
//
// This function is also exported as `safeUuid` so RN consumers can
// reuse it for their own `generateIdempotencyKey` config if they
// want, but the default already uses it — no setup required.

export function safeUuid(): string {
  const c = (
    globalThis as {
      crypto?: {
        randomUUID?: () => string;
        getRandomValues?: (a: Uint8Array) => Uint8Array;
      };
    }
  ).crypto;

  if (c?.randomUUID) return c.randomUUID();

  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex: string[] = [];
  for (let i = 0; i < 16; i++) {
    hex.push(bytes[i]!.toString(16).padStart(2, '0'));
  }
  return (
    hex.slice(0, 4).join('') +
    '-' +
    hex.slice(4, 6).join('') +
    '-' +
    hex.slice(6, 8).join('') +
    '-' +
    hex.slice(8, 10).join('') +
    '-' +
    hex.slice(10).join('')
  );
}
