// ConversationList — sidebar of the user's conversations.
//
// Default rendering is a Slack/Discord-style list with avatar +
// name + last-message preview + timestamp. Customers swap rows
// via `renderItem` for full layout control.
//
// Powered by `useConversations` so the list updates in real time
// when the user is added to a new conversation OR when a member
// sends a message into an existing one (no refetch).

import type { Conversation, Uuid } from '@poolse/sdk';
import {
  filterConversations,
  formatCallLogPreview,
  formatRecordingNoticePreview,
  formatCallSummaryPreview,
  displayNameOf,
  useConversations,
  useMe,
  useUser,
} from '@poolse/react';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Avatar } from './Avatar.js';
import { EmptyState } from './EmptyState.js';

export interface ConversationListProps {
  /** Currently selected conversation id — sets `aria-current` + selected styling. */
  selectedId?: string | null;
  /** Click handler — typical use is to update routing / selectedId state. */
  onSelect?: (conv: Conversation) => void;
  /** Optional override for each row's rendering. */
  renderItem?: (conv: Conversation, selected: boolean) => ReactNode;
  /**
   * What an empty list shows. Defaults to "No conversations yet" with a
   * hint at the next step.
   */
  emptyState?: ReactNode;
  /**
   * Show only conversations matching this text (name, the other
   * person in a direct chat via `labelFor`, the last message). For a
   * search field in `header`. Empty = everything.
   */
  query?: string;
  /** What shows when `query` matches nothing. Receives the query. */
  noResultsState?: ReactNode | ((query: string) => ReactNode);
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
  /**
   * Resolve a user's display name from their `external_id`. Used to
   * render direct-conversation rows (the conversation row picks the
   * OTHER member's external_id and labels the row with their name).
   * Then the `userResolver`, then "Unknown user" (never the id itself).
   */
  labelFor?: (externalId: string) => string;
  /** Avatar URL resolver — same role as `labelFor`, for the direct-chat avatar. */
  avatarFor?: (externalId: string) => string | null;
  /**
   * Direct chats: the other person's presence badge (online, away, in a
   * call, do not disturb) on the row's avatar. Defaults to `true`.
   */
  showPresence?: boolean;
  /**
   * `'comfortable'` (default): avatar, name, preview and time.
   * `'compact'`: one line per conversation, small avatar, no preview.
   */
  density?: 'comfortable' | 'compact';
  /**
   * Split the list under headings: each conversation goes under the
   * first section whose `filter` takes it (ones no section takes aren't
   * shown); empty sections are hidden. Overrides `groupBy`.
   */
  sections?: ConversationListSection[];
  /** `'type'`: "Channels" (groups), then "Direct messages". */
  groupBy?: 'type';
  /** Rendered above the list (a title, a search field, a "New chat" button). */
  header?: ReactNode;
  /**
   * Controlled mode's paging (with `conversations`): there's another
   * page, one is loading, and load it. Uncontrolled, the list pages
   * `useConversations()` itself as it's scrolled to the end.
   */
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void | Promise<void>;
}

/** A heading in `<ConversationList sections>`. */
export interface ConversationListSection {
  title: string;
  filter: (conversation: Conversation) => boolean;
}

export function ConversationList({
  selectedId,
  onSelect,
  renderItem,
  emptyState,
  query = '',
  noResultsState,
  conversations: controlledConversations,
  loading: controlledLoading,
  error: controlledError,
  unreadCounts,
  labelFor,
  avatarFor,
  showPresence = true,
  density = 'comfortable',
  sections,
  groupBy,
  header,
  hasMore: controlledHasMore,
  loadingMore: controlledLoadingMore,
  onLoadMore,
}: ConversationListProps) {
  const auto = useConversations();
  const { me } = useMe();
  const meExternalId = me?.external_id ?? null;
  const meId = me?.id ?? null;
  const isControlled = controlledConversations !== undefined;
  const allConversations = isControlled ? controlledConversations : auto.conversations;
  const needle = query.trim().toLowerCase();
  const conversations = useMemo(
    () =>
      needle
        ? filterConversations(allConversations, needle, {
            meExternalId,
            ...(labelFor ? { labelFor } : {}),
          })
        : allConversations,
    [allConversations, needle, meExternalId, labelFor],
  );
  const loading = isControlled ? (controlledLoading ?? false) : auto.loading;
  const error = isControlled ? (controlledError ?? null) : auto.error;
  // Fall back to the hook's own unreadCounts when in uncontrolled mode
  // — saves callers from threading `useConversations().unreadCounts`
  // through manually if they're already using the auto-fetch path.
  const counts = unreadCounts ?? (isControlled ? undefined : auto.unreadCounts);
  // Paging: the shared list's own unless the caller drives it.
  const hasMore = isControlled ? (controlledHasMore ?? false) : auto.hasMore;
  const loadingMore = isControlled ? (controlledLoadingMore ?? false) : auto.loadingMore;
  const loadMore = isControlled ? onLoadMore : auto.loadMore;

  // Infinite scroll: a sentinel after the last row asks for the next
  // page as it nears the bottom of the list (or right away when the
  // first page doesn't fill it).
  const listRef = useRef<HTMLUListElement | null>(null);
  const sentinelRef = useRef<HTMLLIElement | null>(null);
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;
  const busyRef = useRef(false);
  const hasRows = conversations.length > 0;
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = listRef.current;
    if (!sentinel || !root || !hasMore || loadingMore) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting || busyRef.current) return;
        const fn = loadMoreRef.current;
        if (!fn) return;
        busyRef.current = true;
        void Promise.resolve()
          .then(fn)
          .catch(() => undefined)
          .finally(() => {
            busyRef.current = false;
          });
      },
      { root, rootMargin: '0px 0px 240px 0px', threshold: 0 },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [hasMore, loadingMore, hasRows]);

  const groups = useMemo(
    () =>
      groupConversations(conversations, sections ?? (groupBy === 'type' ? TYPE_SECTIONS : null)),
    [conversations, sections, groupBy],
  );

  const rootClass = [
    'poolse-conversation-list',
    `poolse-conversation-list--density-${density}`,
  ].join(' ');

  const body = (() => {
    if (loading && conversations.length === 0) {
      return <div className="poolse-list poolse-list--placeholder">Loading conversations…</div>;
    }
    if (error && conversations.length === 0) {
      return (
        <div className="poolse-list poolse-list--placeholder poolse-list--error">
          Failed to load conversations.
        </div>
      );
    }
    if (conversations.length === 0 && needle && allConversations.length > 0) {
      return typeof noResultsState === 'function' ? (
        noResultsState(query.trim())
      ) : noResultsState !== undefined ? (
        <div className="poolse-list poolse-list--placeholder">{noResultsState}</div>
      ) : (
        <EmptyState
          title={`Nothing matches “${query.trim()}”`}
          hint="Check the spelling, or search by a person's or channel's name."
        />
      );
    }
    if (conversations.length === 0) {
      return emptyState !== undefined ? (
        <div className="poolse-list poolse-list--placeholder">{emptyState}</div>
      ) : (
        <EmptyState
          title="No conversations yet"
          hint="Start a chat with someone, or join a channel — it shows up here."
        />
      );
    }

    const row = (conv: Conversation) => {
      const selected = selectedId === conv.id;
      const unread = counts?.[conv.id] ?? 0;
      const content = renderItem ? (
        renderItem(conv, selected)
      ) : (
        <DefaultRow
          conv={conv}
          selected={selected}
          unread={unread}
          meExternalId={meExternalId}
          meId={meId}
          showPresence={showPresence}
          compact={density === 'compact'}
          {...(labelFor ? { labelFor } : {})}
          {...(avatarFor ? { avatarFor } : {})}
        />
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
    };

    return (
      <ul ref={listRef} className="poolse-list" role="listbox" aria-label="Conversations">
        {groups === null
          ? conversations.map(row)
          : groups.map((g) => (
              <li key={g.title} role="presentation" className="poolse-list__section">
                <div role="group" aria-label={g.title}>
                  <div className="poolse-list__section-title" aria-hidden="true">
                    {g.title}
                  </div>
                  <ul className="poolse-list__section-items" role="presentation">
                    {g.conversations.map(row)}
                  </ul>
                </div>
              </li>
            ))}
        {loadingMore && (
          <li className="poolse-list__loading-more" role="presentation">
            Loading…
          </li>
        )}
        {hasMore && (
          <li
            ref={sentinelRef}
            className="poolse-list__sentinel"
            role="presentation"
            aria-hidden="true"
          />
        )}
      </ul>
    );
  })();

  return (
    <div className={rootClass}>
      {header !== undefined && header !== null ? (
        <div className="poolse-conversation-list__header">{header}</div>
      ) : null}
      {body}
    </div>
  );
}

const TYPE_SECTIONS: ConversationListSection[] = [
  { title: 'Channels', filter: (c) => c.type !== 'direct' },
  { title: 'Direct messages', filter: (c) => c.type === 'direct' },
];

// Each conversation goes under the first section that takes it; empty
// sections are left out. `null` = no sections, one flat list.
function groupConversations(
  conversations: Conversation[],
  sections: ConversationListSection[] | null,
): { title: string; conversations: Conversation[] }[] | null {
  if (!sections || sections.length === 0) return null;
  const out = sections.map((s) => ({ title: s.title, conversations: [] as Conversation[] }));
  for (const conv of conversations) {
    const i = sections.findIndex((s) => s.filter(conv));
    if (i !== -1) out[i]!.conversations.push(conv);
  }
  return out.filter((g) => g.conversations.length > 0);
}

function DefaultRow({
  conv,
  selected: _selected,
  unread,
  meExternalId,
  meId = null,
  showPresence,
  compact = false,
  labelFor,
  avatarFor,
}: {
  conv: Conversation;
  selected: boolean;
  unread: number;
  meExternalId: string | null;
  meId?: string | null;
  showPresence: boolean;
  compact?: boolean;
  labelFor?: (externalId: string) => string;
  avatarFor?: (externalId: string) => string | null;
}) {
  // For directs, derive display from the OTHER member's external_id —
  // matches the RN PoolseInbox row behavior so a customer can pass the
  // same `labelFor` / `avatarFor` resolvers to both platforms.
  const isDirect = conv.type === 'direct';
  const otherExtId =
    isDirect && meExternalId
      ? (conv.member_external_ids ?? []).find((x) => x !== meExternalId)
      : null;

  // Without resolvers, the provider's userResolver names the other person.
  const { profile: other } = useUser(isDirect && otherExtId ? otherExtId : null);

  const title = isDirect
    ? otherExtId
      ? displayNameOf(otherExtId, { labelFor, profileName: other?.displayName })
      : (conv.name ?? 'Direct chat')
    : (conv.name ?? 'Untitled group');

  const avatarUrl = isDirect
    ? otherExtId
      ? (avatarFor?.(otherExtId) ?? other?.avatarUrl ?? null)
      : (conv.avatar_url ?? null)
    : (conv.avatar_url ?? null);

  const time = conv.last_message_at ? formatRelative(conv.last_message_at) : '';
  const hasUnread = unread > 0;

  // Preview: server-denormalized `last_message_preview` (set by
  // Messaging.send_message) is the source of truth. Fall back to a
  // sequence-count blurb when the server hasn't filled it in yet
  // (legacy rooms before the column was added).
  // Call-log previews arrive as the raw JSON body — render them as
  // "Voice call · 3:12" / "Missed call" instead.
  const preview =
    formatCallLogPreview(conv.last_message_preview, meId) ??
    formatRecordingNoticePreview(conv.last_message_preview, meId) ??
    formatCallSummaryPreview(conv.last_message_preview) ??
    conv.last_message_preview ??
    (conv.last_sequence > 0
      ? `${conv.last_sequence} message${conv.last_sequence === 1 ? '' : 's'}`
      : 'No messages yet');

  return (
    <>
      <Avatar
        src={avatarUrl}
        name={title}
        size={compact ? 'sm' : 'md'}
        {...(showPresence && otherExtId ? { presence: true as const, userId: otherExtId } : {})}
      />
      <div className="poolse-list__body">
        <div className="poolse-list__head">
          <span className={`poolse-list__title${hasUnread ? ' poolse-list__title--unread' : ''}`}>
            {title}
          </span>
          {time && <span className="poolse-list__time">{time}</span>}
        </div>
        {compact ? null : <div className="poolse-list__preview">{preview}</div>}
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
