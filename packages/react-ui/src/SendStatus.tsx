import type { Message } from '@poolse/sdk';

export interface SendStatusProps {
  message: Message;
  /** Send it again (failed or queued). */
  onRetry?: () => void;
  /** Drop the unsent message. */
  onDiscard?: () => void;
  /** Align with the bubble: right for your own messages. */
  align?: 'left' | 'right';
}

/**
 * Under an unsent message: "Waiting for network…" while it's queued
 * offline (it goes out by itself on reconnect), or "Not sent" with
 * Retry and Delete when the server refused it. Nothing for a message
 * that's on its way or sent.
 */
export function SendStatus({ message, onRetry, onDiscard, align = 'right' }: SendStatusProps) {
  const status = message.local_status;
  if (status !== 'queued' && status !== 'failed') return null;
  const failed = status === 'failed';
  return (
    <div
      className={[
        'poolse-send-status',
        `poolse-send-status--${status}`,
        `poolse-send-status--${align}`,
      ].join(' ')}
      role="status"
    >
      <span className="poolse-send-status__text">
        {failed
          ? message.local_error
            ? `Not sent: ${message.local_error}`
            : 'Not sent'
          : 'Waiting for network…'}
      </span>
      {onRetry && (
        <button type="button" className="poolse-send-status__button" onClick={onRetry}>
          {failed ? 'Retry' : 'Send now'}
        </button>
      )}
      {failed && onDiscard && (
        <button
          type="button"
          className="poolse-send-status__button poolse-send-status__button--danger"
          onClick={onDiscard}
        >
          Delete
        </button>
      )}
    </div>
  );
}
