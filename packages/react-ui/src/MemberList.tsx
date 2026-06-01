// MemberList — roster panel for a conversation. Renders members
// with avatars, role badges, and an optional remove action.

import type { MemberRole, Membership, Uuid } from '@poolse/sdk';
import { useMembers } from '@poolse/react';
import { type ReactNode } from 'react';
import { Avatar } from './Avatar.js';
import { PoolseIcon } from './PoolseIcon.js';
import { useDisplayName } from './UserName.js';

export interface MemberListProps {
  conversationId: Uuid;
  /**
   * Resolve a `user_id` to a friendly display name. When omitted,
   * shows the truncated user_id (good enough for testing; real apps
   * pass a name lookup).
   */
  labelFor?: (userId: Uuid) => string;
  /**
   * Resolve an avatar URL by user_id. Optional — initials fallback
   * is used when not provided or when this returns null.
   */
  avatarFor?: (userId: Uuid) => string | null;
  /**
   * Set of currently-online user_ids. Drives the green presence dot.
   * Typically wired from `usePresence(conversationId).online`.
   */
  onlineUserIds?: Set<Uuid>;
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
  onlineUserIds,
  canRemove,
  renderItem,
  emptyState,
}: MemberListProps) {
  const { members, loading, error, removeMember } = useMembers(conversationId);

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
            avatarUrl={avatarFor?.(m.user_id) ?? null}
            online={onlineUserIds?.has(m.user_id) ?? false}
            removable={canRemove?.(m) ?? false}
            onRemove={() => {
              void removeMember(m.user_id);
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

function DefaultMemberRow({
  membership,
  avatarUrl,
  online,
  removable,
  onRemove,
  labelFor,
}: {
  membership: Membership;
  avatarUrl: string | null;
  online: boolean;
  removable: boolean;
  onRemove: () => void;
  labelFor?: (userId: Uuid) => string;
}) {
  // Resolve via the shared 3-tier chain so labelFor still works for
  // back-compat AND the customer's userResolver lights up names here
  // automatically.
  const name = useDisplayName(membership.user_id, labelFor);
  return (
    <div className="poolse-member-row">
      <Avatar src={avatarUrl} name={name} online={online} size="md" />
      <div className="poolse-member-row__body">
        <div className="poolse-member-row__name">{name}</div>
        <div className="poolse-member-row__sub">{online ? 'online' : 'offline'}</div>
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
