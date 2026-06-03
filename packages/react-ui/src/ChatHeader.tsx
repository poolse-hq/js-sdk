// ChatHeader — title bar above a conversation. Resolves direct-chat
// titles from the other member's external_id (matching the
// ConversationList row behavior), or uses the conversation's `name`
// for groups. Renders a back button when `onBack` is provided so a
// composed inbox can navigate back to its list.

import { useConversation, useMe, useMembers, usePresence } from '@poolse/react';
import { type ReactNode } from 'react';
import { Avatar } from './Avatar.js';
import { PoolseIcon } from './PoolseIcon.js';

export interface ChatHeaderProps {
  /** Conversation id — used to fetch the row + members for the title / presence dot. */
  conversationId: string;
  /**
   * Resolve a member's external_id into a display name. Used for
   * the direct-chat title and the group "X, Y, Z" subtitle.
   */
  labelFor?: (externalId: string) => string;
  /** Avatar URL resolver for direct-chat avatars (mirrors ConversationList). */
  avatarFor?: (externalId: string) => string | null;
  /** When provided, renders a left-side back arrow that calls this on click. */
  onBack?: () => void;
  /** Tapping the title region — typical use is to open a profile / group sheet. */
  onPress?: () => void;
  /** Tap on the members icon on the right — typical use is to open `<GroupDetailsSheet>`. */
  onMembersPress?: () => void;
  /** Custom right-side slot rendered after the members button. */
  rightSlot?: ReactNode;
}

export function ChatHeader({
  conversationId,
  labelFor,
  avatarFor,
  onBack,
  onPress,
  onMembersPress,
  rightSlot,
}: ChatHeaderProps) {
  const { me } = useMe();
  const meId = me?.id ?? null;
  const { conversation: conv } = useConversation(conversationId);
  const { members } = useMembers(conversationId);
  // Presence powers the green dot under the avatar for direct chats —
  // matches the RN ChatHeader behavior. usePresence joins the
  // conversation channel and returns a Set of external_ids currently
  // online.
  const { online } = usePresence(conversationId);

  const isDirect = conv?.type === 'direct';
  const otherMember = isDirect ? members.find((m) => m.user_id !== meId) : null;
  const otherExtId = otherMember?.external_id ?? null;

  const title = isDirect
    ? otherExtId
      ? (labelFor?.(otherExtId) ?? otherExtId)
      : (conv?.name ?? 'Direct chat')
    : (conv?.name ?? 'Untitled group');

  const avatarUrl = isDirect && otherExtId ? (avatarFor?.(otherExtId) ?? null) : null;

  const otherOnline = isDirect && otherExtId ? online.has(otherExtId) : false;

  const subtitle = isDirect
    ? otherOnline
      ? 'Online'
      : null
    : `${members.length} member${members.length === 1 ? '' : 's'}`;

  const isPressable = typeof onPress === 'function';

  const titleContent = (
    <>
      <Avatar src={avatarUrl} name={title} online={otherOnline} size="md" />
      <div className="poolse-chat-header__titles">
        <div className="poolse-chat-header__title">{title}</div>
        {subtitle ? <div className="poolse-chat-header__subtitle">{subtitle}</div> : null}
      </div>
    </>
  );

  return (
    <header className="poolse-chat-header">
      {onBack ? (
        <button
          type="button"
          className="poolse-icon-btn poolse-chat-header__back"
          onClick={onBack}
          aria-label="Back"
        >
          {/* `reply` glyph repurposed for back — same arrow shape, same
              treatment as the RN ChatHeader. Saves us adding a new
              icon definition just for this one button. */}
          <PoolseIcon name="reply" size={20} label={null} />
        </button>
      ) : null}

      {isPressable ? (
        <button type="button" className="poolse-chat-header__title-btn" onClick={onPress}>
          {titleContent}
        </button>
      ) : (
        <div className="poolse-chat-header__title-row">{titleContent}</div>
      )}

      <div className="poolse-chat-header__actions">
        {!isDirect && onMembersPress ? (
          <button
            type="button"
            className="poolse-icon-btn"
            onClick={onMembersPress}
            aria-label="View members"
          >
            <PoolseIcon name="users" size={20} label={null} />
          </button>
        ) : null}
        {rightSlot}
      </div>
    </header>
  );
}
