import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import type { Message, MessageCreateRequest, Uuid } from '@poolse/sdk';
import { useUserLabel, type FormatKind, type SlashCommand } from '@poolse/react';
import {
  ComposerEmojiButton,
  insertAtCaret,
  sendErrorText,
  useComposerAttachments,
} from './composerParts.js';
import {
  DlpWarningDialog,
  FormattingToolbar,
  useComposerExtras,
  useDlpGuard,
} from './composerExtras.js';
import { composerAction, DEFAULT_KEYMAP, isImeComposing, type ComposerKeymap } from './keymap.js';
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
   * stay disabled until send completes. Resolve to `false` to keep the
   * draft (text and attachments) in the composer, e.g. a cancelled
   * `beforeSend`.
   */
  onSend: (body: string, opts?: ComposerSendOptions) => Promise<unknown> | void;
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
  /**
   * Composer shortcuts (send, new line, edit last, cancel) — see
   * `ComposerKeymap`. Defaults: Enter / Cmd+Enter send, Shift+Enter new
   * line, ↑ in an empty composer edits your last message, Esc cancels
   * the reply.
   */
  keymap?: ComposerKeymap;
  /**
   * ↑ in an empty composer: edit your last message. Return `false`
   * when there's none to edit (the caret then moves as usual).
   */
  onEditLast?: () => boolean | void;
  /**
   * Show the Markdown formatting toolbar (bold, italic, strike, code,
   * link, quote, lists, checklist, code block, table) above the input.
   * The Mod+B / I / E / K and Mod+Shift+X shortcuts work either way.
   * Default `false`. Pass an array to choose the buttons and their order.
   */
  formattingToolbar?: boolean | readonly FormatKind[];
  /**
   * Slash commands to suggest when the message starts with `/` (IN3):
   * the apps' commands from the Workspace API. Picking one inserts
   * `/name `; the message is sent as typed (`parseSlashCommand` splits it).
   */
  commands?: readonly SlashCommand[];
}

/**
 * `ConversationView` / `ThreadView`'s `beforeSend`: sees the message about
 * to go out and returns it (changed or not), or `false` to cancel — the
 * text and files then stay in the composer.
 */
export type BeforeSend = (
  draft: MessageCreateRequest,
) => MessageCreateRequest | false | Promise<MessageCreateRequest | false>;

/**
 * `ConversationView` / `ThreadView`'s `composerProps`: passed through to the
 * composer. The view keeps sending, quoting and editing-last to itself;
 * `onValueChange` and `onTyping` are called alongside its own.
 */
export type ComposerPassThroughProps = Partial<
  Omit<MessageComposerProps, 'onSend' | 'replyingTo' | 'onCancelReply' | 'onEditLast'>
>;

/** The second argument of `onSend`. */
export interface ComposerSendOptions {
  quoted_message_id?: Uuid;
  attachment_ids?: Uuid[];
  /**
   * Set when the sender chose "Send anyway" on a data-loss-prevention
   * warning (AD6): pass it on to `messages.send`.
   */
  dlp_acknowledged?: true;
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
  /** Insert text at the caret (replacing a selection), as the emoji button does. */
  insertText: (text: string) => void;
  /** Empty the input. Queued attachments stay. */
  clear: () => void;
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
      keymap = DEFAULT_KEYMAP.composer,
      onEditLast,
      formattingToolbar = false,
      commands,
    },
    ref,
  ) {
    const [value, setValue] = useState('');
    const [sending, setSending] = useState(false);
    // Why the last send didn't go out; its text is back in the box.
    const [sendError, setSendError] = useState<string | null>(null);
    const taRef = useRef<HTMLTextAreaElement | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    useAutogrow(taRef, value);
    const extras = useComposerExtras({
      value,
      setValue,
      taRef,
      formatting: true,
      commands,
    });
    const dlp = useDlpGuard();

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
        insertText: (text: string) => setValue((v) => insertAtCaret(v, text, taRef)),
        clear: () => setValue(''),
        focus: () => taRef.current?.focus(),
      }),
      [addFiles],
    );

    // Sweep ready chips out of the queue once they've been attached and
    // sent. Errored chips stay until dismissed.
    const sweepSent = (sent: readonly { localId: string }[]) => {
      for (const it of sent) uploads.remove(it.localId);
      uploads.clearRejected();
    };
    // The files of a send held back by data-loss prevention: "Send
    // anyway" sends them, so they're swept then.
    const heldRef = useRef<readonly { localId: string }[]>([]);

    const submit = async () => {
      const trimmed = value.trim();
      const ready = uploads.ready;
      heldRef.current = ready;
      const hasReady = ready.length > 0;
      // Allow attachment-only sends (no body).
      if ((!trimmed && !hasReady) || sending || uploading) return;
      // Snapshot + clear synchronously so the textarea is empty on
      // the next keystroke even if the send round-trip is slow.
      // Otherwise the user types into the still-present old text and
      // the new characters append to the stale message.
      const opts: ComposerSendOptions = {
        ...(replyingTo ? { quoted_message_id: replyingTo.id } : {}),
        ...(hasReady ? { attachment_ids: ready.map((it) => it.attachment!.id) } : {}),
      };
      setValue('');
      setSendError(null);
      setSending(true);
      try {
        // Pass `undefined` (not an empty object) when there are no
        // opts — callers that only care about body can ignore the
        // second arg, and tests that assert on its identity stay clean.
        let kept = false;
        const sent = await dlp.guard(trimmed, async (ack) => {
          const o: ComposerSendOptions = ack ? { ...opts, dlp_acknowledged: true } : opts;
          if ((await onSend(trimmed, Object.keys(o).length > 0 ? o : undefined)) === false) {
            kept = true;
          }
        });
        if (sent && !kept) {
          sweepSent(ready);
        } else {
          // Held back (data-loss prevention, a cancelled beforeSend): put
          // the text back for "Edit"; the files are still queued.
          setValue((now) => (now ? now : trimmed));
        }
      } catch (err) {
        // The send failed: nothing went out, so the words go back in
        // the box (unless the user already started typing again).
        setValue((now) => (now ? now : trimmed));
        setSendError(sendErrorText(err));
      } finally {
        setSending(false);
      }
    };

    const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Mid-composition (CJK input): the keys belong to the IME.
      if (isImeComposing(e)) return;
      if (extras.onKeyDown(e)) return;
      const action = composerAction(e, keymap);
      if (action === 'editLast') {
        if (value === '' && onEditLast && onEditLast() !== false) e.preventDefault();
        return;
      }
      if (action === 'newline' && e.key === 'Enter' && !e.shiftKey) {
        // A plain Enter as new line still continues a list.
        const result = handleListEnter(value, e.currentTarget.selectionStart);
        if (result) {
          e.preventDefault();
          setValue(result.value);
          requestAnimationFrame(() => {
            taRef.current?.setSelectionRange(result.caret, result.caret);
          });
        }
        return;
      }
      if (action === 'send') {
        // Smart list continuation: if the caret is on a list item line,
        // a plain Enter extends/ends the list instead of submitting.
        const ta = e.currentTarget;
        const caret = ta.selectionStart;
        const result =
          e.key === 'Enter' && !e.metaKey && !e.ctrlKey ? handleListEnter(value, caret) : null;
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
      if (action === 'cancel' && replyingTo && onCancelReply) {
        e.preventDefault();
        onCancelReply();
      }
    };

    const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setValue(e.target.value);
      extras.track(e.target);
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
        style={commands ? { position: 'relative' } : undefined}
      >
        {formattingToolbar && (
          <FormattingToolbar
            onFormat={extras.format}
            disabled={disabled || sending}
            {...(Array.isArray(formattingToolbar) ? { actions: formattingToolbar } : {})}
          />
        )}
        {sendError && (
          <p className="poolse-composer__error" role="alert">
            {sendError}
          </p>
        )}
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
                aria-label="Attach files"
                tabIndex={-1}
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
            onSelect={(e) => extras.track(e.currentTarget)}
            placeholder={placeholder}
            disabled={disabled || sending}
            aria-label={placeholder}
            {...extras.textareaProps}
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
        {extras.menu}
        {dlp.pending && (
          <DlpWarningDialog
            outcome={dlp.pending.outcome}
            onEdit={() => {
              dlp.dismiss();
              taRef.current?.focus();
            }}
            onSendAnyway={() => {
              const { retry, body } = dlp.pending!;
              const held = heldRef.current;
              setValue('');
              setSending(true);
              void retry()
                .then((sent) => {
                  if (sent) sweepSent(held);
                  else setValue((now) => (now ? now : body));
                })
                .catch((err: unknown) => {
                  setValue((now) => (now ? now : body));
                  setSendError(sendErrorText(err));
                })
                .finally(() => setSending(false));
            }}
          />
        )}
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
  const senderLabel = useUserLabel(message.sender_external_id, labelFor);
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
