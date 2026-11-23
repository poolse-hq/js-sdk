import type { Message } from '@poolse/sdk';
import { describe, expect, it, vi } from 'vitest';
import { confirmThenDelete } from '../src/internal/confirmDelete.js';

const msg = { id: 'm-1' } as Message;

describe('confirmThenDelete', () => {
  it('deletes only after the confirmation says yes', async () => {
    const remove = vi.fn(async () => undefined);
    await confirmThenDelete(msg, async () => false, remove);
    expect(remove).not.toHaveBeenCalled();
    await confirmThenDelete(msg, () => true, remove);
    expect(remove).toHaveBeenCalledWith('m-1');
  });

  it('swallows a failed delete (the row shows its own error)', async () => {
    await expect(
      confirmThenDelete(msg, () => true, async () => Promise.reject(new Error('nope'))),
    ).resolves.toBeUndefined();
  });
});
