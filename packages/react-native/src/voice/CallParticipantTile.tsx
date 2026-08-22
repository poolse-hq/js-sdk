import type { CallParticipant } from '@poolse/sdk';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { PoolseIcon } from '../primitives/PoolseIcon.js';
import { CallAvatar } from './CallAvatar.js';
import { callColors } from './callTheme.js';
import type { CheckedVideoTrack } from './livekit-rn.js';

export interface CallParticipantTileProps {
  participant: CallParticipant;
  /** Narrowed `@livekit/react-native` VideoTrack, when the app supplied it. */
  VideoTrack?: CheckedVideoTrack | undefined;
  label: (userId: string) => string;
  style?: ViewStyle | ViewStyle[];
  /** Avatar diameter when the camera is off. */
  avatarSize?: number;
  /** Full-bleed tiles drop their rounding and their name chip shrinks. */
  bleed?: boolean;
  /** Hide the name chip — the spotlight draws identity in the header. */
  hideName?: boolean;
}

/**
 * One person on the call: their video, or their avatar when the camera
 * is off.
 *
 * A camera-off participant still gets a tile. Dropping them would make
 * a five-person call with four cameras off look like a one-person call,
 * and hide the fact that they are there and can hear you.
 */
export function CallParticipantTile({
  participant,
  VideoTrack,
  label,
  style,
  avatarSize = 72,
  bleed = false,
  hideName = false,
}: CallParticipantTileProps) {
  const name = participant.isSelf ? 'You' : (participant.name ?? label(participant.userId));
  const hasVideo = Boolean(participant.videoTrackRef && VideoTrack);

  return (
    <View
      style={[
        styles.tile,
        bleed ? styles.bleed : styles.rounded,
        {
          backgroundColor: callColors.tile,
          // A ring rather than a badge: it reads at a glance across a
          // grid, and it doesn't cover anyone's face.
          borderColor: participant.speaking ? callColors.accept : 'transparent',
        },
        style as ViewStyle,
      ]}
    >
      {hasVideo && VideoTrack ? (
        <VideoTrack
          trackRef={participant.videoTrackRef}
          style={StyleSheet.absoluteFillObject as ViewStyle}
          objectFit="cover"
          // Only your own preview is mirrored. Mirroring a remote feed
          // would flip their text and reverse which hand they wave with.
          mirror={participant.isSelf}
          zOrder={participant.isSelf ? 1 : 0}
        />
      ) : (
        <View style={styles.placeholder}>
          <CallAvatar
            name={name}
            seed={participant.userId}
            size={avatarSize}
            speaking={participant.speaking}
          />
        </View>
      )}

      {!hideName && (
        <View style={[styles.chip, bleed ? styles.chipBleed : styles.chipTile]}>
          {!participant.micEnabled && (
            // Worth showing even for yourself — it is the answer to
            // "why can nobody hear me".
            <PoolseIcon name="mic-off" size={13} color={callColors.text} label="muted" />
          )}
          <Text numberOfLines={1} style={styles.name}>
            {name}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { overflow: 'hidden', justifyContent: 'flex-end', borderWidth: 2 },
  rounded: { borderRadius: 18 },
  bleed: { borderRadius: 0, borderWidth: 0 },
  placeholder: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    borderRadius: 999,
    // Legible over both a bright video frame and a flat placeholder.
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  chipTile: { margin: 8, paddingHorizontal: 9, paddingVertical: 4.5, maxWidth: '92%' },
  chipBleed: { margin: 14, paddingHorizontal: 11, paddingVertical: 6, maxWidth: '80%' },
  name: { color: callColors.text, fontSize: 12.5, fontWeight: '600', flexShrink: 1 },
});
