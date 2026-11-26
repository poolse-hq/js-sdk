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
import { useMeId } from './capture-state.js';
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
  // Only the newest read writes: an older one (another conversation's,
  // after a switch) is dropped.
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const next = await chat.conversations.one(conversationId).messages.pins();
      if (mine !== seq.current) return;
      setPins(next);
      setError(null);
    } catch (err) {
      if (mine === seq.current) setError(err);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [chat, conversationId]);

  useEffect(() => {
    setPins([]);
    setError(null);
    setLoading(true);
    void refresh();
    const conv = chat.realtime.conversation(conversationId);
    const off = conv.onPinChanged(() => void refresh());
    return () => {
      seq.current++;
      off();
    };
  }, [chat, conversationId, refresh]);

  const pin = useCallback(
    async (id: Uuid) => {
      await chat.messages.one(id).pin();
      await refresh();
    },
    [chat, refresh],
  );
  const unpin = useCallback(
    async (id: Uuid) => {
      setPins((p) => p.filter((m) => m.id !== id));
      await chat.messages.one(id).unpin();
      await refresh();
    },
    [chat, refresh],
  );

  return { pins, loading, error, refresh, pin, unpin };
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
  const setFollowing = useCallback(
    async (on: boolean) => {
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
    [chat, rootId, following],
  );
  return { following, error, setFollowing };
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
  const current = useRef(conversationId);
  current.current = conversationId;
  useEffect(() => {
    setResult(null);
    setError(null);
  }, [conversationId]);
  const run = useCallback(
    async (opts?: CatchUpRequest) => {
      setLoading(true);
      setError(null);
      try {
        const r = await chat.conversations.one(conversationId).messages.catchUp(opts);
        if (current.current !== conversationId) return null;
        setResult(r);
        return r;
      } catch (err) {
        if (current.current === conversationId) setError(err);
        return null;
      } finally {
        if (current.current === conversationId) setLoading(false);
      }
    },
    [chat, conversationId],
  );
  return { result, loading, error, run };
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
  // A translation that lands after the message or language changed is
  // for something no longer shown.
  const key = `${messageId}\u0000${language}`;
  const current = useRef(key);
  current.current = key;
  useEffect(() => {
    setTranslation(null);
    setError(null);
    setLoading(false);
  }, [messageId, language]);
  const reset = useCallback(() => setTranslation(null), []);
  const translate = useCallback(async () => {
    const asked = `${messageId}\u0000${language}`;
    setLoading(true);
    setError(null);
    try {
      const t = await chat.messages.one(messageId).translate(language);
      if (current.current === asked) setTranslation(t);
    } catch (err) {
      if (current.current === asked) setError(err);
    } finally {
      if (current.current === asked) setLoading(false);
    }
  }, [chat, messageId, language]);
  return { translation, loading, error, reset, translate };
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
  const seq = useRef(0);
  // Known only after `GET /v1/me` on a cold start: follow the user topic
  // from then on, not only when the user was already known at mount.
  const meId = useMeId(chat);
  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const list = await chat.scheduledMessages.list(
        conversationId ? { conversation_id: conversationId } : {},
      );
      if (mine !== seq.current) return;
      setScheduled(list);
      setError(null);
    } catch (err) {
      if (mine === seq.current) setError(err);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [chat, conversationId]);
  useEffect(() => {
    setScheduled([]);
    setLoading(true);
    void refresh();
    return () => {
      seq.current++;
    };
  }, [refresh]);
  useEffect(() => {
    if (!meId) return;
    return chat.realtime.user(meId).onScheduledMessage(() => void refresh());
  }, [chat, meId, refresh]);
  const schedule = useCallback(
    async (cid: Uuid, req: ScheduleMessageRequest) => {
      const s = await chat.conversations.one(cid).messages.schedule(req);
      await refresh();
      return s;
    },
    [chat, refresh],
  );
  const cancel = useCallback(
    async (id: Uuid) => {
      setScheduled((l) => l.filter((s) => s.id !== id));
      await chat.scheduledMessages.cancel(id);
    },
    [chat],
  );
  const sendNow = useCallback(
    async (id: Uuid) => {
      setScheduled((l) => l.filter((s) => s.id !== id));
      await chat.scheduledMessages.sendNow(id);
    },
    [chat],
  );
  const reschedule = useCallback(
    async (id: Uuid, sendAt: string) => {
      await chat.scheduledMessages.update(id, { send_at: sendAt });
      await refresh();
    },
    [chat, refresh],
  );
  return { scheduled, loading, error, refresh, schedule, cancel, sendNow, reschedule };
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
  // Bumped when the conversation or kind changes: a page that lands after
  // that is another list's.
  const epoch = useRef(0);
  const load = useCallback(
    async (before: string | null) => {
      const mine = epoch.current;
      setLoading(true);
      try {
        const page = await chat.conversations
          .one(conversationId)
          .messages.files({ ...(kind ? { kind } : {}), ...(before ? { before } : {}) });
        if (mine !== epoch.current) return;
        setFiles((f) => {
          const have = new Set(f.map((a) => a.id));
          if (before) return [...f, ...page.data.filter((a) => !have.has(a.id))];
          // The first page: files that arrived live meanwhile stay on top.
          const inPage = new Set(page.data.map((a) => a.id));
          return [...f.filter((a) => !inPage.has(a.id)), ...page.data];
        });
        setCursor(page.next_cursor);
        setHasMore(page.next_cursor !== null);
        setError(null);
      } catch (err) {
        if (mine === epoch.current) setError(err);
      } finally {
        if (mine === epoch.current) setLoading(false);
      }
    },
    [chat, conversationId, kind],
  );
  useEffect(() => {
    setFiles([]);
    setCursor(null);
    setHasMore(false);
    setError(null);
    void load(null);
    const conv = chat.realtime.conversation(conversationId);
    const off = conv.onAttachmentProcessed((evt) => {
      if (kind && evt.attachment.kind !== kind) return;
      setFiles((f) => {
        const group = evt.attachment.version_group_id;
        const rest = f.filter(
          (a) => a.id !== evt.attachment.id && (!group || a.version_group_id !== group),
        );
        return [evt.attachment, ...rest];
      });
    });
    return () => {
      epoch.current++;
      off();
    };
  }, [chat, conversationId, kind, load]);
  const loadMore = useCallback(async () => {
    if (cursor) await load(cursor);
  }, [cursor, load]);
  return { files, loading, error, hasMore, loadMore };
}
