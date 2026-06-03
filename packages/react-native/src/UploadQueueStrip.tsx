import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PoolseIcon } from './primitives/PoolseIcon.js';
import { useSharedUpload, useUploadPreview } from './internal/uploadContext.js';
import { usePoolseTheme } from './theme/PoolseTheme.js';

/**
 * Horizontal scrolling preview row of pending / in-flight / ready
 * uploads. Image attachments render as 64×64 thumbnails sourced from
 * the original local file URI; file attachments render as a row card
 * with icon + name + size. A small × overlay on each tile lets the
 * user drop the upload before send.
 *
 * Reads queue state from the shared `<UploadProvider>` (mounted by
 * `<ConversationView>`), so the composer's "ready attachment ids"
 * pickup and the strip's display always agree.
 */
export function UploadQueueStrip() {
  const theme = usePoolseTheme();
  const upload = useSharedUpload();
  const { getPreview } = useUploadPreview();

  if (upload.queue.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.scroll}
      // overflow:visible (+ explicit paddingTop on the contentContainer)
      // so the X close button can sit at -6/-6 outside the tile without
      // being clipped by the scroll bounds.
      style={[styles.scrollStyle, { marginBottom: 8 }]}
    >
      {upload.queue.map((item) => {
        const isError = item.status === 'error';
        const isUploading = item.status === 'uploading' || item.status === 'pending';
        const isImage = (item.contentType ?? '').startsWith('image/');
        const previewUri = getPreview(item.filename);
        const canTerminate = isUploading || item.status === 'ready' || isError;

        const handleClose = () => {
          if (item.status === 'ready' || isError) upload.remove(item.localId);
          else upload.cancel(item.localId);
        };

        return (
          <View key={item.localId} style={styles.tileWrap}>
            {isImage && previewUri ? (
              <ImageTile uri={previewUri} uploading={isUploading} error={isError} />
            ) : (
              <FileTile
                filename={item.filename}
                size={item.byteSize}
                uploading={isUploading}
                error={isError}
              />
            )}

            {canTerminate ? (
              <Pressable
                onPress={handleClose}
                hitSlop={8}
                style={[styles.closeBtn, { backgroundColor: theme.colors.ink }]}
                accessibilityLabel={isError ? 'Remove failed upload' : 'Cancel upload'}
              >
                <PoolseIcon name="close" size={11} color={theme.colors.onBrand} />
              </Pressable>
            ) : null}

            {isUploading ? (
              <View style={styles.progressOverlay}>
                <View style={[styles.spinner, { borderColor: theme.colors.onBrand }]} />
              </View>
            ) : null}

            {isError ? (
              <View style={[styles.errorOverlay, { backgroundColor: 'rgba(229,72,77,0.85)' }]}>
                <Text style={[styles.errorText, { color: '#fff' }]}>Failed</Text>
              </View>
            ) : null}
          </View>
        );
      })}
    </ScrollView>
  );
}

function ImageTile({ uri, uploading, error }: { uri: string; uploading: boolean; error: boolean }) {
  const theme = usePoolseTheme();
  return (
    <Image
      source={{ uri }}
      style={[
        styles.imageTile,
        {
          backgroundColor: theme.colors.surface2,
          borderColor: error ? theme.colors.error : 'transparent',
          opacity: uploading ? 0.65 : 1,
        },
      ]}
      resizeMode="cover"
    />
  );
}

function FileTile({
  filename,
  size,
  uploading,
  error,
}: {
  filename: string;
  size: number;
  uploading: boolean;
  error: boolean;
}) {
  const theme = usePoolseTheme();
  return (
    <View
      style={[
        styles.fileTile,
        {
          backgroundColor: theme.colors.surface2,
          borderColor: error
            ? theme.colors.error
            : uploading
              ? theme.colors.brand
              : theme.colors.border,
        },
      ]}
    >
      <View style={[styles.fileIconBox, { backgroundColor: theme.colors.brandSoft }]}>
        <PoolseIcon name="attachment" size={18} color={theme.colors.brand} />
      </View>
      <View style={styles.fileInfo}>
        <Text
          style={[styles.fileName, { color: theme.colors.ink, fontFamily: theme.type.fontBody }]}
          numberOfLines={1}
        >
          {filename}
        </Text>
        <Text style={[styles.fileSize, { color: theme.colors.ink3 }]}>{formatBytes(size)}</Text>
      </View>
    </View>
  );
}

function formatBytes(n: number): string {
  if (!n || n < 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

const TILE = 64;

const styles = StyleSheet.create({
  scrollStyle: {
    overflow: 'visible',
  },
  scroll: {
    paddingHorizontal: 8,
    // paddingTop creates room for the X to overflow the tile without
    // being clipped on Android (where overflow:visible isn't enough).
    paddingTop: 8,
    gap: 10,
    flexDirection: 'row',
  },
  tileWrap: {
    position: 'relative',
    overflow: 'visible',
  },
  imageTile: {
    width: TILE,
    height: TILE,
    borderRadius: 10,
    borderWidth: 1.5,
  },
  fileTile: {
    height: TILE,
    minWidth: 200,
    maxWidth: 260,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingRight: 28,
    borderRadius: 10,
    borderWidth: 1,
    gap: 10,
  },
  fileIconBox: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileInfo: {
    flex: 1,
    gap: 2,
  },
  fileName: {
    fontSize: 13,
    fontWeight: '600',
  },
  fileSize: {
    fontSize: 11,
  },
  closeBtn: {
    // Outside the tile (top-right corner overflowing). Parent
    // scroll container + tileWrap set overflow:visible and the
    // scroll contentContainer has paddingTop:8 so the overflow
    // isn't clipped on Android.
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 3,
  },
  progressOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
  },
  spinner: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2.5,
    borderTopColor: 'transparent',
    // RN can't loop a rotation purely in StyleSheet, but the static
    // 3/4-circle still reads as "in progress." A real Animated.View
    // rotation lands in a follow-up.
  },
  errorOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingVertical: 3,
    alignItems: 'center',
  },
  errorText: {
    fontSize: 10,
    fontWeight: '700',
  },
});
