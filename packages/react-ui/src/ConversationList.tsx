// ConversationList — sidebar of the user's conversations.
//
// Default rendering is a Slack/Discord-style list with avatar +
// name + last-message preview + timestamp. Customers swap rows
// via `renderItem` for full layout control.
//
// Powered by `useConversations` so the list updates in real time
// when the user is added to a new conversation (no refetch).

import type { Conversation } from '@poolse/sdk';
import { useConversations } from '@poolse/react';
import { type ReactNode } from 'react';
import { Avatar } from './Avatar.js';

export interface ConversationListProps {
  /** Currently selected conversation id — sets `aria-current` + selected styling. */
  selectedId?: string | null;
  /** Click handler — typical use is to update routing / selectedId state. */
  onSelect?: (conv: Conversation) => void;
  /** Optional override for each row's rendering. */
  renderItem?: (conv: Conversation, selected: boolean) => ReactNode;
  /** Custom empty state when there are no conversations. */
  emptyState?: ReactNode;
}

export function ConversationList({
  selectedId,
  onSelect,
  renderItem,
  emptyState,
}: ConversationListProps) {
  const { conversations, loading, error } = useConversations();

  if (loading && conversations.length === 0) {
    return <div className="poolse-list poolse-list--placeholder">Loading conversations…</div>;
  }

  if (error) {
    return (
      <div className="poolse-list poolse-list--placeholder poolse-list--error">
        Failed to load conversations.
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="poolse-list poolse-list--placeholder">
        {emptyState ?? 'No conversations yet.'}
      </div>
    );
  }

  return (
    <ul className="poolse-list" role="listbox" aria-label="Conversations">
      {conversations.map((conv) => {
        const selected = selectedId === conv.id;
        const content = renderItem ? (
          renderItem(conv, selected)
        ) : (
          <DefaultRow conv={conv} selected={selected} />
        );
        return (
          <li
            key={conv.id}
            role="option"
            aria-selected={selected}
            className={`poolse-list__item${selected ? ' poolse-list__item--selected' : ''}`}
            onClick={() => onSelect?.(conv)}
            // Keyboard activation — Enter / Space behave like click.
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect?.(conv);
              }
            }}
            tabIndex={0}
          >
            {content}
          </li>
        );
      })}
    </ul>
  );
}

function DefaultRow({ conv, selected: _selected }: { conv: Conversation; selected: boolean }) {
  const title = conv.name ?? 'Untitled conversation';
  const time = conv.last_message_at ? formatRelative(conv.last_message_at) : '';

  return (
    <>
      <Avatar src={conv.avatar_url ?? null} name={conv.name} size="md" />
      <div className="poolse-list__body">
        <div className="poolse-list__head">
          <span className="poolse-list__title">{title}</span>
          {time && <span className="poolse-list__time">{time}</span>}
        </div>
        <div className="poolse-list__preview">
          {conv.last_sequence > 0
            ? `${conv.last_sequence} message${conv.last_sequence === 1 ? '' : 's'}`
            : 'No messages yet'}
        </div>
      </div>
    </>
  );
}

/**
 * Human-readable relative time, very rough. Real apps usually want
 * date-fns / dayjs / Intl.RelativeTimeFormat; this is good enough
 * for the default row and avoids a runtime dep.
 */
function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.max(0, Math.floor((now - then) / 1000));
  if (diffSec < 60) return 'now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h`;
  return `${Math.floor(diffSec / 86400)}d`;
}
