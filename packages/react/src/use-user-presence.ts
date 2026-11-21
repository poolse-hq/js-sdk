// Presence of people (online / away / in a call / offline), read from
// the store `poolse.presence` keeps — one per `<PoolseProvider>`. Every
// hook mounted in the same tick shares one lookup, and
// `presence:changed` on the user's channel keeps them all live.
//
// Not to be confused with `usePresence(conversationId)`, which lists who
// has a conversation open right now (the conversation channel's
// Phoenix.Presence).

import type { Presence } from '@poolse/sdk';
import { useEffect, useMemo, useState } from 'react';
import { usePoolse } from './provider.js';

/**
 * One user's presence, by internal user id or `external_id`. Null until
 * it is known (and for ids the server doesn't know); pass null / '' to
 * opt out.
 *
 * ```tsx
 * const presence = useUserPresence(member.external_id);
 * <Avatar badge={presence?.state === 'online' ? 'green' : undefined} />
 * ```
 *
 * `presence.do_not_disturb` / `dnd_until` come from the lookup and
 * aren't evented: they can be stale until the next lookup (a reconnect).
 */
export function useUserPresence(id: string | null | undefined): Presence | null {
  const chat = usePoolse();
  const [presence, setPresence] = useState<Presence | null>(() =>
    id ? (chat.presence.peek(id) ?? null) : null,
  );

  useEffect(() => {
    if (!id) {
      setPresence(null);
      return;
    }
    setPresence(chat.presence.peek(id) ?? null);
    return chat.presence.subscribe(id, () => setPresence(chat.presence.peek(id) ?? null));
  }, [chat, id]);

  return presence;
}

/**
 * Several users' presence at once, keyed by the ids passed (internal
 * user ids or `external_id`s). Ids not yet known are absent from the
 * record. The array may be a fresh literal on every render.
 *
 * ```tsx
 * const presences = usePresenceMany(members.map((m) => m.external_id));
 * const online = members.filter((m) => presences[m.external_id]?.state === 'online');
 * ```
 */
export function usePresenceMany(
  ids: readonly (string | null | undefined)[],
): Record<string, Presence> {
  const chat = usePoolse();
  // A stable key, so a new array with the same ids doesn't resubscribe.
  const key = useMemo(
    () => JSON.stringify([...new Set(ids.filter((id): id is string => !!id))].sort()),
    [ids],
  );
  const [presences, setPresences] = useState<Record<string, Presence>>(() =>
    collect(chat.presence.peek.bind(chat.presence), JSON.parse(key) as string[]),
  );

  useEffect(() => {
    const list = JSON.parse(key) as string[];
    const read = () => setPresences(collect(chat.presence.peek.bind(chat.presence), list));
    read();
    if (list.length === 0) return;
    return chat.presence.subscribe(list, read);
  }, [chat, key]);

  return presences;
}

function collect(
  peek: (id: string) => Presence | undefined,
  ids: readonly string[],
): Record<string, Presence> {
  const out: Record<string, Presence> = {};
  for (const id of ids) {
    const p = peek(id);
    if (p) out[id] = p;
  }
  return out;
}
