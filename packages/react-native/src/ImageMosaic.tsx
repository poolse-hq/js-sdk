import type { Attachment } from '@poolse/sdk';
import { useAttachmentUrl } from '@poolse/react';
import { useState } from 'react';
import { Dimensions, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { PoolseIcon } from './primitives/PoolseIcon.js';
import { usePoolseTheme } from './theme/PoolseTheme.js';

export interface ImageMosaicProps {
  images: Attachment[];
  /** Max width the mosaic should render to. Defaults to 280. */
  maxWidth?: number;
  /** Border radius applied to the outer mosaic. Defaults to theme.radii.md. */
  radius?: number;
}

/**
 * WhatsApp-style multi-image grid for inside the message bubble.
 *   * n = 1 → single full-bleed tile capped at maxWidth × 200
 *   * n = 2 → two equal squares side-by-side
 *   * n = 3 → one 16:9 hero on top, two squares beneath
 *   * n ≥ 4 → 2×2 grid; 4th tile carries a "+N more" overlay when n > 4
 *
 * Tapping any tile opens a full-screen modal viewer with a close X
 * and tap-anywhere-to-close. Swiping between images is not in 0.1 —
 * tap-out, pick another. Reuses `useAttachmentUrl` for cached + auto-
 * refreshed presigned download URLs.
 */
export function ImageMosaic({ images, maxWidth = 280, radius }: ImageMosaicProps) {
  const theme = usePoolseTheme();
  const r = radius ?? theme.radii.md;
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  if (images.length === 0) return null;

  const visible = images.slice(0, 4);
  const overflow = images.length > 4 ? images.length - 4 : 0;
  const layout = pickLayout(visible.length);

  return (
    <>
      <View
        style={[
          styles.root,
          {
            width: maxWidth,
            height: layoutHeight(layout, maxWidth),
            borderRadius: r,
          },
        ]}
      >
        {visible.map((att, i) => (
          <Tile
            key={att.id}
            attachment={att}
            style={tileStyle(layout, i, maxWidth)}
            overlay={overflow > 0 && i === visible.length - 1 ? `+${overflow}` : null}
            onPress={() => setViewerIndex(i)}
          />
        ))}
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

type Layout = 'one' | 'two' | 'three' | 'four';

function pickLayout(n: number): Layout {
  if (n === 1) return 'one';
  if (n === 2) return 'two';
  if (n === 3) return 'three';
  return 'four';
}

function layoutHeight(layout: Layout, w: number): number {
  switch (layout) {
    case 'one':
      return 200;
    case 'two':
      return w / 2;
    case 'three':
      return Math.floor(w * 0.5625) + Math.floor(w / 2) + 2;
    case 'four':
      return w;
  }
}

function tileStyle(layout: Layout, i: number, w: number) {
  const gap = 2;
  switch (layout) {
    case 'one':
      return { left: 0, top: 0, width: w, height: 200 };
    case 'two': {
      const tw = (w - gap) / 2;
      return { left: i === 0 ? 0 : tw + gap, top: 0, width: tw, height: w / 2 };
    }
    case 'three': {
      const heroH = Math.floor(w * 0.5625);
      const tw = (w - gap) / 2;
      const tileH = Math.floor(w / 2);
      if (i === 0) return { left: 0, top: 0, width: w, height: heroH };
      const bottomTop = heroH + gap;
      return {
        left: i === 1 ? 0 : tw + gap,
        top: bottomTop,
        width: tw,
        height: tileH,
      };
    }
    case 'four': {
      const tw = (w - gap) / 2;
      const col = i % 2;
      const row = Math.floor(i / 2);
      return {
        left: col === 0 ? 0 : tw + gap,
        top: row === 0 ? 0 : tw + gap,
        width: tw,
        height: tw,
      };
    }
  }
}

function Tile({
  attachment,
  style,
  overlay,
  onPress,
}: {
  attachment: Attachment;
  style: { left: number; top: number; width: number; height: number };
  overlay: string | null;
  onPress: () => void;
}) {
  const theme = usePoolseTheme();
  const { url } = useAttachmentUrl(attachment.id);
  return (
    <Pressable onPress={onPress} style={[styles.tile, style]}>
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
    position: 'relative',
    overflow: 'hidden',
    marginBottom: 4,
  },
  tile: {
    position: 'absolute',
    overflow: 'hidden',
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
