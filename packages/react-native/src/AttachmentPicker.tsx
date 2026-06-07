import { Image as RNImage, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
// Static imports — Metro's bundle graph can only trace literal
// `import` / `require` calls. The earlier `new Function('m', 'return
// import(m)')(name)` trick bypassed Metro entirely, so the picker
// modules were never bundled even when the consumer installed them.
//
// Trade-off: if a consumer mounts <AttachmentPicker> without these
// modules installed, the bundle fails at build time with a clear
// "module not found" rather than the silent runtime warning we had
// before. Consumers who don't want attachments at all should pass
// `attachments={false}` to <ConversationView> so this file is never
// rendered (and tree-shaking can drop the imports in production
// builds with a real bundler — Metro doesn't tree-shake but the
// imports add ~12kb total which is acceptable).
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

import { PoolseIcon } from './primitives/PoolseIcon.js';
import { useSharedUpload, useUploadPreview } from './internal/uploadContext.js';
import { usePoolseTheme } from './theme/PoolseTheme.js';

export interface AttachmentPickerProps {
  visible: boolean;
  onClose: () => void;
  /**
   * Optional adapter that produces upload inputs from a picked file.
   * Override to plug in custom storage / transcoding. Default reads
   * from `expo-image-picker` / `expo-document-picker`.
   */
  onPickInputs?: (kind: 'image' | 'document') => Promise<
    {
      body: { uri: string; name: string; type: string } | Blob | unknown;
      contentType: string;
      byteSize: number;
      filename?: string;
    }[]
  >;
}

/**
 * Picker sheet wrapping `expo-image-picker` and `expo-document-picker`.
 * Both must be installed (`npx expo install expo-image-picker
 * expo-document-picker`) when this component is mounted — they're
 * declared as optional peers because consumers who pass
 * `attachments={false}` to ConversationView never render this file.
 */
export function AttachmentPicker({ visible, onClose, onPickInputs }: AttachmentPickerProps) {
  const theme = usePoolseTheme();
  // Shared queue (via UploadProvider) so the composer sees these
  // uploads and can include them in the next send. Falls back to a
  // local queue when the picker is mounted outside ConversationView.
  const upload = useSharedUpload();
  const { setPreview } = useUploadPreview();

  const pickFromKind = async (kind: 'image' | 'document') => {
    try {
      const adapter = onPickInputs ?? defaultAdapter;
      const inputs = await adapter(kind);
      for (const input of inputs) {
        // Stash the original local URI on the shared context so the
        // UploadQueueStrip can render a real thumbnail. The SDK only
        // sees the Blob from here on out.
        const previewUri = (input as { _previewUri?: string })._previewUri ?? null;
        if (previewUri && input.filename) {
          setPreview(input.filename, previewUri);
        }
        void upload.upload(input as never);
      }
    } catch (err) {
      console.warn('[poolse/picker]', err);
    } finally {
      onClose();
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.colors.surface,
              borderTopLeftRadius: theme.radii.lg,
              borderTopRightRadius: theme.radii.lg,
            },
            theme.shadows.lg,
          ]}
        >
          <Pressable style={styles.item} onPress={() => pickFromKind('image')}>
            <PoolseIcon name="attachment" size={20} color={theme.colors.ink2} />
            <Text style={[styles.itemText, { color: theme.colors.ink }]}>Photo or video</Text>
          </Pressable>
          <Pressable style={styles.item} onPress={() => pickFromKind('document')}>
            <PoolseIcon name="attachment" size={20} color={theme.colors.ink2} />
            <Text style={[styles.itemText, { color: theme.colors.ink }]}>File</Text>
          </Pressable>
          <Pressable style={styles.cancel} onPress={onClose}>
            <Text style={[styles.itemText, { color: theme.colors.brand }]}>Cancel</Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

// RN gives us a local file URI. The SDK's upload PUTs the `body` raw
// to a presigned S3/R2 URL — those only accept raw bytes, NOT
// multipart. If we passed the `{ uri, name, type }` object directly,
// fetch would serialize it as multipart and the bucket would reject
// the upload silently. So we read the URI as a Blob first (same shape
// that `<input type="file">` would give on web) and pass that.
async function uriToBlob(uri: string): Promise<Blob> {
  const res = await fetch(uri);
  if (!res.ok && res.status !== 0) {
    throw new Error(`failed to read picked file (HTTP ${res.status})`);
  }
  return res.blob();
}

// Phone-sized output — the fullscreen viewer on a 3x retina display
// only needs ~1300px on the long edge, and chat bubbles top out at
// ~960px. 1600 leaves headroom for pinch-zoom without sending the
// 4000+ px monsters that some screenshots ship with.
const COMPRESSION_LONG_SIDE_PX = 1600;
const COMPRESSION_QUALITY = 0.75;

function getImageSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    RNImage.getSize(uri, (width, height) => resolve({ width, height }), reject);
  });
}

/**
 * Resize → WebP @ 0.75 every image before upload. iOS screenshots
 * can be 8–12 MB PNGs and the fullscreen `<Image>` decode of those
 * blocks the JS thread / silently fails on older devices — clipping
 * the long edge to 1600 keeps the per-message payload under ~250kb
 * for typical photos and is still crisp on every phone display.
 *
 * Never upscales. Falls back to the original blob on any failure so
 * a flaky manipulator pass never blocks a send.
 */
async function compressImage({
  uri,
  width,
  height,
  filename,
}: {
  uri: string;
  width?: number;
  height?: number;
  filename?: string;
}): Promise<{ blob: Blob; contentType: string; filename: string }> {
  let w = width;
  let h = height;
  if (!w || !h) {
    try {
      const size = await getImageSize(uri);
      w = size.width;
      h = size.height;
    } catch {
      w = 0;
      h = 0;
    }
  }
  const longSide = Math.max(w ?? 0, h ?? 0);
  const scale =
    longSide > COMPRESSION_LONG_SIDE_PX ? COMPRESSION_LONG_SIDE_PX / longSide : 1;
  const actions =
    scale < 1 && w && h
      ? [{ resize: { width: Math.round(w * scale), height: Math.round(h * scale) } }]
      : [];

  const result = await manipulateAsync(uri, actions, {
    compress: COMPRESSION_QUALITY,
    format: SaveFormat.WEBP,
  });
  const blob = await uriToBlob(result.uri);
  const base = (filename ?? `image-${Date.now()}`).replace(/\.[^.]+$/, '');
  return {
    blob,
    contentType: 'image/webp',
    filename: `${base}.webp`,
  };
}

async function defaultAdapter(kind: 'image' | 'document') {
  if (kind === 'image') {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      // Quality 1 — picker hands back the source as-is and we do the
      // compression ourselves below. Letting the picker re-encode
      // first just chains two lossy passes.
      quality: 1,
    });
    if (res.canceled) return [];
    return Promise.all(
      res.assets.map(async (asset) => {
        try {
          const compressed = await compressImage({
            uri: asset.uri,
            width: asset.width,
            height: asset.height,
            filename: asset.fileName ?? `image-${Date.now()}`,
          });
          return {
            body: compressed.blob,
            contentType: compressed.contentType,
            byteSize: compressed.blob.size,
            filename: compressed.filename,
            _previewUri: asset.uri,
          };
        } catch (err) {
          console.warn('[poolse/picker] image compression failed, sending original:', err);
          const blob = await uriToBlob(asset.uri);
          const contentType = asset.mimeType ?? blob.type ?? 'image/jpeg';
          return {
            body: blob,
            contentType,
            byteSize: asset.fileSize ?? blob.size,
            filename: asset.fileName ?? `image-${Date.now()}.jpg`,
            _previewUri: asset.uri,
          };
        }
      }),
    );
  }
  const res = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
    multiple: true,
  });
  if (res.canceled) return [];
  return Promise.all(
    res.assets.map(async (asset) => {
      const isImage = (asset.mimeType ?? '').startsWith('image/');
      if (isImage) {
        try {
          const compressed = await compressImage({
            uri: asset.uri,
            filename: asset.name,
          });
          return {
            body: compressed.blob,
            contentType: compressed.contentType,
            byteSize: compressed.blob.size,
            filename: compressed.filename,
            _previewUri: asset.uri,
          };
        } catch (err) {
          console.warn('[poolse/picker] image compression failed, sending original:', err);
        }
      }
      const blob = await uriToBlob(asset.uri);
      const contentType = asset.mimeType ?? blob.type ?? 'application/octet-stream';
      return {
        body: blob,
        contentType,
        byteSize: asset.size ?? blob.size,
        filename: asset.name,
        _previewUri: asset.uri,
      };
    }),
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  sheet: {
    paddingVertical: 8,
    paddingBottom: 24,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 14,
  },
  cancel: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  itemText: {
    fontSize: 15,
    fontWeight: '500',
  },
});
