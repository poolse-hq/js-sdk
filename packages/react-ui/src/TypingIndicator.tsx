export interface TypingIndicatorProps {
  /** Set of user_ids currently typing. */
  typing: Set<string>;
  /** Resolves a user_id to a display label. Defaults to the id's first 6 chars. */
  labelFor?: (userId: string) => string;
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

  if (ids.length === 0) {
    return <div className="poolse-typing" aria-hidden="true" />;
  }

  const label = labelFor ?? ((id: string) => id.slice(0, 6));
  const names = ids.slice(0, 2).map(label);

  let text: string;
  if (ids.length === 1) text = `${names[0]} is typing`;
  else if (ids.length === 2) text = `${names[0]} and ${names[1]} are typing`;
  else text = `${ids.length} people are typing`;

  return (
    <div className="poolse-typing">
      <span className="poolse-typing__dots" role="status" aria-live="polite">
        <span className="poolse-typing__dot" />
        <span className="poolse-typing__dot" />
        <span className="poolse-typing__dot" />
      </span>
      <span className="poolse-typing__label">{text}</span>
    </div>
  );
}
