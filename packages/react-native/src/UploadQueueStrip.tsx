import { useAttachmentUpload } from '@poolse/react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PoolseIcon } from './primitives/PoolseIcon.js';
import { usePoolseTheme } from './theme/PoolseTheme.js';

/**
 * Horizontal strip of in-flight upload chips with cancel + remove
 * affordances. Reads from `useAttachmentUpload()` so it auto-clears
 * when the composer resets the queue post-send.
 */
export function UploadQueueStrip() {
  const theme = usePoolseTheme();
  const upload = useAttachmentUpload();
  if (upload.queue.length === 0) return null;
  return (
    <View style={styles.strip}>
      {upload.queue.map((item) => {
        const isError = item.status === 'error';
        const isReady = item.status === 'ready';
        return (
          <View
            key={item.localId}
            style={[
              styles.chip,
              {
                backgroundColor: theme.colors.surface2,
                borderColor: isError ? theme.colors.error : theme.colors.border,
                borderRadius: theme.radii.sm,
              },
            ]}
          >
            <Text
              style={[styles.name, { color: isError ? theme.colors.error : theme.colors.ink }]}
              numberOfLines={1}
            >
              {item.filename}
            </Text>
            <Text style={[styles.status, { color: theme.colors.ink3 }]}>
              {isReady ? 'ready' : isError ? 'failed' : item.status}
            </Text>
            <Pressable
              hitSlop={6}
              onPress={() =>
                isReady || isError ? upload.remove(item.localId) : upload.cancel(item.localId)
              }
              style={styles.btn}
              accessibilityLabel="Remove upload"
            >
              <PoolseIcon name="close" size={12} color={theme.colors.ink2} />
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 6,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 6,
    maxWidth: 200,
  },
  name: {
    fontSize: 12,
    flex: 1,
  },
  status: {
    fontSize: 10,
    textTransform: 'capitalize',
  },
  btn: {
    padding: 2,
  },
});
