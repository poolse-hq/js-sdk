// ThreadSummary — the line under a thread root: up to three stacked
// avatars of the people who replied, "N replies · last reply 5m ago".
// Clicking opens the thread. `thread:updated` keeps the root's
// `reply_count`, `last_reply_at` and `thread_participants` current in
// `useMessages`, so this follows along without its own subscription.

import type { Message, ThreadParticipant } from '@poolse/sdk';
import { useUser } from '@poolse/react';
import { Avatar } from './Avatar.js';
import { PoolseIcon } from './PoolseIcon.js';
import { formatRelativeTime, useNow } from './relativeTime.js';

export interface ThreadSummaryProps {
  /** The thread's root message. Renders nothing without replies. */
  message: Message;
  /** Open the thread (e.g. `<ThreadView>`). */
  onOpen?: () => void;
  /** How many participant avatars to stack. Defaults to 3. */
  maxAvatars?: number;
  className?: string;
}

export function ThreadSummary({ message, onOpen, maxAvatars = 3, className }: ThreadSummaryProps) {
  const now = useNow();
  const count = message.reply_count ?? 0;
  if (count <= 0) return null;
  const participants = (message.thread_participants ?? []).slice(0, maxAvatars);
  const replies = `${count} ${count === 1 ? 'reply' : 'replies'}`;
  const last = formatRelativeTime(message.last_reply_at, now);

  return (
    <button
      type="button"
      className={['poolse-thread-summary', className].filter(Boolean).join(' ')}
      onClick={onOpen}
      aria-label={`View ${replies}`}
    >
      {participants.length > 0 ? (
        <span className="poolse-thread-summary__avatars" aria-hidden="true">
          {participants.map((p) => (
            <ParticipantAvatar key={p.user_id} participant={p} />
          ))}
        </span>
      ) : (
        <PoolseIcon name="messages" size={12} label={null} />
      )}
      <span className="poolse-thread-summary__count">{replies}</span>
      {last ? <span className="poolse-thread-summary__last">· last reply {last}</span> : null}
    </button>
  );
}

function ParticipantAvatar({ participant }: { participant: ThreadParticipant }) {
  const { profile } = useUser(participant.external_id);
  const name = profile?.displayName ?? participant.external_id ?? 'Someone';
  return <Avatar src={profile?.avatarUrl ?? null} name={name} size="xs" />;
}
