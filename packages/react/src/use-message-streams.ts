import { useEffect, useState } from 'react';
import type { Uuid } from '@poolse/sdk';
import { usePoolse } from './provider.js';

/** An AI agent's reply that's still being written. */
export interface MessageStream {
  /** Becomes the finished message's id. */
  id: Uuid;
  conversation_id: Uuid;
  sender_id: Uuid;
  sender_external_id: string | null;
  /** The text so far; empty until the first delta. */
  text: string;
  status: 'streaming' | 'failed';
  error?: string;
}

// A failed reply stays visible briefly so the user sees it didn't work.
const FAILED_TTL_MS = 8000;
// A stream that goes quiet this long (dropped socket, crashed run) is dropped.
const STALE_MS = 90_000;

/**
 * AI agent replies being written in `conversationId`, oldest first.
 *
 * Built from `message:stream` events: `started` adds a stream, each
 * `delta` appends text, `failed` marks it failed (removed after a few
 * seconds). When the finished reply arrives as `message:new` with the
 * same id, the stream is removed — `useMessages` shows the message.
 */
export function useMessageStreams(conversationId: string): MessageStream[] {
  const chat = usePoolse();
  const [streams, setStreams] = useState<MessageStream[]>([]);

  useEffect(() => {
    setStreams([]);
    const timers = new Map<Uuid, ReturnType<typeof setTimeout>>();

    const remove = (id: Uuid) => {
      const t = timers.get(id);
      if (t) clearTimeout(t);
      timers.delete(id);
      setStreams((prev) =>
        prev.some((s) => s.id === id) ? prev.filter((s) => s.id !== id) : prev,
      );
    };

    const arm = (id: Uuid, ms: number) => {
      const t = timers.get(id);
      if (t) clearTimeout(t);
      timers.set(
        id,
        setTimeout(() => remove(id), ms),
      );
    };

    const conv = chat.realtime.conversation(conversationId);

    const offStream = conv.onMessageStream((evt) => {
      setStreams((prev) => {
        const existing = prev.find((s) => s.id === evt.id);
        // A client that joins mid-reply sees deltas without `started`.
        const base: MessageStream = existing ?? {
          id: evt.id,
          conversation_id: evt.conversation_id,
          sender_id: evt.sender_id,
          sender_external_id: evt.sender_external_id ?? null,
          text: '',
          status: 'streaming',
        };

        let next: MessageStream;
        if (evt.status === 'delta') next = { ...base, text: base.text + (evt.delta ?? '') };
        else if (evt.status === 'failed')
          next = { ...base, status: 'failed', ...(evt.error ? { error: evt.error } : {}) };
        else
          next = { ...base, sender_external_id: evt.sender_external_id ?? base.sender_external_id };

        return existing ? prev.map((s) => (s.id === evt.id ? next : s)) : [...prev, next];
      });
      arm(evt.id, evt.status === 'failed' ? FAILED_TTL_MS : STALE_MS);
    });

    const offMessage = conv.onMessage((msg) => remove(msg.id));

    return () => {
      offStream();
      offMessage();
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, [chat, conversationId]);

  return streams;
}
