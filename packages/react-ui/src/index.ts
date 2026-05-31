// @poolse/react-ui — plug-and-play React components built on
// @poolse/react hooks. Drop in once for instant chat; eject to
// individual pieces (or the raw hooks) when you need more control.
//
// Don't forget to import the styles:
//
//     import '@poolse/react-ui/styles.css';
//
// Theming flows through CSS variables defined in styles.css — see
// the brand kit (`tokens.css`) for the full --poolse-* surface.
// Override at any level: redefine the variables in your own
// stylesheet, or set `[data-theme="dark"]` on any ancestor to
// switch to the warm dark theme.

// ── Chat surface (composed conversation view) ─────────────────
export { ConversationView, type ConversationViewProps } from './ConversationView.js';

// ── Pieces of the chat surface ────────────────────────────────
export { MessageBubble, type MessageBubbleProps } from './MessageBubble.js';
export { EditableMessageBubble, type EditableMessageBubbleProps } from './EditableMessageBubble.js';
export { MessageComposer, type MessageComposerProps } from './MessageComposer.js';
export { MessageActions, type MessageActionsProps } from './MessageActions.js';
export { TypingIndicator, type TypingIndicatorProps } from './TypingIndicator.js';
export { ThreadView, type ThreadViewProps } from './ThreadView.js';
export { Avatar, type AvatarProps } from './Avatar.js';

// ── Conversation + member panels ──────────────────────────────
export { ConversationList, type ConversationListProps } from './ConversationList.js';
export { MemberList, type MemberListProps } from './MemberList.js';

// ── Rich content ──────────────────────────────────────────────
export { AttachmentPreview, type AttachmentPreviewProps } from './AttachmentPreview.js';
export { ReactionStrip, ReactionPicker, type ReactionStripProps } from './Reactions.js';
export { MentionInput, type MentionInputProps } from './MentionInput.js';

// ── Brand chrome ──────────────────────────────────────────────
export { PoolseIcon, type PoolseIconProps, type IconName } from './PoolseIcon.js';
export { PoolseLogo, type PoolseLogoProps, type PoolseLogoVariant } from './PoolseLogo.js';
export { PoolseFonts, usePoolseFonts } from './fonts.js';
