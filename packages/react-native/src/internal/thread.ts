// Thread summary text — pure, so vitest can run it under node.

import { relativeTime } from './time.js';

/** "1 reply", "3 replies · last reply 5m ago". Empty without replies. */
export function threadSummaryText(
  replyCount: number,
  lastReplyAt: string | null | undefined,
  now: Date | number = Date.now(),
): string {
  if (!replyCount || replyCount <= 0) return '';
  const count = `${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}`;
  const ago = relativeTime(lastReplyAt, now);
  return ago ? `${count} · last reply ${ago}` : count;
}

/** Up to `max` distinct participant ids (external id, else user id), most recent first. */
export function stackedParticipants(
  participants: ReadonlyArray<{ user_id: string; external_id: string | null }> | undefined,
  max = 3,
): Array<{ key: string; externalId: string | null }> {
  const out: Array<{ key: string; externalId: string | null }> = [];
  const seen = new Set<string>();
  for (const p of participants ?? []) {
    const key = p.external_id ?? p.user_id;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, externalId: p.external_id });
    if (out.length >= max) break;
  }
  return out;
}
