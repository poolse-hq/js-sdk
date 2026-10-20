import type { Membership, Uuid } from '@poolse/sdk';
import { useMembers } from '@poolse/react';
import { useMemo, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Avatar } from './primitives/Avatar.js';
import { MessageComposer, type MessageComposerProps } from './MessageComposer.js';
import { EDGE_TO_EDGE_MODAL } from './internal/edgeToEdge.js';
import { useSafeInsets } from './internal/safeArea.js';
import { useKeyboardOpen } from './internal/useKeyboardOpen.js';
import { usePoolseTheme } from './theme/PoolseTheme.js';

export interface MentionInputProps extends Omit<MessageComposerProps, 'onSend'> {
  conversationId: Uuid;
  /** Same callback as MessageComposer.onSend, plus optional mention user_ids. */
  onSend: (
    body: string,
    opts?: {
      quoted_message_id?: Uuid;
      attachment_ids?: Uuid[];
      mentions?: Uuid[];
    },
  ) => Promise<unknown> | void;
}

/**
 * Composer with an inline `@`-trigger that opens a modal sheet of
 * conversation members. Selecting a member inserts their
 * `external_id` into the text, and the wire `mentions` array (sent
 * to the backend) carries the corresponding internal `user_id`s.
 */
export function MentionInput({ conversationId, onSend, ...composerProps }: MentionInputProps) {
  const theme = usePoolseTheme();
  const insets = useSafeInsets();
  const keyboardOpen = useKeyboardOpen();
  const { members } = useMembers(conversationId);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, _setPickerQuery] = useState('');
  const [pendingMentionUuids, setPendingMentionUuids] = useState<Uuid[]>([]);
  const [text, setText] = useState('');

  const filteredMembers = useMemo(() => {
    if (!pickerQuery) return members;
    const q = pickerQuery.toLowerCase();
    return members.filter((m) => m.external_id.toLowerCase().includes(q));
  }, [members, pickerQuery]);

  const handleSend: MessageComposerProps['onSend'] = async (body, opts) => {
    await onSend(body, {
      ...opts,
      ...(pendingMentionUuids.length > 0 ? { mentions: pendingMentionUuids } : {}),
    });
    setPendingMentionUuids([]);
    setText('');
  };

  return (
    <>
      <MessageComposer
        {...composerProps}
        onSend={handleSend}
        onTyping={() => {
          composerProps.onTyping?.();
          // Watch for an `@` token to open the picker.
          const lastChar = text.slice(-1);
          if (lastChar === '@') setPickerOpen(true);
        }}
      />

      <Modal
        visible={pickerOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setPickerOpen(false)}
        // Edge-to-edge on Android like the host app, so the inset and
        // keyboard maths below hold on every device.
        {...EDGE_TO_EDGE_MODAL}
      >
        {/* The picker opens while the composer's keyboard is usually
            still up. The modal is full-screen and never resized, so a
            `padding` KAV (on both platforms) lifts the sheet exactly
            above the keyboard. */}
        <KeyboardAvoidingView style={styles.kav} behavior="padding">
          <Pressable style={styles.backdrop} onPress={() => setPickerOpen(false)}>
            <View
              style={[
                styles.sheet,
                {
                  backgroundColor: theme.colors.surface,
                  borderTopLeftRadius: theme.radii.lg,
                  borderTopRightRadius: theme.radii.lg,
                  // Clear the nav bar — unless the keyboard is covering
                  // it, where the inset would just be a gap.
                  paddingBottom: 12 + (keyboardOpen ? 0 : insets.bottom),
                  paddingLeft: insets.left,
                  paddingRight: insets.right,
                },
              ]}
            >
              <Text
                style={[styles.title, { color: theme.colors.ink, fontFamily: theme.type.fontBody }]}
              >
                Mention a member
              </Text>
              <FlatList
                data={filteredMembers}
                keyExtractor={(m) => m.user_id}
                // First tap picks a member even with the keyboard up.
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <MentionRow
                    member={item}
                    onPress={() => {
                      setPendingMentionUuids((prev) => [...prev, item.user_id]);
                      setText((prev) => `${prev}${item.external_id} `);
                      setPickerOpen(false);
                    }}
                  />
                )}
              />
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

function MentionRow({ member, onPress }: { member: Membership; onPress: () => void }) {
  const theme = usePoolseTheme();
  return (
    <Pressable onPress={onPress} style={styles.row}>
      <Avatar src={null} name={member.external_id} seed={member.external_id} size="sm" />
      <Text style={[styles.rowText, { color: theme.colors.ink, fontFamily: theme.type.fontBody }]}>
        {member.external_id}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  kav: {
    flex: 1,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '60%',
    paddingVertical: 12,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
  },
  rowText: {
    fontSize: 14,
  },
});
