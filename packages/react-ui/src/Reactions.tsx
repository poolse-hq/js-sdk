// Reactions UI — a horizontal strip of reaction pills under a
// message + an emoji picker popover. Powered by `useReactions`.

import type { Uuid } from '@poolse/sdk';
import { useReactions, type ReactionMap } from '@poolse/react';
import { useState } from 'react';
import { PoolseIcon } from './PoolseIcon.js';

const COMMON_EMOJIS = ['👍', '❤️', '😂', '🎉', '😢', '🙏'] as const;

export interface ReactionStripProps {
  messageId: Uuid;
  conversationId: Uuid;
  /** Seed reactions from the message you already have in state. */
  initialReactions?: ReactionMap;
  /** Used to mark "your own" reactions visually + drive the optimistic add/remove. */
  currentUserId?: Uuid | null;
  /**
   * Show the "add reaction" button at the end of the strip. Defaults
   * to true; set false to render reactions as a read-only display.
   */
  picker?: boolean;
}

/**
 * Inline strip of reaction pills with optional emoji picker. Clicking
 * a pill the user already reacted with REMOVES that reaction;
 * clicking one they haven't, ADDS it.
 */
export function ReactionStrip({
  messageId,
  conversationId,
  initialReactions,
  currentUserId,
  picker = true,
}: ReactionStripProps) {
  const { reactions, addReaction, removeReaction } = useReactions(messageId, {
    conversationId,
    ...(initialReactions !== undefined ? { initialReactions } : {}),
    ...(currentUserId !== undefined ? { currentUserId } : {}),
  });
  const [pickerOpen, setPickerOpen] = useState(false);

  const entries = Object.entries(reactions);
  if (entries.length === 0 && !picker) return null;

  return (
    <div className="poolse-reactions" style={{ position: 'relative' }}>
      {entries.map(([emoji, users]) => {
        const mine = currentUserId !== undefined && currentUserId !== null && users.includes(currentUserId);
        return (
          <button
            key={emoji}
            type="button"
            className={`poolse-reaction-pill${mine ? ' poolse-reaction-pill--mine' : ''}`}
            onClick={() => {
              if (mine) void removeReaction(emoji);
              else void addReaction(emoji);
            }}
            aria-pressed={mine}
            aria-label={`${emoji} reacted by ${users.length} ${users.length === 1 ? 'user' : 'users'}`}
          >
            <span>{emoji}</span>
            <span className="poolse-reaction-pill__count">{users.length}</span>
          </button>
        );
      })}

      {picker && (
        <>
          <button
            type="button"
            className="poolse-reaction-pill"
            onClick={() => setPickerOpen((o) => !o)}
            aria-label="Add reaction"
            aria-expanded={pickerOpen}
          >
            <PoolseIcon name="emoji" size={14} label={null} />
            <span className="poolse-reaction-pill__count" aria-hidden="true">+</span>
          </button>
          {pickerOpen && (
            <ReactionPicker
              onPick={(emoji) => {
                setPickerOpen(false);
                void addReaction(emoji);
              }}
              onClose={() => setPickerOpen(false)}
            />
          )}
        </>
      )}
    </div>
  );
}

/**
 * Emoji picker popover. Renders the common set; customers needing
 * the full emoji set should provide their own picker via children.
 */
export function ReactionPicker({
  onPick,
  onClose,
}: {
  onPick: (emoji: string) => void;
  onClose?: () => void;
}) {
  return (
    <div
      className="poolse-reaction-picker"
      role="menu"
      style={{ position: 'absolute', bottom: '100%', left: 0, marginBottom: 6 }}
      // Click-outside handled by the parent surface — picker stays
      // simple. Esc closes via the keydown handler below.
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose?.();
      }}
    >
      {COMMON_EMOJIS.map((e) => (
        <button
          key={e}
          type="button"
          className="poolse-reaction-picker__btn"
          onClick={() => onPick(e)}
          aria-label={`React with ${e}`}
        >
          {e}
        </button>
      ))}
    </div>
  );
}
