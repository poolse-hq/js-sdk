import { useDisplayName } from './UserName.js';

export interface TypingIndicatorProps {
  /** Set of `external_id`s currently typing — what `useTyping` returns. */
  typing: Set<string>;
  /**
   * Resolves an `external_id` to a display label. Defaults to the
   * SDK's `userResolver` (and falls back to the external_id itself
   * when the resolver isn't configured).
   */
  labelFor?: (externalId: string) => string;
}

/**
 * Animated 3-dot typing bubble with an inline name label. Hidden
 * (zero vertical space) when no one is typing, so the message list
 * doesn't jump when the indicator appears/disappears.
 *
 * Styling: matches the brand-kit chat showcase — surface bubble with
 * 16px radius + 5px asymmetric tail, bouncing dots in `--poolse-ink-3`.
 */
export function TypingIndicator({ typing, labelFor }: TypingIndicatorProps) {
  const ids = Array.from(typing);
  const isTyping = ids.length > 0;

  // Keep a single live region in the DOM at all times so screen
  // readers announce the transition from idle → typing → idle.
  // The dots are decorative + aria-hidden; only the label text is
  // announced. `aria-atomic` ensures the whole sentence is read
  // instead of just the diff (e.g. only "Alice").
  return (
    <div className="poolse-typing" data-typing={isTyping || undefined}>
      <span className="poolse-typing__dots" aria-hidden="true">
        <span className="poolse-typing__dot" />
        <span className="poolse-typing__dot" />
        <span className="poolse-typing__dot" />
      </span>
      <span className="poolse-typing__label" role="status" aria-live="polite" aria-atomic="true">
        {isTyping ? <TypingLabel ids={ids} {...(labelFor ? { labelFor } : {})} /> : ''}
      </span>
    </div>
  );
}

// Resolves the typing-users array into a "X is typing" / "X and Y are
// typing" / "N people are typing" sentence. Pulls each name through
// the shared 3-tier chain so the customer's userResolver lights up
// here automatically.
function TypingLabel({
  ids,
  labelFor,
}: {
  ids: string[];
  labelFor?: (externalId: string) => string;
}) {
  // Only render names for the first two — beyond that we collapse
  // to a count and don't need lookups.
  const id1 = ids[0] ?? null;
  const id2 = ids[1] ?? null;
  const name1 = useDisplayName(id1, labelFor);
  const name2 = useDisplayName(id2, labelFor);

  if (ids.length === 1) return <>{name1} is typing</>;
  if (ids.length === 2) {
    return (
      <>
        {name1} and {name2} are typing
      </>
    );
  }
  return <>{ids.length} people are typing</>;
}
