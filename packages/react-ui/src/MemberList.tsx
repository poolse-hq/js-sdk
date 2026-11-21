// MemberList — roster panel for a conversation. Renders members
// with avatars, role badges, and an optional remove action.

import type { MemberRole, Membership, Presence, Uuid } from '@poolse/sdk';
import { agentFromWire, useAgent, useMembers, usePresenceMany } from '@poolse/react';
import { type ReactNode } from 'react';
import { AgentBadge } from './AgentBadge.js';
import { Avatar } from './Avatar.js';
import { PoolseIcon } from './PoolseIcon.js';
import { presenceText } from './PresenceBadge.js';
import { useNow } from './relativeTime.js';
import { useDisplayName } from './UserName.js';

export interface MemberListProps {
  conversationId: Uuid;
  /**
   * Resolve an `external_id` to a friendly display name. When omitted,
   * the SDK's `userResolver` is used (and the external_id is shown as
   * a fallback while the resolver loads / returns null).
   */
  labelFor?: (externalId: string) => string;
  /**
   * Resolve an avatar URL by `external_id`. Optional — initials
   * fallback is used when not provided or when this returns null.
   */
  avatarFor?: (externalId: string) => string | null;
  /**
   * Override presence with a caller-supplied set of online
   * `external_id`s (a plain green dot, "online" / "offline"). By
   * default each member's presence (online / away / in a call /
   * offline, do not disturb) comes from `usePresenceMany`.
   */
  onlineExternalIds?: Set<string>;
  /**
   * Presence badges on the avatars and the state ("Online", "Away",
   * "In a call", "Last seen 5m ago") under each name. Defaults to `true`.
   */
  showPresence?: boolean;
  /**
   * If provided, surfaces a "remove" icon next to each member that
   * the caller is allowed to remove. The caller is responsible for
   * the permission check (typically: only owners/admins, never self).
   */
  canRemove?: (m: Membership) => boolean;
  /** Override for each row's rendering. */
  renderItem?: (m: Membership) => ReactNode;
  /** Custom empty state when the conversation has zero members. */
  emptyState?: ReactNode;
}

export function MemberList({
  conversationId,
  labelFor,
  avatarFor,
  onlineExternalIds,
  showPresence = true,
  canRemove,
  renderItem,
  emptyState,
}: MemberListProps) {
  const { members, loading, error, removeMember } = useMembers(conversationId);
  // A caller-supplied online set keeps the old green dots; otherwise
  // every member's presence comes from the one presence store (a
  // single batched lookup for the whole roster, live after that).
  const legacy = onlineExternalIds !== undefined;
  const presences = usePresenceMany(
    showPresence && !legacy ? members.map((m) => m.external_id) : NO_IDS,
  );
  // Keeps "Last seen 5m ago" current.
  const now = useNow();

  if (loading && members.length === 0) {
    return <div className="poolse-list poolse-list--placeholder">Loading members…</div>;
  }

  if (error) {
    return (
      <div className="poolse-list poolse-list--placeholder poolse-list--error">
        <div>Failed to load members.</div>
        {error.message && (
          <div className="poolse-list__error-detail">
            <code>{error.message}</code>
          </div>
        )}
      </div>
    );
  }

  if (members.length === 0) {
    return (
      <div className="poolse-list poolse-list--placeholder">{emptyState ?? 'No members yet.'}</div>
    );
  }

  return (
    <ul className="poolse-list" role="list" aria-label="Members">
      {members.map((m) => {
        const content = renderItem ? (
          renderItem(m)
        ) : (
          <DefaultMemberRow
            membership={m}
            avatarUrl={avatarFor?.(m.external_id) ?? null}
            presence={
              !showPresence
                ? null
                : legacy
                  ? onlineExternalIds.has(m.external_id)
                  : (presences[m.external_id] ?? null)
            }
            now={now}
            removable={canRemove?.(m) ?? false}
            onRemove={() => {
              // SDK exposes removeMember by external_id (was user_id);
              // see @poolse/react@2.0.0 migration notes.
              void removeMember(m.external_id);
            }}
            {...(labelFor ? { labelFor } : {})}
          />
        );
        return (
          <li key={m.id} className="poolse-list__item">
            {content}
          </li>
        );
      })}
    </ul>
  );
}

const NO_IDS: string[] = [];

function DefaultMemberRow({
  membership,
  avatarUrl,
  presence,
  now,
  removable,
  onRemove,
  labelFor,
}: {
  membership: Membership;
  avatarUrl: string | null;
  /** `boolean` from `onlineExternalIds`, a `Presence`, or null (hidden / unknown). */
  presence: boolean | Presence | null;
  now: number;
  removable: boolean;
  onRemove: () => void;
  labelFor?: (externalId: string) => string;
}) {
  const name = useDisplayName(membership.external_id, labelFor);
  // The row itself says so, or anything else seen about this user did (AG1).
  const known = useAgent(membership.external_id);
  const agent = !!known || !!agentFromWire(membership);
  return (
    <div className="poolse-member-row">
      {typeof presence === 'boolean' ? (
        <Avatar src={avatarUrl} name={name} online={presence} size="md" agent={agent} />
      ) : (
        <Avatar src={avatarUrl} name={name} presence={presence} size="md" agent={agent} />
      )}
      <div className="poolse-member-row__body">
        <div className="poolse-member-row__name">
          {agent ? (
            <span className="poolse-has-agent">
              <span>{name}</span>
              <AgentBadge size="xs" />
            </span>
          ) : (
            name
          )}
        </div>
        {typeof presence === 'boolean' ? (
          <div className="poolse-member-row__sub">{presence ? 'online' : 'offline'}</div>
        ) : presence ? (
          <div className="poolse-member-row__sub">{presenceText(presence, now)}</div>
        ) : null}
      </div>
      <RoleBadge role={membership.role} />
      {removable && (
        <button
          type="button"
          className="poolse-icon-btn poolse-icon-btn--danger"
          aria-label={`Remove ${name}`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <PoolseIcon name="trash" size={16} label={null} />
        </button>
      )}
    </div>
  );
}

function RoleBadge({ role }: { role: MemberRole }) {
  const mod = role === 'owner' ? 'owner' : role === 'admin' ? 'admin' : null;
  return <span className={`poolse-badge${mod ? ` poolse-badge--${mod}` : ''}`}>{role}</span>;
}
