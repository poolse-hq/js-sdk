import type { Membership, Uuid } from '@poolse/sdk';
import { useMembers } from '@poolse/react';
import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from './primitives/Avatar.js';
import { MessageComposer, type MessageComposerProps } from './MessageComposer.js';
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
      >
        <Pressable style={styles.backdrop} onPress={() => setPickerOpen(false)}>
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: theme.colors.surface,
                borderTopLeftRadius: theme.radii.lg,
                borderTopRightRadius: theme.radii.lg,
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
