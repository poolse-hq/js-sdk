import type { Attachment } from '@poolse/sdk';
import { useAttachmentUrl } from '@poolse/react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { PoolseIcon } from './primitives/PoolseIcon.js';
import { usePoolseTheme } from './theme/PoolseTheme.js';

export interface AttachmentPreviewProps {
  attachment: Attachment;
  /** Optional tap handler. For images defaults to opening the source URL. */
  onPress?: () => void;
  /** Render at this max width. Defaults to 280. */
  maxWidth?: number;
}

export function AttachmentPreview({ attachment, onPress, maxWidth = 280 }: AttachmentPreviewProps) {
  const theme = usePoolseTheme();
  const isImage = (attachment.content_type ?? '').startsWith('image/');
  const { url } = useAttachmentUrl(attachment.id);

  if (isImage) {
    return (
      <Pressable onPress={onPress} disabled={!onPress}>
        {url ? (
          <Image
            source={{ uri: url }}
            style={{
              width: maxWidth,
              height: 200,
              borderRadius: theme.radii.md,
              backgroundColor: theme.colors.surface2,
            }}
            resizeMode="cover"
            accessible
            accessibilityLabel={attachment.original_filename ?? 'attachment image'}
          />
        ) : (
          <View
            style={[
              styles.imagePlaceholder,
              {
                width: maxWidth,
                height: 200,
                borderRadius: theme.radii.md,
                backgroundColor: theme.colors.surface2,
              },
            ]}
          />
        )}
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={[
        styles.fileCard,
        {
          backgroundColor: theme.colors.surface2,
          borderColor: theme.colors.border,
          borderRadius: theme.radii.md,
        },
      ]}
    >
      <PoolseIcon name="attachment" size={18} color={theme.colors.ink2} />
      <View style={{ flex: 1, marginLeft: 8 }}>
        <Text
          style={[styles.fileName, { color: theme.colors.ink, fontFamily: theme.type.fontBody }]}
          numberOfLines={1}
        >
          {attachment.original_filename ?? 'file'}
        </Text>
        <Text style={[styles.fileSize, { color: theme.colors.ink3 }]}>
          {formatBytes(attachment.byte_size)}
        </Text>
      </View>
    </Pressable>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

const styles = StyleSheet.create({
  imagePlaceholder: {},
  fileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  fileName: {
    fontSize: 13,
    fontWeight: '500',
  },
  fileSize: {
    fontSize: 11,
  },
});
