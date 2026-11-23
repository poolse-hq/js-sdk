import type { Message } from '@poolse/sdk';

/** `confirmDelete`: true deletes. May ask asynchronously (your own sheet). */
export type ConfirmDelete = (msg: Message) => boolean | Promise<boolean>;

/** Ask, then delete; a failed delete is left to the caller's error state. */
export async function confirmThenDelete(
  msg: Message,
  confirm: ConfirmDelete,
  remove: (id: string) => Promise<unknown>,
): Promise<void> {
  if (!(await confirm(msg))) return;
  await remove(msg.id).catch(() => undefined);
}
