import type { Attachment } from '@poolse/sdk';
import { useAttachmentUrl } from '@poolse/react';
import { useState } from 'react';
import { Dimensions, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { PoolseIcon } from './primitives/PoolseIcon.js';
import { usePoolseTheme } from './theme/PoolseTheme.js';

export interface ImageMosaicProps {
  images: Attachment[];
  /**
   * Pixel ceiling on the mosaic's width. The mosaic itself fills its
   * parent (`width: '100%'`) and caps at this value, so it always
   * fits inside whatever the bubble's actual content area is at
   * render time — no more hardcoded 280px overflowing on small
   * screens or inside narrow bubbles.
   */
  maxWidth?: number;
  radius?: number;
}

/**
 * WhatsApp-style multi-image grid for inside the message bubble.
 * Uses flex-based widths (with `%` and `aspectRatio`) so the layout
 * scales to whatever the bubble's content area is — no fixed pixel
 * positioning that can overflow when the bubble is narrower than
 * the configured max.
 *
 *   * n = 1 → single tile, 16:10 aspect.
 *   * n = 2 → row of 2 squares.
 *   * n = 3 → 16:9 hero on top + row of 2 squares below.
 *   * n ≥ 4 → 2×2 grid with "+N more" overlay on the 4th tile.
 */
export function ImageMosaic({ images, maxWidth, radius }: ImageMosaicProps) {
  const theme = usePoolseTheme();
  const r = radius ?? theme.radii.md;
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  if (images.length === 0) return null;

  const visible = images.slice(0, 4);
  const overflow = images.length > 4 ? images.length - 4 : 0;
  const n = visible.length as 1 | 2 | 3 | 4;

  return (
    <>
      <View
        style={[
          styles.root,
          {
            borderRadius: r,
            ...(maxWidth ? { maxWidth } : {}),
          },
        ]}
      >
        {n === 1 ? (
          <Tile
            attachment={visible[0]!}
            style={styles.tileFull}
            onPress={() => setViewerIndex(0)}
            overlay={null}
          />
        ) : null}

        {n === 2 ? (
          <View style={styles.rowEven}>
            <Tile
              attachment={visible[0]!}
              style={styles.tileHalfSquare}
              onPress={() => setViewerIndex(0)}
              overlay={null}
            />
            <Tile
              attachment={visible[1]!}
              style={styles.tileHalfSquare}
              onPress={() => setViewerIndex(1)}
              overlay={null}
            />
          </View>
        ) : null}

        {n === 3 ? (
          <>
            <Tile
              attachment={visible[0]!}
              style={styles.tileHero}
              onPress={() => setViewerIndex(0)}
              overlay={null}
            />
            <View style={[styles.rowEven, { marginTop: 2 }]}>
              <Tile
                attachment={visible[1]!}
                style={styles.tileHalfSquare}
                onPress={() => setViewerIndex(1)}
                overlay={null}
              />
              <Tile
                attachment={visible[2]!}
                style={styles.tileHalfSquare}
                onPress={() => setViewerIndex(2)}
                overlay={null}
              />
            </View>
          </>
        ) : null}

        {n === 4 ? (
          <>
            <View style={styles.rowEven}>
              <Tile
                attachment={visible[0]!}
                style={styles.tileHalfSquare}
                onPress={() => setViewerIndex(0)}
                overlay={null}
              />
              <Tile
                attachment={visible[1]!}
                style={styles.tileHalfSquare}
                onPress={() => setViewerIndex(1)}
                overlay={null}
              />
            </View>
            <View style={[styles.rowEven, { marginTop: 2 }]}>
              <Tile
                attachment={visible[2]!}
                style={styles.tileHalfSquare}
                onPress={() => setViewerIndex(2)}
                overlay={null}
              />
              <Tile
                attachment={visible[3]!}
                style={styles.tileHalfSquare}
                onPress={() => setViewerIndex(3)}
                overlay={overflow > 0 ? `+${overflow}` : null}
              />
            </View>
          </>
        ) : null}
      </View>

      <Modal
        visible={viewerIndex !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setViewerIndex(null)}
      >
        {viewerIndex !== null ? (
          <FullScreenViewer
            attachment={images[viewerIndex]!}
            onClose={() => setViewerIndex(null)}
          />
        ) : null}
      </Modal>
    </>
  );
}

function Tile({
  attachment,
  style,
  overlay,
  onPress,
}: {
  attachment: Attachment;
  style: object;
  overlay: string | null;
  onPress: () => void;
}) {
  const theme = usePoolseTheme();
  const { url } = useAttachmentUrl(attachment.id);
  return (
    <Pressable onPress={onPress} style={[styles.tileBase, style]}>
      {url ? (
        <Image
          source={{ uri: url }}
          style={[styles.tileImage, { backgroundColor: theme.colors.surface2 }]}
          resizeMode="cover"
          accessible
          accessibilityLabel={attachment.original_filename ?? 'image'}
        />
      ) : (
        <View style={[styles.tileImage, { backgroundColor: theme.colors.surface2 }]} />
      )}
      {overlay ? (
        <View style={styles.overflow}>
          <Text style={styles.overflowText}>{overlay}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function FullScreenViewer({
  attachment,
  onClose,
}: {
  attachment: Attachment;
  onClose: () => void;
}) {
  const { url } = useAttachmentUrl(attachment.id);
  const { width, height } = Dimensions.get('window');
  return (
    <Pressable style={styles.viewer} onPress={onClose}>
      {url ? (
        <Image
          source={{ uri: url }}
          style={{ width, height }}
          resizeMode="contain"
          accessible
          accessibilityLabel={attachment.original_filename ?? 'image'}
        />
      ) : null}
      <Pressable
        onPress={onClose}
        hitSlop={12}
        style={styles.closeBtn}
        accessibilityLabel="Close viewer"
      >
        <PoolseIcon name="close" size={20} color="#ffffff" />
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    width: '100%',
    overflow: 'hidden',
    marginBottom: 4,
  },
  rowEven: {
    flexDirection: 'row',
    gap: 2,
  },
  tileBase: {
    overflow: 'hidden',
  },
  // n=1: full bleed at the bubble's available width, 16:10 aspect.
  tileFull: {
    width: '100%',
    aspectRatio: 16 / 10,
  },
  // n=2 / n=4 (per row): two equal squares side-by-side.
  tileHalfSquare: {
    flex: 1,
    aspectRatio: 1,
  },
  // n=3 hero: full-bleed top tile, 16:9.
  tileHero: {
    width: '100%',
    aspectRatio: 16 / 9,
  },
  tileImage: {
    width: '100%',
    height: '100%',
  },
  overflow: {
    position: 'absolute',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overflowText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 22,
  },
  viewer: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtn: {
    position: 'absolute',
    top: 48,
    right: 16,
    padding: 8,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 20,
  },
});
