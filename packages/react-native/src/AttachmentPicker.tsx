import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
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

async function defaultAdapter(kind: 'image' | 'document') {
  if (kind === 'image') {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      quality: 0.85,
    });
    if (res.canceled) return [];
    return Promise.all(
      res.assets.map(async (asset) => {
        const blob = await uriToBlob(asset.uri);
        const contentType = asset.mimeType ?? blob.type ?? 'image/jpeg';
        // _previewUri is read by the picker before passing the input
        // to the SDK; the SDK ignores unknown fields.
        return {
          body: blob,
          contentType,
          byteSize: asset.fileSize ?? blob.size,
          filename: asset.fileName ?? `image-${Date.now()}.jpg`,
          _previewUri: asset.uri,
        };
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
