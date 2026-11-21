import { expect } from 'vitest';
import { PoolseCryptoError, type PoolseCryptoErrorCode } from '../src';

/** Expect `promise` to reject with a PoolseCryptoError (of `code`, if given). */
export async function expectCryptoError(
  promise: Promise<unknown>,
  code?: PoolseCryptoErrorCode | PoolseCryptoErrorCode[],
): Promise<PoolseCryptoError> {
  let error: unknown;
  try {
    await promise;
  } catch (e) {
    error = e;
  }
  expect(error, 'expected a PoolseCryptoError').toBeInstanceOf(PoolseCryptoError);
  const err = error as PoolseCryptoError;
  if (code !== undefined) expect(Array.isArray(code) ? code : [code]).toContain(err.code);
  return err;
}

/**
 * Flip every bit of `data`, one at a time, and check that `open` refuses
 * each altered copy. Returns the error codes seen, for spot checks.
 */
export async function expectEveryBitFlipRejected(
  data: Uint8Array,
  open: (altered: Uint8Array) => Promise<unknown>,
): Promise<Set<PoolseCryptoErrorCode>> {
  const codes = new Set<PoolseCryptoErrorCode>();
  for (let i = 0; i < data.length; i++) {
    for (let bit = 0; bit < 8; bit++) {
      const altered = new Uint8Array(data);
      altered[i] = (altered[i] as number) ^ (1 << bit);
      let error: unknown = null;
      try {
        await open(altered);
      } catch (e) {
        error = e;
      }
      if (!(error instanceof PoolseCryptoError)) {
        throw new Error(`bit ${bit} of byte ${i} flipped was not rejected (${String(error)})`);
      }
      codes.add(error.code);
    }
  }
  return codes;
}
