// Hooks for messaging plus (docs/MESSAGING_PLUS.md): a live poll with
// optimistic votes (MS3), pins (MS13), thread follow (MS19), catch-up
// (MS20), translation (MS21), scheduled messages (MS1) and the files
// list (MS18). Each one is small; the components in @poolse/react-ui and
// @poolse/react-native take their results as props.

import {
  applyLocalVote,
  isPollClosed,
  toggleVote,
  type Attachment,
  type AttachmentKind,
  type CatchUp,
  type CatchUpRequest,
  type Message,
  type MessageTranslation,
  type Poll,
  type ScheduledMessage,
  type ScheduleMessageRequest,
  type Uuid,
} from '@poolse/sdk';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePoolse } from './provider.js';

export interface UsePoll {
  poll: Poll | null;
  myOptionIds: string[];
  closed: boolean;
  /** Tap an option: replaces (single choice) or toggles (multiple). Optimistic. */
  toggle: (optionId: string) => Promise<void>;
  /** Take your votes back. */
  clear: () => Promise<void>;
  /** Close the poll (its sender or an owner/admin). */
  close: () => Promise<void>;
  pending: boolean;
  error: unknown;
}

/** A poll message's live state: seeded from the message, kept current by `poll:updated`. */
export function usePoll(
  message: Pick<Message, 'id' | 'conversation_id' | 'poll' | 'my_option_ids'>,
): UsePoll {
  const chat = usePoolse();
  const [poll, setPoll] = useState<Poll | null>(message.poll ?? null);
  const [mine, setMine] = useState<string[]>(message.my_option_ids ?? []);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const mineRef = useRef(mine);
  mineRef.current = mine;
  const pollRef = useRef(poll);
  pollRef.current = poll;

  // Follow the message's own copy when it changes (a refetch, `message:updated`),
  // compared by value so a fresh object with the same content doesn't reset.
  const pollKey = JSON.stringify(message.poll ?? null);
  const mineKey = JSON.stringify(message.my_option_ids ?? null);
  useEffect(() => {
    setPoll(JSON.parse(pollKey) as Poll | null);
  }, [pollKey]);
  useEffect(() => {
    const m = JSON.parse(mineKey) as string[] | null;
    if (m) setMine(m);
  }, [mineKey]);

  useEffect(() => {
    const conv = chat.realtime.conversation(message.conversation_id);
    return conv.onPollUpdated((evt) => {
      if (evt.message_id === message.id) setPoll(evt.poll);
    });
  }, [chat, message.id, message.conversation_id]);

  const write = useCallback(
    async (next: string[]) => {
      const before = mineRef.current;
      const p = pollRef.current;
      if (!p) return;
      const me = chat.me.peek()?.id;
      setMine(next);
      setPoll(applyLocalVote(p, before, next, me));
      setPending(true);
      setError(null);
      try {
        const res = await chat.messages.one(message.id).vote(next);
        setPoll(res.poll);
        setMine(res.my_option_ids);
      } catch (err) {
        setMine(before);
        setPoll(p);
        setError(err);
      } finally {
        setPending(false);
      }
    },
    [chat, message.id],
  );

  const closed = poll ? isPollClosed(poll) : true;
  return {
    poll,
    myOptionIds: mine,
    closed,
    pending,
    error,
    toggle: async (optionId) => {
      const p = pollRef.current;
      if (!p || isPollClosed(p)) return;
      await write(toggleVote(p, mineRef.current, optionId));
    },
    clear: () => write([]),
    close: async () => {
      setError(null);
      try {
        const res = await chat.messages.one(message.id).closePoll();
        setPoll(res.poll);
      } catch (err) {
        setError(err);
      }
    },
  };
}

export interface UsePins {
  pins: Message[];
  loading: boolean;
  error: unknown;
  pin: (messageId: Uuid) => Promise<void>;
  unpin: (messageId: Uuid) => Promise<void>;
  refresh: () => Promise<void>;
}

/** A conversation's pinned messages, refreshed on `pin:added` / `pin:removed`. */
export function usePins(conversationId: Uuid): UsePins {
  const chat = usePoolse();
  const [pins, setPins] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const refresh = useCallback(async () => {
    try {
      setPins(await chat.conversations.one(conversationId).messages.pins());
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [chat, conversationId]);

  useEffect(() => {
    setLoading(true);
    void refresh();
    const conv = chat.realtime.conversation(conversationId);
    return conv.onPinChanged(() => void refresh());
  }, [chat, conversationId, refresh]);

  return {
    pins,
    loading,
    error,
    refresh,
    pin: async (id) => {
      await chat.messages.one(id).pin();
      await refresh();
    },
    unpin: async (id) => {
      setPins((p) => p.filter((m) => m.id !== id));
      await chat.messages.one(id).unpin();
      await refresh();
    },
  };
}

export interface UseThreadFollow {
  /** `null` until known. */
  following: boolean | null;
  setFollowing: (on: boolean) => Promise<void>;
  error: unknown;
}

/** Whether you follow a thread (who gets a push for its replies). */
export function useThreadFollow(rootId: Uuid | null | undefined): UseThreadFollow {
  const chat = usePoolse();
  const [following, setState] = useState<boolean | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (!rootId) return;
    let live = true;
    setState(null);
    chat.messages
      .one(rootId)
      .followState()
      .then((s) => live && setState(s.following))
      .catch((err: unknown) => live && setError(err));
    return () => {
      live = false;
    };
  }, [chat, rootId]);
  return {
    following,
    error,
    setFollowing: async (on) => {
      if (!rootId) return;
      const before = following;
      setState(on);
      try {
        setState((await chat.messages.one(rootId).setFollow(on)).following);
      } catch (err) {
        setState(before);
        setError(err);
      }
    },
  };
}

export interface UseCatchUp {
  result: CatchUp | null;
  loading: boolean;
  error: unknown;
  run: (opts?: CatchUpRequest) => Promise<CatchUp | null>;
}

/** "What did I miss" on demand: `run()` asks the server (nothing is stored). */
export function useCatchUp(conversationId: Uuid): UseCatchUp {
  const chat = usePoolse();
  const [result, setResult] = useState<CatchUp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return {
    result,
    loading,
    error,
    run: async (opts) => {
      setLoading(true);
      setError(null);
      try {
        const r = await chat.conversations.one(conversationId).messages.catchUp(opts);
        setResult(r);
        return r;
      } catch (err) {
        setError(err);
        return null;
      } finally {
        setLoading(false);
      }
    },
  };
}

export interface UseTranslation {
  translation: MessageTranslation | null;
  loading: boolean;
  error: unknown;
  /** Show the translation (fetched once per language). */
  translate: () => Promise<void>;
  /** Back to the original. */
  reset: () => void;
}

/** Translate one message into `language` on demand (the member's preferred language). */
export function useTranslation(messageId: Uuid, language: string): UseTranslation {
  const chat = usePoolse();
  const [translation, setTranslation] = useState<MessageTranslation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => setTranslation(null), [messageId, language]);
  return {
    translation,
    loading,
    error,
    reset: () => setTranslation(null),
    translate: async () => {
      setLoading(true);
      setError(null);
      try {
        setTranslation(await chat.messages.one(messageId).translate(language));
      } catch (err) {
        setError(err);
      } finally {
        setLoading(false);
      }
    },
  };
}

export interface UseScheduledMessages {
  scheduled: ScheduledMessage[];
  loading: boolean;
  error: unknown;
  schedule: (conversationId: Uuid, req: ScheduleMessageRequest) => Promise<ScheduledMessage>;
  cancel: (id: Uuid) => Promise<void>;
  sendNow: (id: Uuid) => Promise<void>;
  reschedule: (id: Uuid, sendAt: string) => Promise<void>;
  refresh: () => Promise<void>;
}

/** Your scheduled messages (optionally in one conversation), kept current by the user-topic events. */
export function useScheduledMessages(conversationId?: Uuid): UseScheduledMessages {
  const chat = usePoolse();
  const [scheduled, setScheduled] = useState<ScheduledMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const refresh = useCallback(async () => {
    try {
      setScheduled(
        await chat.scheduledMessages.list(
          conversationId ? { conversation_id: conversationId } : {},
        ),
      );
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [chat, conversationId]);
  useEffect(() => {
    void refresh();
    const me = chat.me.peek()?.id;
    if (!me) return;
    return chat.realtime.user(me).onScheduledMessage(() => void refresh());
  }, [chat, refresh]);
  return {
    scheduled,
    loading,
    error,
    refresh,
    schedule: async (cid, req) => {
      const s = await chat.conversations.one(cid).messages.schedule(req);
      await refresh();
      return s;
    },
    cancel: async (id) => {
      setScheduled((l) => l.filter((s) => s.id !== id));
      await chat.scheduledMessages.cancel(id);
    },
    sendNow: async (id) => {
      setScheduled((l) => l.filter((s) => s.id !== id));
      await chat.scheduledMessages.sendNow(id);
    },
    reschedule: async (id, sendAt) => {
      await chat.scheduledMessages.update(id, { send_at: sendAt });
      await refresh();
    },
  };
}

export interface UseFiles {
  files: Attachment[];
  loading: boolean;
  error: unknown;
  hasMore: boolean;
  loadMore: () => Promise<void>;
}

/** A conversation's files, newest first, page by page; new versions arrive on `attachment:processed`. */
export function useFiles(conversationId: Uuid, kind?: AttachmentKind): UseFiles {
  const chat = usePoolse();
  const [files, setFiles] = useState<Attachment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(
    async (before: string | null) => {
      setLoading(true);
      try {
        const page = await chat.conversations
          .one(conversationId)
          .messages.files({ ...(kind ? { kind } : {}), ...(before ? { before } : {}) });
        setFiles((f) => (before ? [...f, ...page.data] : page.data));
        setCursor(page.next_cursor);
        setHasMore(page.next_cursor !== null);
        setError(null);
      } catch (err) {
        setError(err);
      } finally {
        setLoading(false);
      }
    },
    [chat, conversationId, kind],
  );
  useEffect(() => {
    void load(null);
    const conv = chat.realtime.conversation(conversationId);
    return conv.onAttachmentProcessed((evt) => {
      if (kind && evt.attachment.kind !== kind) return;
      setFiles((f) => {
        const group = evt.attachment.version_group_id;
        const rest = f.filter(
          (a) => a.id !== evt.attachment.id && (!group || a.version_group_id !== group),
        );
        return [evt.attachment, ...rest];
      });
    });
  }, [chat, conversationId, kind, load]);
  return {
    files,
    loading,
    error,
    hasMore,
    loadMore: async () => {
      if (cursor) await load(cursor);
    },
  };
}
