import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import type { Message, Uuid } from '@poolse/sdk';
import { ComposerEmojiButton, insertAtCaret, useComposerAttachments } from './composerParts.js';
import { handleListEnter } from './listAutocomplete.js';
import { PoolseIcon } from './PoolseIcon.js';
import { UploadQueueStrip } from './UploadQueueStrip.js';
import { useAutogrow } from './useAutogrow.js';

export interface MessageComposerProps {
  /**
   * Called when the user submits a message. Second arg carries
   * optional metadata: `quoted_message_id` when replying, and
   * `attachment_ids` (resolved from the composer's upload queue) when
   * files were attached. Return value is awaited so the composer can
   * stay disabled until send completes.
   */
  onSend: (
    body: string,
    opts?: { quoted_message_id?: Uuid; attachment_ids?: Uuid[] },
  ) => Promise<unknown> | void;
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
  /** Friendly display label for the quoted sender, keyed by `external_id`. */
  labelFor?: (externalId: string) => string;
  /**
   * Show the paperclip + queue strip + accept dropped files via
   * `ref.current.addFiles(files)`. Default `true`. Set `false` to
   * disable attachments entirely (text-only composer).
   */
  attachments?: boolean;
  /** An emoji button that opens `<EmojiPicker>` and inserts at the caret. Default `true`. */
  emojiPicker?: boolean;
  /**
   * The text changed (typing, an emoji, a restored draft, the reset after
   * a send). Not called for the initial empty value.
   */
  onValueChange?: (value: string) => void;
  /** Largest attachment accepted, in bytes; bigger files show an error chip instead. */
  maxFileSize?: number;
  /**
   * Accepted attachment types — MIME types, wildcards (`'image/*'`) or
   * extensions (`'.pdf'`). Other files show an error chip instead.
   */
  acceptFileTypes?: string[];
}

/**
 * Imperative handle exposed via `ref` for parents that want to forward
 * dropped files (drag-and-drop on the conversation pane, paste from
 * clipboard, etc.) into the composer's upload queue.
 */
export interface MessageComposerHandle {
  /** Enqueue files to upload + attach to the next send. No-op when `attachments={false}`. */
  addFiles: (files: File[]) => void;
  /** The text in the input right now. */
  getText: () => string;
  /** Replace the text in the input (e.g. to restore a draft or a failed send). */
  setText: (text: string) => void;
  /** Focus the input. */
  focus: () => void;
}

/**
 * Composer with Enter-to-send (Shift+Enter = newline), smart list
 * continuation, optional reply chip, and built-in attachment support:
 * a paperclip picker, a queue strip of in-flight uploads with progress
 * and cancel, and "send body + attachments together" semantics.
 *
 * Disables submit while sends are in flight OR while any attachment is
 * still uploading — the server-side `Idempotency-Key` handles the rare
 * race the UI doesn't catch.
 */
export const MessageComposer = forwardRef<MessageComposerHandle, MessageComposerProps>(
  function MessageComposer(
    {
      onSend,
      onTyping,
      placeholder = 'Type a message…',
      disabled = false,
      replyingTo,
      onCancelReply,
      labelFor,
      attachments = true,
      emojiPicker = true,
      maxFileSize,
      acceptFileTypes,
      onValueChange,
    },
    ref,
  ) {
    const [value, setValue] = useState('');
    const [sending, setSending] = useState(false);
    const taRef = useRef<HTMLTextAreaElement | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    useAutogrow(taRef, value);

    // Every staged chip shows — pending, uploading, ready, errored, and
    // files refused before upload (too big, wrong type). Ready chips
    // are the "goes out on send" signal; they're swept after the send.
    const uploads = useComposerAttachments(attachments, {
      ...(maxFileSize !== undefined ? { maxFileSize } : {}),
      ...(acceptFileTypes ? { acceptFileTypes } : {}),
    });
    const { addFiles, uploading } = uploads;
    const visibleUploads = uploads.items;
    const readyCount = uploads.ready.length;

    const valueRef = useRef(value);
    valueRef.current = value;
    // Report text changes (drafts), skipping the first, empty render.
    const onValueChangeRef = useRef(onValueChange);
    onValueChangeRef.current = onValueChange;
    const reportedRef = useRef(value);
    useEffect(() => {
      if (reportedRef.current === value) return;
      reportedRef.current = value;
      onValueChangeRef.current?.(value);
    }, [value]);
    useImperativeHandle(
      ref,
      () => ({
        addFiles,
        getText: () => valueRef.current,
        setText: (text: string) => setValue(text),
        focus: () => taRef.current?.focus(),
      }),
      [addFiles],
    );

    const submit = async () => {
      const trimmed = value.trim();
      const ready = uploads.ready;
      const hasReady = ready.length > 0;
      // Allow attachment-only sends (no body).
      if ((!trimmed && !hasReady) || sending || uploading) return;
      // Snapshot + clear synchronously so the textarea is empty on
      // the next keystroke even if the send round-trip is slow.
      // Otherwise the user types into the still-present old text and
      // the new characters append to the stale message.
      const opts: { quoted_message_id?: Uuid; attachment_ids?: Uuid[] } = {
        ...(replyingTo ? { quoted_message_id: replyingTo.id } : {}),
        ...(hasReady ? { attachment_ids: ready.map((it) => it.attachment!.id) } : {}),
      };
      setValue('');
      // Sweep ready chips out of the queue now that they've been
      // attached + sent. Errored chips stay until dismissed.
      for (const it of ready) uploads.remove(it.localId);
      uploads.clearRejected();
      setSending(true);
      try {
        // Pass `undefined` (not an empty object) when there are no
        // opts — callers that only care about body can ignore the
        // second arg, and tests that assert on its identity stay clean.
        await onSend(trimmed, Object.keys(opts).length > 0 ? opts : undefined);
      } finally {
        setSending(false);
      }
    };

    const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        // Smart list continuation: if the caret is on a list item line,
        // Enter extends/ends the list instead of submitting.
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

    const canSend = !disabled && !sending && !uploading && (value.trim() !== '' || readyCount > 0);

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
        {attachments && visibleUploads.length > 0 && (
          <UploadQueueStrip
            items={visibleUploads}
            onCancel={uploads.cancel}
            onDismiss={uploads.dismiss}
            previewFor={uploads.previewFor}
          />
        )}
        <div className="poolse-composer__row">
          {attachments && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                {...(uploads.accept ? { accept: uploads.accept } : {})}
                className="poolse-attach-input"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length > 0) addFiles(files);
                  // Reset so re-picking the same file fires onChange again.
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
            onPaste={uploads.onPaste}
            placeholder={placeholder}
            disabled={disabled || sending}
            aria-label={placeholder}
          />
          {emojiPicker && (
            <ComposerEmojiButton
              disabled={disabled || sending}
              onPick={(emoji) => setValue((v) => insertAtCaret(v, emoji, taRef))}
            />
          )}
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
      </form>
    );
  },
);

function ReplyChip({
  message,
  labelFor,
  onCancel,
}: {
  message: Message;
  labelFor?: (externalId: string) => string;
  onCancel?: () => void;
}) {
  const senderLabel = message.sender_external_id
    ? (labelFor?.(message.sender_external_id) ?? message.sender_external_id)
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
