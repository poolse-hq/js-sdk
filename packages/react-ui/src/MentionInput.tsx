// MentionInput — drop-in replacement for `MessageComposer` that
// pops a member dropdown when the user types `@`. Selecting a
// member inserts `@display-name` into the text and records the
// `user_id` in the mentions array that gets POSTed with the send.

import type { Membership, Message, MessageCreateRequest, Uuid } from '@poolse/sdk';
import { useAttachmentUpload, useMembers } from '@poolse/react';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { handleListEnter } from './listAutocomplete.js';
import { PoolseIcon } from './PoolseIcon.js';
import { UploadQueueStrip } from './UploadQueueStrip.js';
import { UserName } from './UserName.js';
import { useAutogrow } from './useAutogrow.js';
import type { MessageComposerHandle } from './MessageComposer.js';

export interface MentionInputProps {
  conversationId: Uuid;
  /**
   * Called when the user submits a message. Receives the full
   * `MessageCreateRequest` shape (so `mentions` is wired correctly),
   * not just `body`. Typically:
   *   `onSend={(req) => send(req)}`  // from useMessages
   */
  onSend: (req: MessageCreateRequest) => Promise<unknown> | void;
  onTyping?: () => void;
  placeholder?: string;
  disabled?: boolean;
  /**
   * Resolve a user_id to a display name for the @ dropdown.
   * Defaults to the first 8 chars of the id.
   */
  labelFor?: (userId: Uuid) => string;
  /**
   * Caller-owned "I'm replying to this message" state. Mirrors
   * `<MessageComposer replyingTo>` — renders a quote chip above the
   * input and includes `quoted_message_id` on send.
   */
  replyingTo?: Message | null;
  /** User clicked the (x) on the reply chip. Caller clears state. */
  onCancelReply?: () => void;
  /**
   * Same as `<MessageComposer attachments>`: enables the paperclip
   * button + queue strip + ref-exposed `addFiles` for drag-drop.
   * Defaults to `true`.
   */
  attachments?: boolean;
}

interface MentionState {
  /** Position of the active `@` in the textarea. */
  start: number;
  /** Search query typed after `@`. */
  query: string;
}

export const MentionInput = forwardRef<MessageComposerHandle, MentionInputProps>(
  function MentionInput(
    {
      conversationId,
      onSend,
      onTyping,
      placeholder = 'Type a message…',
      disabled = false,
      labelFor,
      replyingTo,
      onCancelReply,
      attachments = true,
    },
    ref,
  ) {
  const { members } = useMembers(conversationId);
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const [mention, setMention] = useState<MentionState | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  // user_ids that have been selected via the mention picker (the
  // payload we ship in MessageCreateRequest.mentions).
  const selectedMentions = useRef<Set<Uuid>>(new Set());
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  useAutogrow(taRef, value);

  const { queue, uploadAll, cancel: cancelUpload, remove: removeUpload } = useAttachmentUpload();
  const visibleUploads = queue.filter(
    (it) => it.status === 'pending' || it.status === 'uploading' || it.status === 'error',
  );
  const readyCount = queue.filter((it) => it.status === 'ready').length;
  const uploading = queue.some((it) => it.status === 'pending' || it.status === 'uploading');

  const addFiles = (files: File[]) => {
    if (!attachments || files.length === 0) return;
    void uploadAll(
      files.map((f) => ({
        body: f,
        contentType: f.type || 'application/octet-stream',
        byteSize: f.size,
        filename: f.name,
      })),
    ).catch(() => {
      // Per-item error stays on chip.
    });
  };
  useImperativeHandle(ref, () => ({ addFiles }), [addFiles, attachments]);

  const label = labelFor ?? ((id: Uuid) => id.slice(0, 8));

  // Filter the member list to the current query.
  const filtered = mention
    ? members.filter((m) => label(m.user_id).toLowerCase().includes(mention.query.toLowerCase()))
    : [];

  // Reset active selection whenever the candidate list changes.
  useEffect(() => {
    setActiveIdx(0);
  }, [filtered.length, mention?.query]);

  const submit = async () => {
    const trimmed = value.trim();
    const ready = queue.filter((it) => it.status === 'ready');
    const hasReady = ready.length > 0;
    if ((!trimmed && !hasReady) || sending || uploading) return;
    setSending(true);
    try {
      const mentions = Array.from(selectedMentions.current);
      await onSend({
        body: trimmed,
        ...(mentions.length > 0 ? { mentions } : {}),
        ...(replyingTo ? { quoted_message_id: replyingTo.id } : {}),
        ...(hasReady ? { attachment_ids: ready.map((it) => it.attachment!.id) } : {}),
      });
      setValue('');
      selectedMentions.current = new Set();
      for (const it of ready) removeUpload(it.localId);
    } finally {
      setSending(false);
    }
  };

  const insertMention = (m: Membership) => {
    if (!mention) return;
    const name = label(m.user_id);
    const before = value.slice(0, mention.start);
    const after = value.slice(mention.start + 1 + mention.query.length);
    const inserted = `@${name} `;
    const next = `${before}${inserted}${after}`;
    selectedMentions.current.add(m.user_id);
    setValue(next);
    setMention(null);
    // Move caret to right after the inserted mention.
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (!ta) return;
      const pos = before.length + inserted.length;
      ta.focus();
      ta.setSelectionRange(pos, pos);
    });
  };

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    setValue(next);
    onTyping?.();

    // Detect an active @mention: look back from the caret for an `@`
    // not preceded by a word character. If found, extract the query.
    const caret = e.target.selectionStart ?? next.length;
    const head = next.slice(0, caret);
    const at = head.lastIndexOf('@');
    if (at === -1) {
      setMention(null);
      return;
    }
    const charBefore = at === 0 ? ' ' : head.charAt(at - 1);
    const isAtBoundary = /\s/.test(charBefore);
    const query = head.slice(at + 1);
    // The query is the run of non-whitespace chars after `@`.
    if (isAtBoundary && !/\s/.test(query)) {
      setMention({ start: at, query });
    } else {
      setMention(null);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention && filtered.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => (i + 1) % filtered.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => (i - 1 + filtered.length) % filtered.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        const pick = filtered[activeIdx];
        if (pick) {
          e.preventDefault();
          insertMention(pick);
          return;
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMention(null);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      // Smart list continuation — same behavior as MessageComposer.
      // Only kicks in when the mention menu is closed (the menu's own
      // Enter handler is in the block above and returns early).
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
    // Esc clears the reply chip when one is active (and the mention
    // menu is closed — that branch is handled above).
    if (e.key === 'Escape' && replyingTo && onCancelReply && !mention) {
      e.preventDefault();
      onCancelReply();
    }
  };

  const replyLabel = replyingTo?.sender_id
    ? (labelFor?.(replyingTo.sender_id) ?? `User ${replyingTo.sender_id.slice(0, 6)}`)
    : 'Unknown';

  const canSend =
    !disabled && !sending && !uploading && (value.trim() !== '' || readyCount > 0);

  return (
    <form
      className="poolse-composer"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      style={{ position: 'relative' }}
    >
      {replyingTo && (
        <div className="poolse-composer__reply" role="status">
          <div className="poolse-composer__reply-body">
            <span className="poolse-composer__reply-label">Replying to {replyLabel}</span>
            <span className="poolse-composer__reply-preview">{replyingTo.body ?? ''}</span>
          </div>
          {onCancelReply && (
            <button
              type="button"
              className="poolse-composer__reply-cancel"
              onClick={onCancelReply}
              aria-label="Cancel reply"
              title="Cancel reply"
            >
              <PoolseIcon name="close" size={14} label={null} />
            </button>
          )}
        </div>
      )}
      {attachments && visibleUploads.length > 0 && (
        <UploadQueueStrip
          items={visibleUploads}
          onCancel={cancelUpload}
          onDismiss={removeUpload}
        />
      )}
      <div className="poolse-composer__row">
        {attachments && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="poolse-attach-input"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                if (files.length > 0) addFiles(files);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              className="poolse-composer__attach"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || sending}
              aria-label="Attach files"
              title="Attach files"
            >
              <PoolseIcon name="attachment" size={20} label={null} />
            </button>
          </>
        )}
        <textarea
          ref={taRef}
          className="poolse-composer__input"
          rows={1}
          value={value}
          onChange={onChange}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          disabled={disabled || sending}
          aria-label={placeholder}
          role="combobox"
          aria-expanded={Boolean(mention && filtered.length > 0)}
          aria-controls="poolse-mention-menu"
          aria-autocomplete="list"
          {...(mention && filtered.length > 0
            ? { 'aria-activedescendant': `poolse-mention-opt-${activeIdx}` }
            : {})}
        />
        <button
          type="submit"
          className="poolse-composer__send"
          disabled={!canSend}
          aria-label="Send message"
          title={uploading ? 'Waiting for uploads…' : 'Send message'}
        >
          <PoolseIcon name="send-fill" label={null} />
        </button>
      </div>

      {mention && filtered.length > 0 && (
        <div
          id="poolse-mention-menu"
          className="poolse-mention-menu"
          role="listbox"
          aria-label="Members"
        >
          {filtered.map((m, i) => (
            <div
              key={m.id}
              id={`poolse-mention-opt-${i}`}
              role="option"
              aria-selected={i === activeIdx}
              className={`poolse-mention-menu__item${i === activeIdx ? ' poolse-mention-menu__item--active' : ''}`}
              onMouseDown={(e) => {
                // Use mousedown so the textarea doesn't lose focus
                // before the insert lands.
                e.preventDefault();
                insertMention(m);
              }}
            >
              {/* Display via the shared 3-tier chain so the customer's
                  userResolver lights up names here. Filter still runs
                  against the sync `labelFor` / userId slice (line 70)
                  because we don't have a guarantee names are resolved
                  in time to filter against. */}
              <span>@</span>
              <UserName userId={m.user_id} {...(labelFor ? { labelFor } : {})} />
            </div>
          ))}
        </div>
      )}
    </form>
  );
  },
);
