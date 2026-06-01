import { useRef, useState, type KeyboardEvent } from 'react';
import type { Message, Uuid } from '@poolse/sdk';
import { handleListEnter } from './listAutocomplete.js';
import { PoolseIcon } from './PoolseIcon.js';

export interface MessageComposerProps {
  /**
   * Called when the user submits a message. Second arg carries
   * optional metadata (currently just `quoted_message_id` when the
   * caller has wired a `replyingTo`). Return value is awaited so the
   * input can disable until send completes.
   */
  onSend: (body: string, opts?: { quoted_message_id?: Uuid }) => Promise<unknown> | void;
  /** Called on every keystroke. Hook this to `useTyping().signalTyping`. */
  onTyping?: () => void;
  placeholder?: string;
  disabled?: boolean;
  /**
   * When set, renders a small quote chip above the input — the
   * caller-owned "I'm about to quote-reply to this message" state.
   * On submit, the message's id is forwarded as `quoted_message_id`.
   * The composer does NOT clear this prop itself; the caller should
   * clear `replyingTo` inside `onSend` after a successful send.
   */
  replyingTo?: Message | null;
  /** User clicked the (x) on the reply chip. Caller clears `replyingTo`. */
  onCancelReply?: () => void;
  /** Friendly display label for the quoted sender. Defaults to user id slice. */
  labelFor?: (userId: Uuid) => string;
}

/**
 * Single-line composer with Enter-to-send (Shift+Enter = newline).
 * Disables while the send is in flight so duplicate submits are
 * impossible from the UI side (the SDK also dedupes via Idempotency-Key).
 */
export function MessageComposer({
  onSend,
  onTyping,
  placeholder = 'Type a message…',
  disabled = false,
  replyingTo,
  onCancelReply,
  labelFor,
}: MessageComposerProps) {
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const submit = async () => {
    const trimmed = value.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      await onSend(trimmed, replyingTo ? { quoted_message_id: replyingTo.id } : undefined);
      setValue('');
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      // Smart list continuation: if the caret is on a list item line,
      // Enter extends/ends the list instead of submitting. Falls
      // through to submit() when not in a list.
      const ta = e.currentTarget;
      const caret = ta.selectionStart;
      const result = handleListEnter(value, caret);
      if (result) {
        e.preventDefault();
        setValue(result.value);
        requestAnimationFrame(() => {
          taRef.current?.setSelectionRange(result.caret, result.caret);
        });
        return;
      }
      e.preventDefault();
      void submit();
    }
    // Esc dismisses the reply chip — matches WhatsApp / Telegram /
    // Slack convention. No-op when there's nothing to dismiss.
    if (e.key === 'Escape' && replyingTo && onCancelReply) {
      e.preventDefault();
      onCancelReply();
    }
  };

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    onTyping?.();
  };

  return (
    <form
      className="poolse-composer"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {replyingTo && (
        <ReplyChip
          message={replyingTo}
          {...(labelFor ? { labelFor } : {})}
          {...(onCancelReply ? { onCancel: onCancelReply } : {})}
        />
      )}
      <div className="poolse-composer__row">
        <textarea
          ref={taRef}
          className="poolse-composer__input"
          rows={1}
          value={value}
          onChange={onChange}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          disabled={disabled || sending}
        />
        <button
          type="submit"
          className="poolse-composer__send"
          disabled={disabled || sending || value.trim() === ''}
          aria-label="Send message"
        >
          <PoolseIcon name="send-fill" label={null} />
        </button>
      </div>
    </form>
  );
}

function ReplyChip({
  message,
  labelFor,
  onCancel,
}: {
  message: Message;
  labelFor?: (userId: Uuid) => string;
  onCancel?: () => void;
}) {
  const senderLabel = message.sender_id
    ? (labelFor?.(message.sender_id) ?? `User ${message.sender_id.slice(0, 6)}`)
    : 'Unknown';
  const preview = message.body ?? '';
  return (
    <div className="poolse-composer__reply" role="status">
      <div className="poolse-composer__reply-body">
        <span className="poolse-composer__reply-label">Replying to {senderLabel}</span>
        <span className="poolse-composer__reply-preview">{preview}</span>
      </div>
      {onCancel && (
        <button
          type="button"
          className="poolse-composer__reply-cancel"
          onClick={onCancel}
          aria-label="Cancel reply"
          title="Cancel reply"
        >
          <PoolseIcon name="close" size={14} label={null} />
        </button>
      )}
    </div>
  );
}
