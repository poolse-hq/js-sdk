import type { ReactNode } from 'react';

export interface EmptyStateProps {
  /** What's empty, in a few words: "No messages yet". */
  title: ReactNode;
  /** What to do next: "Say hello — your message starts the conversation." */
  hint?: ReactNode;
  /** A button or link for the next step. */
  action?: ReactNode;
  className?: string;
}

/**
 * An empty screen that says what to do next. The components use it for
 * their defaults (an empty conversation list, an empty channel, a search
 * with no results); pass your own `emptyState` to any of them to
 * replace it, or use this to keep the look.
 */
export function EmptyState({ title, hint, action, className }: EmptyStateProps) {
  return (
    <div className={['poolse-empty-state', className].filter(Boolean).join(' ')} role="status">
      <p className="poolse-empty-state__title">{title}</p>
      {hint ? <p className="poolse-empty-state__hint">{hint}</p> : null}
      {action ? <div className="poolse-empty-state__action">{action}</div> : null}
    </div>
  );
}
