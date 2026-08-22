import type { CallParticipant } from '@poolse/sdk';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View, type LayoutChangeEvent, type ViewStyle } from 'react-native';

import { CallParticipantTile } from './CallParticipantTile.js';
import { LocalVideoPip } from './LocalVideoPip.js';
import type { CheckedVideoTrack, LiveKitReactNativeModule } from './livekit-rn.js';

export type { LiveKitReactNativeModule };

export interface CallVideoGridProps {
  participants: CallParticipant[];
  /** `@livekit/react-native`, imported by your app. */
  livekitReactNative?: LiveKitReactNativeModule | null | undefined;
  /** Resolves a user id to a display label. */
  labelFor?: ((userId: string) => string) | undefined;
  /**
   * Tapping the local preview. Wired to the camera flip by
   * `CallScreen`, which is where every other call app puts it.
   */
  onLocalPress?: (() => void) | undefined;
  /**
   * How much chrome sits over the top and bottom of the stage, so the
   * floating preview does not park itself under the control bar.
   */
  chromeInsets?: { top: number; bottom: number } | undefined;
}

const GAP = 8;
/** Below this a tile shows a head as a postage stamp, so the grid scrolls instead. */
const MIN_TILE_HEIGHT = 132;

/**
 * The stage: everyone on the call, laid out for how many there are.
 *
 * Three layouts, because one grid cannot serve all of them:
 *
 *   * **Alone** — you, filling the screen, while the far side connects.
 *   * **One other person** — them full-bleed, you in a draggable
 *     corner tile. A 1:1 call split into two half-height boxes wastes
 *     most of the screen on letterboxing, which is why no calling app
 *     does it.
 *   * **Three or more** — a real grid, two columns up to six people and
 *     three beyond that, scrolling once the tiles would be too small to
 *     make out a face.
 *
 * Audio calls land here too. Everyone simply has their camera off, so
 * every tile draws an avatar, and the layout logic does not need to
 * know whether video was ever on the table.
 */
export function CallVideoGrid({
  participants,
  livekitReactNative,
  labelFor,
  onLocalPress,
  chromeInsets,
}: CallVideoGridProps) {
  const label = labelFor ?? ((id: string) => `User ${id.slice(0, 6)}`);
  const VideoTrack = livekitReactNative?.VideoTrack as CheckedVideoTrack | undefined;
  const [size, setSize] = useState({ width: 0, height: 0 });

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize((current) =>
      current.width === width && current.height === height ? current : { width, height },
    );
  };

  const self = participants.find((p) => p.isSelf) ?? null;
  const others = useMemo(() => participants.filter((p) => !p.isSelf), [participants]);

  const columns = others.length + 1 <= 6 ? 2 : 3;
  const rows = Math.ceil((others.length + 1) / columns);
  const tileHeight = size.height > 0 ? (size.height - GAP * (rows - 1)) / rows : 0;
  const scrolls = tileHeight > 0 && tileHeight < MIN_TILE_HEIGHT;

  if (participants.length === 0) return <View style={styles.stage} onLayout={onLayout} />;

  // ── alone, or one other person: spotlight + floating preview ────────
  if (others.length <= 1) {
    const spotlight = others[0] ?? self;
    if (!spotlight) return <View style={styles.stage} onLayout={onLayout} />;

    return (
      <View style={styles.stage} onLayout={onLayout}>
        <CallParticipantTile
          participant={spotlight}
          VideoTrack={VideoTrack}
          label={label}
          avatarSize={Math.min(148, Math.max(96, Math.round(size.width * 0.36)))}
          bleed
          // Their name is already in the header; repeating it over the
          // video is noise on a two-person call.
          hideName={others.length === 1}
          style={styles.fill as ViewStyle}
        />

        {/* Only once somebody else is here. Your own preview floating
            over your own preview is just a mirror in a mirror. */}
        {self && others.length === 1 && size.width > 0 && (
          <LocalVideoPip
            participant={self}
            VideoTrack={VideoTrack}
            label={label}
            bounds={size}
            insets={chromeInsets ?? { top: 0, bottom: 0 }}
            onPress={onLocalPress}
          />
        )}
      </View>
    );
  }

  // ── three or more: a grid ───────────────────────────────────────────
  // Remote faces lead and you sit last, which is both what people look
  // for first and a stable order — promoting the active speaker would
  // reshuffle the grid every time somebody spoke.
  const tiles = [...others, ...(self ? [self] : [])];
  const width = size.width > 0 ? (size.width - GAP * (columns - 1)) / columns : 0;

  const grid = (
    <View style={[styles.grid, scrolls ? styles.gridScrolling : styles.gridFilling]}>
      {tiles.map((participant) => (
        <CallParticipantTile
          key={participant.userId}
          participant={participant}
          VideoTrack={VideoTrack}
          label={label}
          avatarSize={columns === 2 ? 66 : 46}
          style={
            {
              width: width || undefined,
              height: scrolls ? MIN_TILE_HEIGHT : tileHeight || undefined,
            } as ViewStyle
          }
        />
      ))}
    </View>
  );

  return (
    <View style={styles.stage} onLayout={onLayout}>
      {scrolls ? (
        <ScrollView
          // Padding rather than `contentInset`, which is iOS-only. The
          // control bar floats over the bottom of the stage, so the last
          // row needs room to clear it on both platforms.
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: (chromeInsets?.bottom ?? 0) + GAP },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {grid}
        </ScrollView>
      ) : (
        grid
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1, overflow: 'hidden' },
  fill: { ...StyleSheet.absoluteFillObject },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  gridFilling: { flex: 1, alignContent: 'center' },
  gridScrolling: { alignContent: 'flex-start' },
  scroll: { paddingVertical: GAP },
});
