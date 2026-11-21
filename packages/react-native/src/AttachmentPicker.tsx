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
import { EDGE_TO_EDGE_MODAL } from './internal/edgeToEdge.js';
import { useSafeInsets } from './internal/safeArea.js';
import { useSharedUpload, useUploadPreview } from './internal/uploadContext.js';
import { uploadRejection } from './internal/uploadRules.js';
import { useTheme } from './theme/PoolseTheme.js';

export interface AttachmentPickerProps {
  visible: boolean;
  onClose: () => void;
  /**
   * Optional adapter that produces upload inputs from a picked file.
   * Override to plug in custom storage / transcoding. Default reads
   * from `expo-image-picker` / `expo-document-picker`.
   */
  onPickInputs?: (kind: 'image' | 'document' | 'camera') => Promise<
    {
      body: { uri: string; name: string; type: string } | Blob | unknown;
      contentType: string;
      byteSize: number;
      filename?: string;
    }[]
  >;
  /**
   * Show the Camera item alongside Photo and File. Defaults true.
   * Disable if your app explicitly doesn't want camera access (some
   * App Store reviewers require an explicit usage description even
   * for the picker entry). Add `NSCameraUsageDescription` to your
   * iOS Info.plist when leaving this on.
   */
  camera?: boolean;
  /** Largest file accepted, in bytes (checked after image compression). */
  maxFileSize?: number;
  /** Accepted types: MIME types, wildcards (`'image/*'`) or extensions (`'.pdf'`). */
  acceptedTypes?: string[];
  /**
   * A picked file was refused (too large, a type not accepted) or the
   * picker failed (e.g. camera permission denied). Receives a sentence
   * to show; `<ConversationView>` shows it above the composer.
   */
  onError?: (message: string) => void;
  /** Pick several photos at once from the library. Defaults to true. */
  multiple?: boolean;
}

/**
 * Picker sheet wrapping `expo-image-picker` and `expo-document-picker`.
 * Both must be installed (`npx expo install expo-image-picker
 * expo-document-picker`) when this component is mounted — they're
 * declared as optional peers because consumers who pass
 * `attachments={false}` to ConversationView never render this file.
 */
export function AttachmentPicker({
  visible,
  onClose,
  onPickInputs,
  camera = true,
  maxFileSize,
  acceptedTypes,
  onError,
  multiple = true,
}: AttachmentPickerProps) {
  const theme = useTheme();
  const insets = useSafeInsets();
  // Shared queue (via UploadProvider) so the composer sees these
  // uploads and can include them in the next send. Falls back to a
  // local queue when the picker is mounted outside ConversationView.
  const upload = useSharedUpload();
  const { setPreview } = useUploadPreview();

  const pickFromKind = async (kind: 'image' | 'document' | 'camera') => {
    try {
      const adapter = onPickInputs ?? ((k: typeof kind) => defaultAdapter(k, { multiple }));
      const inputs = await adapter(kind);
      const rejected: string[] = [];
      for (const input of inputs) {
        const why = uploadRejection(
          {
            contentType: input.contentType,
            byteSize: input.byteSize,
            filename: input.filename ?? null,
          },
          {
            ...(maxFileSize !== undefined ? { maxFileSize } : {}),
            ...(acceptedTypes ? { acceptedTypes } : {}),
          },
        );
        if (why) {
          rejected.push(why);
          continue;
        }
        // Stash the original local URI on the shared context so the
        // UploadQueueStrip can render a real thumbnail. The SDK only
        // sees the Blob from here on out.
        const previewUri = (input as { _previewUri?: string })._previewUri ?? null;
        if (previewUri && input.filename) {
          setPreview(input.filename, previewUri);
        }
        void upload.upload(input as never);
      }
      if (rejected.length > 0) {
        onError?.(
          rejected.length === 1 ? rejected[0]! : `${rejected.length} files couldn't be attached.`,
        );
      }
    } catch (err) {
      console.warn('[poolse/picker]', err);
      onError?.(
        err instanceof PermissionDeniedError ? err.message : "Couldn't open the picker. Try again.",
      );
    } finally {
      onClose();
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      // Edge-to-edge on Android like the host app, so the sheet's
      // bottom padding below is what actually clears the nav bar.
      {...EDGE_TO_EDGE_MODAL}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.colors.surface,
              borderTopLeftRadius: theme.radii.lg,
              borderTopRightRadius: theme.radii.lg,
              // Cancel must sit above the nav bar / home indicator.
              paddingBottom: 24 + insets.bottom,
              paddingLeft: insets.left,
              paddingRight: insets.right,
            },
            theme.shadows.lg,
          ]}
        >
          {camera ? (
            <Pressable style={styles.item} onPress={() => pickFromKind('camera')}>
              <PoolseIcon name="camera" size={20} color={theme.colors.textMuted} />
              <Text style={[styles.itemText, { color: theme.colors.text }]}>Camera</Text>
            </Pressable>
          ) : null}
          <Pressable style={styles.item} onPress={() => pickFromKind('image')}>
            <PoolseIcon name="image" size={20} color={theme.colors.textMuted} />
            <Text style={[styles.itemText, { color: theme.colors.text }]}>Photo library</Text>
          </Pressable>
          <Pressable style={styles.item} onPress={() => pickFromKind('document')}>
            <PoolseIcon name="attachment" size={20} color={theme.colors.textMuted} />
            <Text style={[styles.itemText, { color: theme.colors.text }]}>File</Text>
          </Pressable>
          <Pressable style={styles.cancel} onPress={onClose}>
            <Text style={[styles.itemText, { color: theme.colors.accent }]}>Cancel</Text>
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
  const scale = longSide > COMPRESSION_LONG_SIDE_PX ? COMPRESSION_LONG_SIDE_PX / longSide : 1;
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

async function assetsToInputs(assets: ReadonlyArray<ImagePicker.ImagePickerAsset>) {
  return Promise.all(
    assets.map(async (asset) => {
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
          // The uploaded bytes: the server refuses a file bigger than declared.
          byteSize: blob.size || asset.fileSize || 0,
          filename: asset.fileName ?? `image-${Date.now()}.jpg`,
          _previewUri: asset.uri,
        };
      }
    }),
  );
}

class PermissionDeniedError extends Error {}

async function defaultAdapter(
  kind: 'image' | 'document' | 'camera',
  { multiple }: { multiple: boolean },
) {
  if (kind === 'camera') {
    // Camera permissions are required on both iOS (Info.plist
    // NSCameraUsageDescription) and Android. requestCameraPermissionsAsync
    // shows the system prompt the first time; subsequent calls
    // resolve immediately with the cached answer.
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      throw new PermissionDeniedError(
        'Camera access is off. Turn it on in Settings to take a photo.',
      );
    }
    const res = await ImagePicker.launchCameraAsync({
      mediaTypes: 'images',
      quality: 1,
    });
    if (res.canceled) return [];
    return assetsToInputs(res.assets);
  }
  if (kind === 'image') {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      // Quality 1 — picker hands back the source as-is and we do the
      // compression ourselves below. Letting the picker re-encode
      // first just chains two lossy passes.
      quality: 1,
      allowsMultipleSelection: multiple,
      ...(multiple ? { selectionLimit: 10 } : {}),
    });
    if (res.canceled) return [];
    return assetsToInputs(res.assets);
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
        // The uploaded bytes: the server refuses a file bigger than declared.
        byteSize: blob.size || asset.size || 0,
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
