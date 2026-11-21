import type { MessageEdit, Uuid } from '@poolse/sdk';
import { usePoolse } from '@poolse/react';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { EDGE_TO_EDGE_MODAL } from './internal/edgeToEdge.js';
import { useSafeInsets } from './internal/safeArea.js';
import { relativeTime } from './internal/time.js';
import { useTheme } from './theme/PoolseTheme.js';

// Messages whose history the server refused (403): the "edited" label
// stops offering it for the rest of the session.
const forbidden = new Set<string>();

/** Whether the viewer may still be offered this message's edit history. */
export function canShowEditHistory(messageId: string): boolean {
  return !forbidden.has(messageId);
}

export interface EditHistorySheetProps {
  visible: boolean;
  onClose: () => void;
  messageId: Uuid;
  /** The text the message has now, shown on top as "Current". */
  currentBody?: string | null;
  /**
   * The server refused the history (403 — the workspace keeps it to
   * admins or the sender). The sheet closes itself.
   */
  onForbidden?: () => void;
}

/**
 * Bottom sheet listing a message's earlier versions, newest first
 * (`chat.messages.edits(id)`). Opened from the "edited" label.
 */
export function EditHistorySheet({
  visible,
  onClose,
  messageId,
  currentBody,
  onForbidden,
}: EditHistorySheetProps) {
  const theme = useTheme();
  const insets = useSafeInsets();
  const chat = usePoolse();
  const [edits, setEdits] = useState<MessageEdit[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let live = true;
    setEdits(null);
    setFailed(false);
    chat.messages.edits(messageId).then(
      (list) => {
        if (live) setEdits([...list.data].reverse());
      },
      (err: unknown) => {
        if (!live) return;
        if ((err as { status?: number } | null)?.status === 403) {
          forbidden.add(messageId);
          onForbidden?.();
          onClose();
          return;
        }
        setFailed(true);
      },
    );
    return () => {
      live = false;
    };
    // onClose / onForbidden are callbacks; refetch only when the target changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, messageId, chat]);

  const entry = (key: string, label: string, body: string | null, when: string) => (
    <View key={key} style={[styles.entry, { borderBottomColor: theme.colors.border }]}>
      <View style={styles.entryHead}>
        <Text style={[styles.entryLabel, { color: theme.colors.textMuted }]}>{label}</Text>
        {when ? (
          <Text style={[styles.entryTime, { color: theme.colors.textSubtle }]}>{when}</Text>
        ) : null}
      </View>
      <Text style={[styles.entryBody, { color: theme.colors.text, fontFamily: theme.fonts.body }]}>
        {body ?? '—'}
      </Text>
    </View>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      {...EDGE_TO_EDGE_MODAL}
    >
      <Pressable
        style={[styles.backdrop, { backgroundColor: theme.colors.overlay }]}
        onPress={onClose}
      >
        <Pressable
          // Swallow taps on the sheet so they don't close it.
          onPress={() => undefined}
          style={[
            styles.sheet,
            {
              backgroundColor: theme.colors.surface,
              borderTopLeftRadius: theme.radii.lg,
              borderTopRightRadius: theme.radii.lg,
              paddingBottom: 16 + insets.bottom,
              paddingLeft: insets.left,
              paddingRight: insets.right,
            },
            theme.shadows.lg,
          ]}
        >
          <Text
            style={[styles.title, { color: theme.colors.text, fontFamily: theme.fonts.display }]}
            accessibilityRole="header"
          >
            Edit history
          </Text>
          {failed ? (
            <Text style={[styles.status, { color: theme.colors.textMuted }]}>
              Couldn't load the earlier versions.
            </Text>
          ) : edits === null ? (
            <ActivityIndicator color={theme.colors.accent} style={styles.spinner} />
          ) : (
            <ScrollView style={styles.scroll}>
              {currentBody !== undefined ? entry('current', 'Current', currentBody, '') : null}
              {edits.map((e) =>
                entry(
                  String(e.version),
                  e.version === 1 ? 'Original' : `Version ${e.version}`,
                  e.body,
                  relativeTime(e.written_at),
                ),
              )}
              {edits.length === 0 ? (
                <Text style={[styles.status, { color: theme.colors.textMuted }]}>
                  No earlier versions.
                </Text>
              ) : null}
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '70%',
    paddingTop: 14,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  scroll: {
    flexGrow: 0,
  },
  entry: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  entryHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  entryLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  entryTime: {
    fontSize: 11,
  },
  entryBody: {
    fontSize: 14.5,
    lineHeight: 20,
  },
  status: {
    fontSize: 13,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  spinner: {
    marginVertical: 20,
  },
});
