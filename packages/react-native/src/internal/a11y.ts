// What a screen reader says for a message row — pure, so vitest can
// run it under node.

import type { Message } from '@poolse/sdk';

/** "You: see you at 3", "Ana: photo, 2 attachments", "Ana: message deleted". */
export function messageA11yLabel(msg: Message, senderName: string, isSelf: boolean): string {
  const who = isSelf ? 'You' : senderName;
  if (msg.deleted_at) return `${who}: message deleted`;
  const parts: string[] = [];
  const body = (msg.body ?? '').trim();
  if (body) parts.push(body.length > 300 ? `${body.slice(0, 300)}…` : body);
  const files = Array.isArray(msg.attachments) ? msg.attachments.length : 0;
  if (files > 0) parts.push(files === 1 ? '1 attachment' : `${files} attachments`);
  if (msg.edited_at) parts.push('edited');
  if (msg.local_status === 'queued') parts.push('waiting for network');
  if (msg.local_status === 'failed') parts.push('not sent');
  return `${who}: ${parts.join(', ') || 'message'}`;
}

/** "👍 3, you reacted". */
export function reactionA11yLabel(emoji: string, count: number, mine: boolean): string {
  return `${emoji} ${count}${mine ? ', you reacted' : ''}`;
}
