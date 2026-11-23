import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { AttachmentUploadInput, Message, MessageCreateRequest, Uuid } from '@poolse/sdk';
import {
  applyFormat,
  applySlashCommand,
  readDlpError,
  useUser,
  type DlpOutcome,
  type FormatKind,
  type SlashCommand,
} from '@poolse/react';

import { CommandSuggestions, DlpWarningSheet, FormattingToolbar } from './ComposerExtras.js';
import { EmojiPicker } from './EmojiPicker.js';
import { PoolseIcon } from './primitives/PoolseIcon.js';
import { UploadQueueStrip } from './UploadQueueStrip.js';
import { useSharedUpload } from './internal/uploadContext.js';
import { useSafeInsets } from './internal/safeArea.js';
import { useKeyboardOpen } from './internal/useKeyboardOpen.js';
import { useTheme } from './theme/PoolseTheme.js';

export interface MessageComposerProps {
  /**
   * Called when the user taps Send. Second arg carries
   * `quoted_message_id` (when replying) and `attachment_ids`
   * (resolved from the composer's upload queue). Awaited so the
   * composer disables until the send round-trips. Resolve to `false` to
   * keep the draft (text and files), e.g. a cancelled `beforeSend`.
   */
  onSend: (body: string, opts?: ComposerSendOptions) => Promise<unknown> | void;
  /** Called on every keystroke. Hook to `useTyping().signalTyping`. */
  onTyping?: () => void;
  placeholder?: string;
  disabled?: boolean;
  /** Renders a quote chip above the input; cleared by the caller in `onSend`. */
  replyingTo?: Message | null;
  /** User tapped (x) on the quote chip. */
  onCancelReply?: () => void;
  /** Display label for the quoted sender, keyed by `external_id`. */
  labelFor?: (externalId: string) => string;
  /** Show the paperclip + queue strip. Defaults true. */
  attachments?: boolean;
  /** Tap on the paperclip — wire to `<AttachmentPicker>` from the same package. */
  onAttachPress?: () => void;
  /**
   * Distance from the top of the screen to the top of the
   * KeyboardAvoidingView — typically the height of any navigation
   * header sitting above the chat. Pass this when the iOS keyboard
   * suggestions strip ends up covering the composer (a sign the
   * computed offset is wrong). Defaults to 0; on Android it's
   * ignored.
   */
  keyboardOffset?: number;
  /**
   * When set, the composer enters edit mode: prefills the input with
   * the message body and renders an "Editing message" chip above
   * (mirrors `replyingTo`). Tapping Send calls `onSaveEdit(body)`
   * instead of `onSend`; `onCancelEdit` clears the chip and restores
   * the previous draft. Pass `null` (or omit) when not editing.
   */
  editingMessage?: Message | null;
  onCancelEdit?: () => void;
  onSaveEdit?: (body: string) => Promise<unknown> | void;
  /**
   * Controlled text. With `value`, the composer shows it and reports
   * keystrokes through `onChangeText` (ConversationView uses this for
   * drafts). Edit mode keeps its own text either way.
   */
  value?: string;
  /** Every change to the (non-edit) text, typed or programmatic. */
  onChangeText?: (text: string) => void;
  /** The cursor / selection moved. */
  onSelectionChange?: (selection: { start: number; end: number }) => void;
  /** An emoji button that opens `<EmojiPicker>` and inserts at the cursor. Defaults to true. */
  emojiPicker?: boolean;
  /** Rendered above the input row — e.g. `<MentionInput>`'s suggestions. */
  accessory?: ReactNode;
  /**
   * Show the Markdown formatting toolbar (bold, italic, strike, code,
   * link, quote, lists, checklist, code block, table) above the input.
   * Default `false`. Pass an array to choose the buttons and their order.
   */
  formattingToolbar?: boolean | readonly FormatKind[];
  /** Slash commands to suggest when the message starts with `/` (IN3). */
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
 * composer. The view keeps the text, sending, quoting and editing to
 * itself; `onTyping` runs alongside its own.
 */
export type ComposerPassThroughProps = Partial<
  Omit<
    MessageComposerProps,
    | 'onSend'
    | 'value'
    | 'onChangeText'
    | 'replyingTo'
    | 'onCancelReply'
    | 'editingMessage'
    | 'onCancelEdit'
    | 'onSaveEdit'
  >
>;

/** The second argument of `onSend`. */
export interface ComposerSendOptions {
  quoted_message_id?: Uuid;
  attachment_ids?: Uuid[];
  /** Set when the sender chose "Send anyway" on a data-loss-prevention warning (AD6). */
  dlp_acknowledged?: true;
}

/**
 * Imperative handle for parents that want to add files to the
 * composer's upload queue externally (drag/drop on a wrapper,
 * deep-link, attachment shortcut).
 */
export interface MessageComposerHandle {
  /** Enqueue ready-to-upload inputs. The picker component is the usual caller; this is the escape hatch. */
  addFiles: (inputs: AttachmentUploadInput[]) => void;
  focus: () => void;
  /** Empty the input. Queued files stay. */
  clear: () => void;
  /** The text in the input right now. */
  getText: () => string;
  /** Replace the text. */
  setText: (text: string) => void;
  /** Insert text at the cursor (replacing a selection). */
  insertText: (text: string) => void;
  /** Move the cursor (`start === end`) or select a range. */
  setSelection: (start: number, end: number) => void;
}

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
      onAttachPress,
      keyboardOffset: _keyboardOffset = 0,
      editingMessage = null,
      onCancelEdit,
      onSaveEdit,
      value: valueProp,
      onChangeText,
      onSelectionChange,
      emojiPicker = true,
      accessory,
      formattingToolbar = false,
      commands,
    },
    ref,
  ) {
    const theme = useTheme();
    const inputRef = useRef<TextInput>(null);
    const [innerValue, setInnerValue] = useState('');
    // Edit mode has its own text, so editing never overwrites (or gets
    // saved as) the draft.
    const [editValue, setEditValue] = useState('');
    const [sending, setSending] = useState(false);
    const [emojiOpen, setEmojiOpen] = useState(false);
    const selectionRef = useRef<{ start: number; end: number } | null>(null);
    const [cursor, setCursor] = useState(0);
    const [dlp, setDlp] = useState<{
      outcome: DlpOutcome;
      body: string;
      opts: ComposerSendOptions;
    } | null>(null);
    const isEditing = !!editingMessage;
    const draftValue = valueProp ?? innerValue;
    const value = isEditing ? editValue : draftValue;
    const onChangeTextRef = useRef(onChangeText);
    onChangeTextRef.current = onChangeText;
    const controlled = valueProp !== undefined;
    const setDraft = (text: string) => {
      if (!controlled) setInnerValue(text);
      onChangeTextRef.current?.(text);
    };
    const setValue = (text: string) => {
      if (isEditing) setEditValue(text);
      else setDraft(text);
    };
    const keyboardOpen = useKeyboardOpen();
    const upload = useSharedUpload();
    const insets = useSafeInsets();

    useImperativeHandle(
      ref,
      () => ({
        addFiles: (inputs) => {
          if (!attachments) return;
          for (const input of inputs) {
            void upload.upload(input);
          }
        },
        focus: () => inputRef.current?.focus(),
        clear: () => {
          if (!controlled) setInnerValue('');
          onChangeTextRef.current?.('');
        },
        getText: () => valueRef.current,
        setText: (text) => setValueRef.current(text),
        insertText: (text) => {
          const now = valueRef.current;
          const sel = selectionRef.current ?? { start: now.length, end: now.length };
          const caret = sel.start + text.length;
          applyTextRef.current(now.slice(0, sel.start) + text + now.slice(sel.end), {
            start: caret,
            end: caret,
          });
        },
        setSelection: (start, end) => {
          selectionRef.current = { start, end };
          inputRef.current?.setSelection?.(start, end);
        },
      }),
      [attachments, upload, controlled],
    );

    const readyAttachmentIds = upload.queue
      .filter((item) => item.status === 'ready' && item.attachment)
      .map((item) => item.attachment!.id);
    const isUploading = upload.queue.some(
      (item) => item.status === 'uploading' || item.status === 'pending',
    );

    // Entering edit mode for a message: prefill its body and focus so
    // the keyboard pops up with the cursor at the end. The draft is
    // untouched and shows again when editing ends.
    const editingIdRef = useRef<string | null>(null);
    useEffect(() => {
      const id = editingMessage?.id ?? null;
      if (id === editingIdRef.current) return;
      editingIdRef.current = id;
      if (id) {
        setEditValue(editingMessage?.body ?? '');
        inputRef.current?.focus();
      }
    }, [editingMessage?.id, editingMessage?.body]);

    const editChanged = isEditing && value.trim() !== (editingMessage?.body?.trim() ?? '');

    const submitDisabled =
      disabled ||
      sending ||
      isUploading ||
      (isEditing
        ? !editChanged || value.trim().length === 0
        : value.trim().length === 0 && readyAttachmentIds.length === 0);

    const handleSend = async () => {
      if (submitDisabled) return;
      // Snapshot + clear synchronously so the input is empty on the
      // next keystroke even if the send round-trip is slow. Otherwise
      // the user types into the still-present old text and the new
      // characters append to the stale message.
      const body = value.trim();
      setSending(true);
      try {
        if (isEditing && onSaveEdit) {
          // Edit mode: don't clear attachments or the reply chip;
          // we're just updating the body. The parent will clear
          // editingMessage on success, which triggers the effect
          // above to restore the prior draft.
          await onSaveEdit(body);
        } else {
          const replyId = replyingTo?.id;
          const attachmentIds = readyAttachmentIds;
          setDraft('');
          const opts: ComposerSendOptions = {
            ...(replyId ? { quoted_message_id: replyId } : {}),
            ...(attachmentIds.length > 0 ? { attachment_ids: attachmentIds } : {}),
          };
          try {
            if ((await onSend(body, opts)) === false) {
              // Held back by the app (beforeSend): text and files stay.
              if (!controlled) setInnerValue((now) => (now ? now : body));
              else onChangeTextRef.current?.(body);
              return;
            }
            upload.reset();
          } catch (err) {
            upload.reset();
            // Data-loss prevention held it back: show why, keep the text.
            const outcome = readDlpError(err);
            if (outcome) setDlp({ outcome, body, opts });
            // Put the text back so nothing typed is lost (the parent
            // shows why it failed). Uncontrolled: only if nothing new
            // was typed meanwhile; controlled: the parent decides.
            if (!controlled) setInnerValue((now) => (now ? now : body));
            else if (outcome) onChangeTextRef.current?.(body);
            if (!outcome) console.warn('[poolse/composer] send failed:', err);
          }
        }
      } catch (err) {
        console.warn('[poolse/composer] save failed:', err);
      } finally {
        setSending(false);
      }
    };

    // No KeyboardAvoidingView here — ConversationView wraps the whole
    // chat surface in a single KAV so the list + composer shift up
    // together. Wrapping only the composer inside a flex:1 parent
    // with no headroom pushed it below the visible area on iPhone
    // home-indicator devices.
    //
    // When the keyboard is closed we add the bottom safe-area inset
    // to keep the send/attach buttons off the home indicator. When
    // it's open the OS bottom inset is irrelevant (keyboard occupies
    // that space) and we collapse back to the base 10px padding to
    // avoid floating the composer above the keyboard.
    const paddingBottom = keyboardOpen ? 10 : Math.max(10, insets.bottom);

    const applyText = (next: string, sel: { start: number; end: number }) => {
      selectionRef.current = sel;
      setValue(next);
      setCursor(sel.end);
      // After React applies the new text, move the native selection.
      setTimeout(() => inputRef.current?.setSelection?.(sel.start, sel.end), 0);
    };
    // The handle outlives renders: read the latest text and setters.
    const valueRef = useRef(value);
    valueRef.current = value;
    const setValueRef = useRef(setValue);
    setValueRef.current = setValue;
    const applyTextRef = useRef(applyText);
    applyTextRef.current = applyText;
    const format = (kind: FormatKind) => {
      const sel = selectionRef.current ?? { start: value.length, end: value.length };
      const r = applyFormat(value, sel, kind);
      applyText(r.value, r.selection);
    };
    const sendAnyway = async () => {
      if (!dlp) return;
      const { body, opts } = dlp;
      setDlp(null);
      setDraft('');
      setSending(true);
      try {
        await onSend(body, { ...opts, dlp_acknowledged: true });
      } catch (err) {
        if (!controlled) setInnerValue((now) => (now ? now : body));
        else onChangeTextRef.current?.(body);
        console.warn('[poolse/composer] send failed:', err);
      } finally {
        setSending(false);
      }
    };
    return (
      <View
        style={[
          styles.wrap,
          {
            backgroundColor: theme.colors.surface,
            borderTopColor: theme.colors.border,
            paddingBottom,
          },
        ]}
      >
        {isEditing ? (
          <EditChip
            message={editingMessage!}
            {...(onCancelEdit ? { onCancel: onCancelEdit } : {})}
          />
        ) : replyingTo ? (
          <ReplyChip
            message={replyingTo}
            {...(labelFor ? { labelFor } : {})}
            {...(onCancelReply ? { onCancel: onCancelReply } : {})}
          />
        ) : null}

        {attachments && !isEditing ? <UploadQueueStrip /> : null}

        {isEditing ? null : accessory}

        {!isEditing && commands ? (
          <CommandSuggestions
            commands={commands}
            text={value}
            cursor={cursor}
            onPick={(c) => {
              const r = applySlashCommand(value, c.name);
              applyText(r.value, r.selection);
            }}
          />
        ) : null}

        {formattingToolbar ? (
          <FormattingToolbar
            onFormat={format}
            disabled={disabled || sending}
            {...(Array.isArray(formattingToolbar) ? { actions: formattingToolbar } : {})}
          />
        ) : null}

        <View style={styles.row}>
          {attachments && onAttachPress ? (
            <Pressable
              onPress={onAttachPress}
              hitSlop={8}
              style={styles.iconBtn}
              accessibilityRole="button"
              accessibilityLabel="Attach file"
            >
              <PoolseIcon name="attachment" size={22} color={theme.colors.textMuted} />
            </Pressable>
          ) : null}

          {emojiPicker ? (
            <Pressable
              onPress={() => setEmojiOpen(true)}
              hitSlop={8}
              style={styles.iconBtn}
              accessibilityRole="button"
              accessibilityLabel="Insert emoji"
            >
              <PoolseIcon name="emoji" size={22} color={theme.colors.textMuted} label={null} />
            </Pressable>
          ) : null}

          <TextInput
            ref={inputRef}
            value={value}
            onChangeText={(text) => {
              setValue(text);
              onTyping?.();
            }}
            onSelectionChange={(e) => {
              selectionRef.current = e.nativeEvent.selection;
              setCursor(e.nativeEvent.selection.end);
              if (!isEditing) onSelectionChange?.(e.nativeEvent.selection);
            }}
            placeholder={placeholder}
            accessibilityLabel={placeholder}
            placeholderTextColor={theme.colors.textSubtle}
            multiline
            editable={!disabled}
            style={[
              styles.input,
              {
                color: theme.colors.text,
                backgroundColor: theme.colors.surfaceAlt,
                borderRadius: theme.radii.lg,
                fontFamily: theme.fonts.body,
                fontSize: theme.fonts.sizeMd,
              },
            ]}
          />

          <Pressable
            onPress={handleSend}
            disabled={submitDisabled}
            style={[
              styles.sendBtn,
              {
                backgroundColor: submitDisabled ? theme.colors.textSubtle : theme.colors.accent,
                opacity: submitDisabled ? 0.6 : 1,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Send message"
          >
            <PoolseIcon name="send" size={18} color={theme.colors.accentText} />
          </Pressable>
        </View>

        {emojiPicker && emojiOpen ? (
          <EmojiPicker
            visible
            keepOpen
            title="Insert emoji"
            onClose={() => {
              setEmojiOpen(false);
              inputRef.current?.focus();
            }}
            onPick={(emoji) => {
              const sel = selectionRef.current ?? { start: value.length, end: value.length };
              const start = Math.min(sel.start, value.length);
              const end = Math.min(Math.max(sel.end, start), value.length);
              const next = value.slice(0, start) + emoji + value.slice(end);
              const cursor = start + emoji.length;
              selectionRef.current = { start: cursor, end: cursor };
              setValue(next);
            }}
          />
        ) : null}

        {dlp ? (
          <DlpWarningSheet
            outcome={dlp.outcome}
            onEdit={() => {
              setDlp(null);
              inputRef.current?.focus();
            }}
            onSendAnyway={() => void sendAnyway()}
          />
        ) : null}
      </View>
    );
  },
);

function EditChip({ message, onCancel }: { message: Message; onCancel?: () => void }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.replyChip,
        {
          backgroundColor: theme.colors.surfaceAlt,
          borderLeftColor: theme.colors.accent,
        },
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.replyName, { color: theme.colors.accent }]}>Editing message</Text>
        <Text style={[styles.replyBody, { color: theme.colors.textMuted }]} numberOfLines={1}>
          {message.body ?? '…'}
        </Text>
      </View>
      {onCancel ? (
        <Pressable onPress={onCancel} hitSlop={8} style={styles.replyCancel}>
          <PoolseIcon name="close" size={16} color={theme.colors.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

function ReplyChip({
  message,
  labelFor,
  onCancel,
}: {
  message: Message;
  labelFor?: (externalId: string) => string;
  onCancel?: () => void;
}) {
  const theme = useTheme();
  // Priority: explicit prop > SDK userResolver > externalId fallback.
  const resolved = useUser(message.sender_external_id);
  const senderName = message.sender_external_id
    ? (labelFor?.(message.sender_external_id) ??
      resolved.profile?.displayName ??
      message.sender_external_id)
    : 'Unknown';
  return (
    <View
      style={[
        styles.replyChip,
        {
          backgroundColor: theme.colors.surfaceAlt,
          borderLeftColor: theme.colors.accent,
        },
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.replyName, { color: theme.colors.accent }]}>
          Replying to {senderName}
        </Text>
        <Text style={[styles.replyBody, { color: theme.colors.textMuted }]} numberOfLines={1}>
          {message.body ?? '…'}
        </Text>
      </View>
      {onCancel ? (
        <Pressable onPress={onCancel} hitSlop={8} style={styles.replyCancel}>
          <PoolseIcon name="close" size={16} color={theme.colors.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
    paddingHorizontal: 12,
    // paddingBottom is applied inline — it follows the keyboard state
    // (10 px while open, max(10, safeBottomInset) while closed) so the
    // send/attach buttons stay clear of the home indicator without
    // double-padding above the keyboard.
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  iconBtn: {
    padding: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  replyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderLeftWidth: 3,
    paddingLeft: 10,
    paddingRight: 6,
    paddingVertical: 6,
    marginBottom: 8,
    borderRadius: 6,
  },
  replyName: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 2,
  },
  replyBody: {
    fontSize: 12,
  },
  replyCancel: {
    padding: 6,
  },
});
