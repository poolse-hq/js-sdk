import type { Uuid } from '@poolse/sdk';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePoolse } from './provider.js';

/**
 * Map of emoji → list of user_ids who reacted with it. Matches the
 * shape of `Message.reactions` so initial seeding from a message you
 * already have in state is a direct assignment.
 */
export type ReactionMap = Record<string, Uuid[]>;

interface UseReactionsState {
  reactions: ReactionMap;
  /** Add the caller's reaction (idempotent server-side). */
  addReaction: (emoji: string) => Promise<void>;
  /** Remove the caller's reaction. No-op if not present. */
  removeReaction: (emoji: string) => Promise<void>;
}

interface UseReactionsOptions {
  /**
   * Required for the in-channel subscription — the realtime layer
   * routes reaction events through the conversation channel, not a
   * per-message channel. Pass the conversation id you already know.
   */
  conversationId: Uuid;
  /**
   * Seed the local reaction map from a message you already have
   * (e.g. from `useMessages`). Without this the hook starts empty
   * and only sees deltas from the realtime stream.
   */
  initialReactions?: ReactionMap;
  /**
   * Current user's id. When provided, optimistic mutate updates the
   * local map immediately for that user; when omitted, we wait for
   * the server's `reaction:added` echo to update state.
   */
  currentUserId?: Uuid | null;
}

/**
 * Live reaction map for a single message. Subscribes to
 * `reaction:added` / `reaction:removed` realtime events filtered to
 * `messageId`, and provides mutation helpers.
 *
 * ```ts
 * const { reactions, addReaction } = useReactions(msg.id, {
 *   conversationId: msg.conversation_id,
 *   initialReactions: msg.reactions,
 *   currentUserId: me?.id,
 * });
 * <button onClick={() => addReaction('🎉')}>🎉 {reactions['🎉']?.length ?? 0}</button>
 * ```
 */
export function useReactions(messageId: Uuid, opts: UseReactionsOptions): UseReactionsState {
  const chat = usePoolse();
  const [reactions, setReactions] = useState<ReactionMap>(opts.initialReactions ?? {});

  // Keep currentUserId in a ref so the realtime callbacks (set up in
  // the mount effect) always see the latest value without having to
  // re-subscribe when it changes.
  const currentUserIdRef = useRef<Uuid | null>(opts.currentUserId ?? null);
  currentUserIdRef.current = opts.currentUserId ?? null;

  // Shadow ref of the latest committed reactions map — used by
  // `removeReaction` for synchronous snapshot capture so the
  // optimistic rollback isn't racing the React updater queue.
  const reactionsRef = useRef<ReactionMap>(reactions);
  reactionsRef.current = reactions;

  useEffect(() => {
    const conv = chat.realtime.conversation(opts.conversationId);

    const offAdded = conv.onReactionAdded((evt) => {
      if (evt.message_id !== messageId) return;
      setReactions((prev) => addUser(prev, evt.emoji, evt.user_id));
    });

    const offRemoved = conv.onReactionRemoved((evt) => {
      if (evt.message_id !== messageId) return;
      setReactions((prev) => removeUser(prev, evt.emoji, evt.user_id));
    });

    return () => {
      offAdded();
      offRemoved();
    };
  }, [chat, opts.conversationId, messageId]);

  const addReaction = useCallback(
    async (emoji: string) => {
      const uid = currentUserIdRef.current;
      // Optimistic add when we know who we are; otherwise wait for echo.
      if (uid) setReactions((prev) => addUser(prev, emoji, uid));
      try {
        await chat.messages.one(messageId).addReaction(emoji);
      } catch (err) {
        if (uid) setReactions((prev) => removeUser(prev, emoji, uid));
        throw err;
      }
    },
    [chat, messageId],
  );

  const removeReaction = useCallback(
    async (emoji: string) => {
      const uid = currentUserIdRef.current;
      const snapshot = reactionsRef.current;
      if (uid) setReactions((prev) => removeUser(prev, emoji, uid));
      try {
        await chat.messages.one(messageId).removeReaction(emoji);
      } catch (err) {
        if (uid) setReactions(snapshot);
        throw err;
      }
    },
    [chat, messageId],
  );

  return { reactions, addReaction, removeReaction };
}

function addUser(prev: ReactionMap, emoji: string, userId: Uuid): ReactionMap {
  const existing = prev[emoji] ?? [];
  if (existing.includes(userId)) return prev;
  return { ...prev, [emoji]: [...existing, userId] };
}

function removeUser(prev: ReactionMap, emoji: string, userId: Uuid): ReactionMap {
  const existing = prev[emoji];
  if (!existing || !existing.includes(userId)) return prev;
  const next = existing.filter((id) => id !== userId);
  if (next.length === 0) {
    const { [emoji]: _, ...rest } = prev;
    return rest;
  }
  return { ...prev, [emoji]: next };
}
