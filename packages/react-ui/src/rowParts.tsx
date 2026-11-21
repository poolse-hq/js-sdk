// Pieces every message-row layout shares: the touch toggle for the
// actions toolbar and the inline reaction pills.

import { useEffect, useRef, useState } from 'react';

/**
 * Hover doesn't fire on touch devices, so tapping a row toggles its
 * actions instead; a tap anywhere outside closes them. Desktop keeps
 * hover/focus (the tap path no-ops there so text selection still works).
 */
export function useRowActions() {
  const [actionsOpen, setActionsOpen] = useState(false);
  const rowRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!actionsOpen) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target;
      if (t instanceof Node && rowRef.current && !rowRef.current.contains(t)) {
        setActionsOpen(false);
      }
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [actionsOpen]);

  const onRowClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Only fire on touch-only viewports. Desktop keeps hover/focus.
    if (typeof window === 'undefined' || !window.matchMedia('(hover: none)').matches) return;
    // Don't hijack clicks on interactive children — links, attachment
    // images (wrapped in <button>), reaction pills, edit textarea,
    // composer, etc. Use closest() so deep targets are still caught.
    const target = e.target as HTMLElement;
    if (target.closest('a, button, input, textarea, label, select')) return;
    setActionsOpen((o) => !o);
  };

  return { actionsOpen, setActionsOpen, rowRef, onRowClick };
}

// Stripped-down ReactionStrip that uses an external addReaction/
// removeReaction (rather than calling useReactions internally). Lets
// a row share one useReactions across the strip + the hover picker.
// Picker disabled on this internal variant; the hover menu handles
// "add reaction" instead.
export function InlineReactions({
  reactions,
  currentUserId,
  onAdd,
  onRemove,
}: {
  reactions: Record<string, string[]>;
  currentUserId: string | null;
  onAdd: (emoji: string) => void;
  onRemove: (emoji: string) => void;
}) {
  const entries = Object.entries(reactions);
  if (entries.length === 0) return null;
  return (
    <div className="poolse-reactions">
      {entries.map(([emoji, users]) => {
        const mine =
          currentUserId !== null && currentUserId !== undefined && users.includes(currentUserId);
        return (
          <button
            key={emoji}
            type="button"
            className={`poolse-reaction-pill${mine ? ' poolse-reaction-pill--mine' : ''}`}
            onClick={() => {
              if (mine) onRemove(emoji);
              else onAdd(emoji);
            }}
            aria-pressed={mine}
            aria-label={`${emoji} reacted by ${users.length} ${users.length === 1 ? 'user' : 'users'}`}
          >
            <span>{emoji}</span>
            <span className="poolse-reaction-pill__count">{users.length}</span>
          </button>
        );
      })}
    </div>
  );
}
