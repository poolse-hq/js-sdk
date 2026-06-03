// MemberList — roster panel for a conversation. Renders members
// with avatars, role badges, and an optional remove action.

import type { MemberRole, Membership, Uuid } from '@poolse/sdk';
import { useMembers, usePresence } from '@poolse/react';
import { type ReactNode } from 'react';
import { Avatar } from './Avatar.js';
import { PoolseIcon } from './PoolseIcon.js';
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
   * Override the online set with a caller-supplied source of
   * `external_id`s. By default MemberList wires
   * `usePresence(conversationId).online` itself, so the presence dots
   * light up out-of-the-box. Pass an explicit `Set` when you want to
   * merge presence with other signals (typing, focus, etc), or an
   * empty `new Set()` to disable the dots entirely.
   */
  onlineExternalIds?: Set<string>;
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
  canRemove,
  renderItem,
  emptyState,
}: MemberListProps) {
  const { members, loading, error, removeMember } = useMembers(conversationId);
  // Auto-wire presence when no caller-supplied set was passed. The hook
  // joins the conversation channel idempotently; if ConversationView is
  // mounted alongside MemberList (the common case) they share the same
  // channel subscription, so this is free.
  const { online: presenceOnline } = usePresence(
    onlineExternalIds === undefined ? conversationId : '',
  );
  const effectiveOnline = onlineExternalIds ?? presenceOnline;

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
            online={effectiveOnline.has(m.external_id)}
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
  labelFor?: (externalId: string) => string;
}) {
  const name = useDisplayName(membership.external_id, labelFor);
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
