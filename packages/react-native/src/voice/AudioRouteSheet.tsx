import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { PoolseIcon, type IconName } from '../primitives/PoolseIcon.js';
import { EDGE_TO_EDGE_MODAL } from '../internal/edgeToEdge.js';
import { useSafeInsets } from '../internal/safeArea.js';
import { callColors } from './callTheme.js';

export type AudioRouteKind = 'speaker' | 'earpiece' | 'headset' | 'bluetooth' | 'auto';

/** One place call audio can play — a row in the sheet. */
export interface AudioRoute {
  /** Platform id, passed back through `onSelect`. */
  id: string;
  kind: AudioRouteKind;
  /** Human label for the row. */
  label: string;
}

export interface AudioRouteSheetProps {
  visible: boolean;
  routes: AudioRoute[];
  /** Platform id of the chosen route, or null while routing is automatic. */
  selectedRouteId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}

const ICONS: Record<AudioRouteKind, IconName> = {
  speaker: 'speaker',
  earpiece: 'phone',
  headset: 'headphones',
  bluetooth: 'bluetooth',
  auto: 'phone',
};

/**
 * Pick where call audio comes out.
 *
 * Only worth showing when there is a real choice — more than the phone
 * and its speaker (AirPods, a car, a headset beside the speaker). With
 * just those two, a single speaker toggle is the better control.
 */
export function AudioRouteSheet({
  visible,
  routes,
  selectedRouteId,
  onSelect,
  onClose,
}: AudioRouteSheetProps) {
  // The device's real insets — the sheet is a modal over the call.
  const insets = useSafeInsets();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      // Edge-to-edge on Android so the padding below is what clears
      // the nav bar.
      {...EDGE_TO_EDGE_MODAL}
    >
      {/* Tapping away closes it, which is what a sheet like this owes
          anyone who opened it by accident mid-call. */}
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button">
        <Pressable
          // The old fixed 34 was an iPhone home-indicator guess; a
          // 3-button Android nav bar is taller, so use the real inset.
          style={[styles.sheet, { paddingBottom: Math.max(34, insets.bottom + 16) }]}
          onPress={() => {}}
        >
          <View style={styles.grabber} />
          <Text style={styles.title}>Audio output</Text>

          {routes.map((route) => {
            const selected = route.id === selectedRouteId;
            return (
              <Pressable
                key={route.id}
                onPress={() => {
                  onSelect(route.id);
                  onClose();
                }}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              >
                <PoolseIcon
                  name={ICONS[route.kind]}
                  size={21}
                  color={selected ? callColors.accept : callColors.text}
                  label={null}
                />
                <Text style={[styles.label, selected && styles.labelSelected]}>{route.label}</Text>
                {selected && (
                  <PoolseIcon name="check" size={19} color={callColors.accept} label="selected" />
                )}
              </Pressable>
            );
          })}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: callColors.tile,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 12,
    paddingTop: 10,
    gap: 2,
  },
  grabber: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: callColors.textFaint,
    marginBottom: 12,
  },
  title: {
    color: callColors.textDim,
    fontSize: 12.5,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 12,
    paddingVertical: 15,
    borderRadius: 14,
  },
  rowPressed: { backgroundColor: 'rgba(255,255,255,0.08)' },
  label: { flex: 1, color: callColors.text, fontSize: 16, fontWeight: '500' },
  labelSelected: { color: callColors.accept },
});
