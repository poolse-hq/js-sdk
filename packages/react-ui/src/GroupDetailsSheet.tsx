// GroupDetailsSheet — modal showing a group conversation's name,
// avatar, and member roster (with presence). Wraps the existing
// `<MemberList>` in a brand-aligned modal shell — the standalone
// MemberList stays headless for callers who want their own chrome.

import { useConversation } from '@poolse/react';
import { useEffect, type ReactNode } from 'react';
import { Avatar } from './Avatar.js';
import { MemberList } from './MemberList.js';
import { PoolseIcon } from './PoolseIcon.js';

export interface GroupDetailsSheetProps {
  visible: boolean;
  onClose: () => void;
  conversationId: string;
  labelFor?: (externalId: string) => string;
  avatarFor?: (externalId: string) => string | null;
  /** Slot below the member list — typically a "Leave group" or "Invite" button. */
  footer?: ReactNode;
}

export function GroupDetailsSheet({
  visible,
  onClose,
  conversationId,
  labelFor,
  avatarFor,
  footer,
}: GroupDetailsSheetProps) {
  const { conversation: conv } = useConversation(visible ? conversationId : null);

  useEffect(() => {
    if (!visible) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [visible, onClose]);

  if (!visible) return null;

  const title = conv?.name ?? 'Group';
  const memberCount = conv?.member_external_ids?.length ?? 0;

  return (
    <div
      className="poolse-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Group details"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="poolse-modal__sheet">
        <header className="poolse-modal__header">
          <div className="poolse-modal__title">Group details</div>
          <button type="button" className="poolse-icon-btn" onClick={onClose} aria-label="Close">
            <PoolseIcon name="close" size={18} label={null} />
          </button>
        </header>

        <div className="poolse-modal__body">
          <div className="poolse-group-details__hero">
            <Avatar src={conv?.avatar_url ?? null} name={title} size="lg" />
            <div className="poolse-group-details__hero-text">
              <div className="poolse-group-details__title">{title}</div>
              <div className="poolse-group-details__subtitle">
                {memberCount > 0 ? `${memberCount} member${memberCount === 1 ? '' : 's'}` : ''}
              </div>
            </div>
          </div>

          <div className="poolse-group-details__members">
            <MemberList
              conversationId={conversationId}
              {...(labelFor ? { labelFor } : {})}
              {...(avatarFor ? { avatarFor } : {})}
            />
          </div>
        </div>

        {footer ? <footer className="poolse-modal__footer">{footer}</footer> : null}
      </div>
    </div>
  );
}
