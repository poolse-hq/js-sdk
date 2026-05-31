import { useState, type KeyboardEvent } from 'react';
import { PoolseIcon } from './PoolseIcon.js';

export interface MessageComposerProps {
  /** Called when the user submits a message. Return value awaited so the input can disable until send completes. */
  onSend: (body: string) => Promise<unknown> | void;
  /** Called on every keystroke. Hook this to `useTyping().signalTyping`. */
  onTyping?: () => void;
  placeholder?: string;
  disabled?: boolean;
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
}: MessageComposerProps) {
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);

  const submit = async () => {
    const trimmed = value.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      await onSend(trimmed);
      setValue('');
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
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
      <textarea
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
    </form>
  );
}
