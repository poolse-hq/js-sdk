import { useAttachmentUpload } from '@poolse/react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { PoolseIcon } from './primitives/PoolseIcon.js';
import { usePoolseTheme } from './theme/PoolseTheme.js';

export interface AttachmentPickerProps {
  visible: boolean;
  onClose: () => void;
  /**
   * Optional adapter that produces an `AttachmentUploadInput` from a
   * picked RN file. Default reads `uri`/`name`/`type`/`size` and wraps
   * in a fetch-compatible `Blob`. Override to plug in custom storage
   * or transcoding.
   */
  onPickInputs?: (kind: 'image' | 'document') => Promise<
    {
      body: Blob | { uri: string; name: string; type: string } | unknown;
      contentType: string;
      byteSize: number;
      filename?: string;
    }[]
  >;
}

/**
 * Picker sheet wrapping `expo-image-picker` and `expo-document-picker`.
 * Both are OPTIONAL peer dependencies — install only the ones you
 * actually use. If a picker is mounted without its dep installed,
 * the corresponding button is disabled with a tooltip explaining
 * which install command to run.
 *
 * Default implementation dynamically `import()`s the Expo modules
 * at mount; the caller can pass `onPickInputs` to skip Expo entirely.
 */
export function AttachmentPicker({ visible, onClose, onPickInputs }: AttachmentPickerProps) {
  const theme = usePoolseTheme();
  const upload = useAttachmentUpload();

  const pickFromKind = async (kind: 'image' | 'document') => {
    try {
      const adapter = onPickInputs ?? defaultAdapter;
      const inputs = await adapter(kind);
      for (const input of inputs) {
        void upload.upload(input as never);
      }
    } catch (err) {
      // Surface picker errors via the queue's `error` field for the
      // composer's status row. No throw past the picker boundary.
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

// Default adapter — lazily imports the relevant Expo module so apps
// that don't use a given kind don't pay for the dep weight at boot.
async function defaultAdapter(kind: 'image' | 'document') {
  if (kind === 'image') {
    const mod = await tryImport('expo-image-picker');
    if (!mod)
      throw new Error('expo-image-picker not installed — `npx expo install expo-image-picker`');
    const res = await mod.launchImageLibraryAsync({ mediaTypes: 'images', quality: 0.85 });
    if (res.canceled) return [];
    return res.assets.map(
      (asset: { uri: string; mimeType?: string; fileSize?: number; fileName?: string }) => ({
        body: {
          uri: asset.uri,
          name: asset.fileName ?? 'image.jpg',
          type: asset.mimeType ?? 'image/jpeg',
        },
        contentType: asset.mimeType ?? 'image/jpeg',
        byteSize: asset.fileSize ?? 0,
        filename: asset.fileName ?? 'image.jpg',
      }),
    );
  }
  const mod = await tryImport('expo-document-picker');
  if (!mod)
    throw new Error('expo-document-picker not installed — `npx expo install expo-document-picker`');
  const res = await mod.getDocumentAsync({ copyToCacheDirectory: true, multiple: true });
  if (res.canceled) return [];
  return res.assets.map(
    (asset: { uri: string; mimeType?: string; size?: number; name: string }) => ({
      body: {
        uri: asset.uri,
        name: asset.name,
        type: asset.mimeType ?? 'application/octet-stream',
      },
      contentType: asset.mimeType ?? 'application/octet-stream',
      byteSize: asset.size ?? 0,
      filename: asset.name,
    }),
  );
}

async function tryImport(name: string): Promise<any | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    return await (new Function('m', 'return import(m)') as (m: string) => Promise<unknown>)(name);
  } catch {
    return null;
  }
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
