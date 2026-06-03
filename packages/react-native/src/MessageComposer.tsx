import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { AttachmentUploadInput, Message, Uuid } from '@poolse/sdk';
import { useAttachmentUpload } from '@poolse/react';

import { PoolseIcon } from './primitives/PoolseIcon.js';
import { UploadQueueStrip } from './UploadQueueStrip.js';
import { usePoolseTheme } from './theme/PoolseTheme.js';

export interface MessageComposerProps {
  /**
   * Called when the user taps Send. Second arg carries
   * `quoted_message_id` (when replying) and `attachment_ids`
   * (resolved from the composer's upload queue). Awaited so the
   * composer disables until the send round-trips.
   */
  onSend: (
    body: string,
    opts?: { quoted_message_id?: Uuid; attachment_ids?: Uuid[] },
  ) => Promise<unknown> | void;
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
  clear: () => void;
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
    },
    ref,
  ) {
    const theme = usePoolseTheme();
    const inputRef = useRef<TextInput>(null);
    const [value, setValue] = useState('');
    const [sending, setSending] = useState(false);
    const upload = useAttachmentUpload();

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
        clear: () => setValue(''),
      }),
      [attachments, upload],
    );

    const readyAttachmentIds = upload.queue
      .filter((item) => item.status === 'ready' && item.attachment)
      .map((item) => item.attachment!.id);
    const isUploading = upload.queue.some(
      (item) => item.status === 'uploading' || item.status === 'pending',
    );

    const submitDisabled =
      disabled ||
      sending ||
      isUploading ||
      (value.trim().length === 0 && readyAttachmentIds.length === 0);

    const handleSend = async () => {
      if (submitDisabled) return;
      setSending(true);
      try {
        await onSend(value.trim(), {
          ...(replyingTo ? { quoted_message_id: replyingTo.id } : {}),
          ...(readyAttachmentIds.length > 0 ? { attachment_ids: readyAttachmentIds } : {}),
        });
        setValue('');
        upload.reset();
      } finally {
        setSending(false);
      }
    };

    return (
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}
      >
        <View
          style={[
            styles.wrap,
            {
              backgroundColor: theme.colors.surface,
              borderTopColor: theme.colors.border,
            },
          ]}
        >
          {replyingTo ? (
            <ReplyChip
              message={replyingTo}
              {...(labelFor ? { labelFor } : {})}
              {...(onCancelReply ? { onCancel: onCancelReply } : {})}
            />
          ) : null}

          {attachments ? <UploadQueueStrip /> : null}

          <View style={styles.row}>
            {attachments && onAttachPress ? (
              <Pressable
                onPress={onAttachPress}
                hitSlop={8}
                style={styles.iconBtn}
                accessibilityLabel="Attach file"
              >
                <PoolseIcon name="attachment" size={22} color={theme.colors.ink2} />
              </Pressable>
            ) : null}

            <TextInput
              ref={inputRef}
              value={value}
              onChangeText={(text) => {
                setValue(text);
                onTyping?.();
              }}
              placeholder={placeholder}
              placeholderTextColor={theme.colors.ink3}
              multiline
              editable={!disabled}
              style={[
                styles.input,
                {
                  color: theme.colors.ink,
                  backgroundColor: theme.colors.surface2,
                  borderRadius: theme.radii.lg,
                  fontFamily: theme.type.fontBody,
                  fontSize: theme.type.bodySize,
                },
              ]}
            />

            <Pressable
              onPress={handleSend}
              disabled={submitDisabled}
              style={[
                styles.sendBtn,
                {
                  backgroundColor: submitDisabled ? theme.colors.ink3 : theme.colors.brand,
                  opacity: submitDisabled ? 0.6 : 1,
                },
              ]}
              accessibilityLabel="Send message"
            >
              <PoolseIcon name="send" size={18} color={theme.colors.onBrand} />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
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
  const theme = usePoolseTheme();
  const senderName = message.sender_external_id
    ? (labelFor?.(message.sender_external_id) ?? message.sender_external_id)
    : 'Unknown';
  return (
    <View
      style={[
        styles.replyChip,
        {
          backgroundColor: theme.colors.surface2,
          borderLeftColor: theme.colors.brand,
        },
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.replyName, { color: theme.colors.brand }]}>
          Replying to {senderName}
        </Text>
        <Text style={[styles.replyBody, { color: theme.colors.ink2 }]} numberOfLines={1}>
          {message.body ?? '…'}
        </Text>
      </View>
      {onCancel ? (
        <Pressable onPress={onCancel} hitSlop={8} style={styles.replyCancel}>
          <PoolseIcon name="close" size={16} color={theme.colors.ink2} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 8,
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
