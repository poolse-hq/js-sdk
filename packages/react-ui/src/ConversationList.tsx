// ConversationList — sidebar of the user's conversations.
//
// Default rendering is a Slack/Discord-style list with avatar +
// name + last-message preview + timestamp. Customers swap rows
// via `renderItem` for full layout control.
//
// Powered by `useConversations` so the list updates in real time
// when the user is added to a new conversation (no refetch).

import type { Conversation, Uuid } from '@poolse/sdk';
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
  /**
   * Controlled mode — when provided, render from these props instead
   * of calling `useConversations()` internally. Lets parent components
   * own the conversations state when they need to mutate it (e.g.,
   * after creating a conversation via a custom backend route the SDK
   * can't see). Pass `conversations` to enable; `loading` and `error`
   * are optional companions.
   *
   * When omitted, the component auto-fetches via `useConversations()`.
   */
  conversations?: Conversation[];
  loading?: boolean;
  error?: Error | null;
  /**
   * Per-conversation unread message count. Rendered as a small Pulse
   * Coral pill on each row when > 0. Typically wired from
   * `useConversations().unreadCounts`; omit to disable badges.
   */
  unreadCounts?: Record<Uuid, number>;
}

export function ConversationList({
  selectedId,
  onSelect,
  renderItem,
  emptyState,
  conversations: controlledConversations,
  loading: controlledLoading,
  error: controlledError,
  unreadCounts,
}: ConversationListProps) {
  const auto = useConversations();
  const isControlled = controlledConversations !== undefined;
  const conversations = isControlled ? controlledConversations : auto.conversations;
  const loading = isControlled ? (controlledLoading ?? false) : auto.loading;
  const error = isControlled ? (controlledError ?? null) : auto.error;
  // Fall back to the hook's own unreadCounts when in uncontrolled mode
  // — saves callers from threading `useConversations().unreadCounts`
  // through manually if they're already using the auto-fetch path.
  const counts = unreadCounts ?? (isControlled ? undefined : auto.unreadCounts);

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
        const unread = counts?.[conv.id] ?? 0;
        const content = renderItem ? (
          renderItem(conv, selected)
        ) : (
          <DefaultRow conv={conv} selected={selected} unread={unread} />
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

function DefaultRow({
  conv,
  selected: _selected,
  unread,
}: {
  conv: Conversation;
  selected: boolean;
  unread: number;
}) {
  const title = conv.name ?? 'Untitled conversation';
  const time = conv.last_message_at ? formatRelative(conv.last_message_at) : '';
  const hasUnread = unread > 0;

  return (
    <>
      <Avatar src={conv.avatar_url ?? null} name={conv.name} size="md" />
      <div className="poolse-list__body">
        <div className="poolse-list__head">
          <span className={`poolse-list__title${hasUnread ? ' poolse-list__title--unread' : ''}`}>
            {title}
          </span>
          {time && <span className="poolse-list__time">{time}</span>}
        </div>
        <div className="poolse-list__preview">
          {conv.last_sequence > 0
            ? `${conv.last_sequence} message${conv.last_sequence === 1 ? '' : 's'}`
            : 'No messages yet'}
        </div>
      </div>
      {hasUnread && (
        <span
          className="poolse-list__unread-badge"
          aria-label={`${unread} unread ${unread === 1 ? 'message' : 'messages'}`}
        >
          {unread > 99 ? '99+' : unread}
        </span>
      )}
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
