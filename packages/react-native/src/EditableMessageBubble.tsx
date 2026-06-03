import type { Message } from '@poolse/sdk';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { usePoolseTheme } from './theme/PoolseTheme.js';

export interface EditableMessageBubbleProps {
  message: Message;
  currentUserId: string | null;
  onCancel: () => void;
  onSave: (body: string) => Promise<unknown> | void;
}

export function EditableMessageBubble({
  message,
  currentUserId,
  onCancel,
  onSave,
}: EditableMessageBubbleProps) {
  const theme = usePoolseTheme();
  const isSelf = currentUserId !== null && message.sender_id === currentUserId;
  const [value, setValue] = useState(message.body ?? '');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (saving || !value.trim()) return;
    setSaving(true);
    try {
      await onSave(value.trim());
    } finally {
      setSaving(false);
    }
  };

  const bg = isSelf ? theme.colors.selfBubble : theme.colors.otherBubble;
  const ink = isSelf ? theme.colors.selfBubbleText : theme.colors.otherBubbleText;

  return (
    <View
      style={[
        styles.wrap,
        {
          alignSelf: isSelf ? 'flex-end' : 'flex-start',
          maxWidth: '80%',
        },
      ]}
    >
      <View
        style={[
          styles.bubble,
          {
            backgroundColor: bg,
            borderRadius: theme.radii.bubble,
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.sm,
          },
          theme.shadows.sm,
        ]}
      >
        <TextInput
          value={value}
          onChangeText={setValue}
          multiline
          autoFocus
          style={{
            color: ink,
            fontFamily: theme.type.fontBody,
            fontSize: theme.type.bodySize,
            minHeight: 24,
          }}
        />
        <View style={styles.actions}>
          <Pressable onPress={onCancel} hitSlop={6}>
            <Text style={[styles.btn, { color: ink, opacity: 0.7 }]}>Cancel</Text>
          </Pressable>
          <Pressable onPress={submit} disabled={saving} hitSlop={6}>
            <Text style={[styles.btn, { color: ink, fontWeight: '700' }]}>
              {saving ? 'Saving…' : 'Save'}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: 4,
  },
  bubble: {},
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 6,
  },
  btn: {
    fontSize: 13,
  },
});
