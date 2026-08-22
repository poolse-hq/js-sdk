import type { CallParticipant } from '@poolse/sdk';
import type { ComponentType } from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { usePoolseTheme } from '../theme/PoolseTheme.js';

/**
 * The slice of `@livekit/react-native` this needs.
 *
 * Passed in by the app rather than imported, for the same reason
 * `react-native-webrtc` is: tsup rewrites `require()` into
 * `__require()`, which Metro cannot follow, so anything this package
 * imports for itself never reaches a React Native bundle.
 *
 *     import * as livekitRN from '@livekit/react-native';
 */
export interface LiveKitReactNativeModule {
  /**
   * The module's `VideoTrack` component.
   *
   * Typed as `unknown` on purpose. Its real props are far more specific
   * than what this renders with, and React component props are
   * contravariant — declaring the narrow shape here means the real
   * component is not assignable to it and no app can pass the module in.
   * It is narrowed to {@link CheckedVideoTrack} at the point of use.
   */
  VideoTrack: unknown;
}

/** The slice actually rendered, narrowed once inside the component. */
type CheckedVideoTrack = ComponentType<{
  trackRef: unknown;
  style?: ViewStyle;
  objectFit?: 'cover' | 'contain';
  mirror?: boolean;
  zOrder?: number;
}>;

export interface CallVideoGridProps {
  participants: CallParticipant[];
  /** `@livekit/react-native`, imported by your app. */
  livekitReactNative?: LiveKitReactNativeModule | null | undefined;
  /** Resolves a user id to a display label. */
  labelFor?: ((userId: string) => string) | undefined;
}

/**
 * The video half of a call: one tile per participant.
 *
 * Someone with their camera off still gets a tile, showing their name
 * and whether they're muted. Dropping them would make a five-person
 * call with four cameras off look like a one-person call, and hide the
 * fact that they are there and can hear you.
 *
 * Tiles are laid out in a simple grid that stays square-ish as the call
 * grows. There is no active-speaker promotion yet — with the small
 * calls an SFU mesh replacement is sized for, everyone fits on screen.
 */
export function CallVideoGrid({ participants, livekitReactNative, labelFor }: CallVideoGridProps) {
  const theme = usePoolseTheme();
  const label = labelFor ?? ((id: string) => `User ${id.slice(0, 6)}`);
  const VideoTrack = livekitReactNative?.VideoTrack as CheckedVideoTrack | undefined;

  if (participants.length === 0) return null;

  // Two columns from two participants up. One person on a call is
  // either the caller waiting or a room they walked into alone, and a
  // half-width tile there just looks broken.
  const columns = participants.length <= 1 ? 1 : 2;
  const basis = columns === 1 ? '100%' : '48%';

  return (
    <View style={styles.grid}>
      {participants.map((participant) => (
        <View
          key={participant.userId}
          style={[
            styles.tile,
            {
              flexBasis: basis,
              backgroundColor: theme.colors.surface,
              // A ring rather than a badge: it reads at a glance in a
              // grid, and doesn't cover a face.
              borderColor: participant.speaking ? theme.colors.brand : 'transparent',
            },
          ]}
        >
          {participant.videoTrackRef && VideoTrack ? (
            <VideoTrack
              trackRef={participant.videoTrackRef}
              style={styles.video}
              objectFit="cover"
              // Only your own preview is mirrored. Mirroring a remote
              // feed would flip their text and reverse which hand they
              // are waving with.
              mirror={participant.isSelf}
              zOrder={participant.isSelf ? 1 : 0}
            />
          ) : (
            <View style={styles.placeholder}>
              <Text style={[styles.initial, { color: theme.colors.ink3 }]}>
                {label(participant.userId).slice(0, 1).toUpperCase()}
              </Text>
            </View>
          )}

          <View style={styles.caption}>
            <Text numberOfLines={1} style={[styles.name, { color: theme.colors.onBrand }]}>
              {participant.isSelf ? 'You' : (participant.name ?? label(participant.userId))}
            </Text>
            {!participant.micEnabled && (
              // Muted is worth showing even for yourself — it is the
              // answer to "why can nobody hear me".
              <Text style={[styles.muted, { color: theme.colors.onBrand }]}>muted</Text>
            )}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignContent: 'center',
    gap: 8,
  },
  tile: {
    aspectRatio: 3 / 4,
    borderRadius: 16,
    borderWidth: 2,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  video: { ...StyleSheet.absoluteFillObject },
  placeholder: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  initial: { fontSize: 48, fontWeight: '600' },
  caption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    // Legible over both a bright video frame and a flat placeholder.
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  name: { flexShrink: 1, fontSize: 13, fontWeight: '600' },
  muted: { fontSize: 11, opacity: 0.85 },
});
