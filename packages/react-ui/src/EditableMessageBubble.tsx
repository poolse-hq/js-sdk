// EditableMessageBubble — extension of MessageBubble that supports
// in-place editing. When `editing` is true, renders a textarea + save
// + cancel buttons in place of the bubble's body. Used internally by
// ConversationView when the user triggers edit from MessageActions.
//
// Customers who want a different edit affordance (modal, side pane,
// in-context AI suggestions, etc.) can compose MessageBubble +
// useMessages.edit themselves and skip this component.

import type { Message } from '@poolse/sdk';
import { useState, type KeyboardEvent } from 'react';
import { MessageBubble } from './MessageBubble.js';

export interface EditableMessageBubbleProps {
  message: Message;
  currentUserId: string | null;
  readState?: 'sent' | 'read';
  /** Controlled — parent owns the editing state. */
  editing: boolean;
  /** Called with the new body when the user saves. Should return the promise from `useMessages.edit`. */
  onSave: (body: string) => Promise<unknown> | void;
  /** Called when the user cancels (Esc or click cancel). */
  onCancel: () => void;
}

export function EditableMessageBubble({
  message,
  currentUserId,
  readState,
  editing,
  onSave,
  onCancel,
}: EditableMessageBubbleProps) {
  // Local draft — initial value tracks the message body each time we
  // enter edit mode (handled by `editing ? ... : ...` key on textarea).
  const [draft, setDraft] = useState<string>(message.body ?? '');
  const [saving, setSaving] = useState(false);

  if (!editing) {
    return (
      <MessageBubble
        message={message}
        currentUserId={currentUserId}
        {...(readState ? { readState } : {})}
      />
    );
  }

  const submit = async () => {
    const trimmed = draft.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      await onSave(trimmed);
    } finally {
      setSaving(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  // Self-message styling — edit only makes sense for messages you sent.
  const isSelf = currentUserId !== null && message.sender_id === currentUserId;
  const className = [
    'poolse-message',
    'poolse-message--editing',
    isSelf ? 'poolse-message--self' : 'poolse-message--other',
  ].join(' ');

  return (
    <div className={className}>
      <textarea
        key={message.id} // reset draft when switching message
        className="poolse-message__edit"
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        rows={Math.max(1, draft.split('\n').length)}
        disabled={saving}
      />
      <div className="poolse-message__edit-actions">
        <button
          type="button"
          className="poolse-message__edit-btn"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </button>
        <button
          type="button"
          className="poolse-message__edit-btn poolse-message__edit-btn--primary"
          onClick={() => void submit()}
          disabled={saving || draft.trim() === ''}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
