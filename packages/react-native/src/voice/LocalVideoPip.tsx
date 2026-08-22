import type { CallParticipant } from '@poolse/sdk';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { CallParticipantTile } from './CallParticipantTile.js';
import type { CheckedVideoTrack } from './livekit-rn.js';

export interface LocalVideoPipProps {
  participant: CallParticipant;
  VideoTrack?: CheckedVideoTrack | undefined;
  label: (userId: string) => string;
  /** Area the tile may be dragged within, in pixels. */
  bounds: { width: number; height: number };
  /** Inset from the edges — keeps the tile clear of the call chrome. */
  insets?: { top: number; bottom: number };
  /** Tap handler. Wired to the camera flip, matching every other call app. */
  onPress?: (() => void) | undefined;
}

const PIP_WIDTH = 108;
const PIP_HEIGHT = 152;
const MARGIN = 14;

/**
 * The local camera preview, floating over the remote video.
 *
 * Draggable, and it snaps to the nearest corner on release rather than
 * staying wherever the finger stopped. Free positioning sounds more
 * flexible but reads as broken: a tile left at a slight angle to the
 * edge looks dropped rather than placed, and it is the corners people
 * actually want — they move it to uncover a face.
 *
 * Built on `Animated` + `PanResponder` from React Native itself. A
 * gesture library would be smoother, but it would be a new native
 * dependency for every app that installs this SDK, and a call preview
 * is not worth that.
 */
export function LocalVideoPip({
  participant,
  VideoTrack,
  label,
  bounds,
  insets,
  onPress,
}: LocalVideoPipProps) {
  const top = insets?.top ?? 0;
  const bottom = insets?.bottom ?? 0;

  // Corner anchors, recomputed when the screen or the chrome changes
  // (rotation, a control bar appearing).
  const corners = useMemo(() => {
    const right = Math.max(MARGIN, bounds.width - PIP_WIDTH - MARGIN);
    const low = Math.max(MARGIN, bounds.height - PIP_HEIGHT - bottom - MARGIN);
    const high = top + MARGIN;
    return [
      { x: MARGIN, y: high },
      { x: right, y: high },
      { x: MARGIN, y: low },
      { x: right, y: low },
    ];
  }, [bounds.width, bounds.height, top, bottom]);

  // Top-right to start: it is the corner least likely to cover a face,
  // which sits centre-frame, and it stays clear of the control bar.
  const [corner, setCorner] = useState(1);
  const pan = useRef(new Animated.ValueXY(corners[1]!)).current;

  // Read inside the responder without re-creating it — rebuilding the
  // PanResponder mid-gesture drops the drag.
  const cornersRef = useRef(corners);
  cornersRef.current = corners;
  const cornerRef = useRef(corner);
  cornerRef.current = corner;
  const dragged = useRef(false);

  // Follow the corners when the stage itself changes — a rotation, or
  // the control bar appearing. Without this the tile keeps the pixel
  // position it had under the old bounds, which after a rotation can be
  // most of the way off screen.
  useEffect(() => {
    if (dragged.current) return;
    const at = corners[corner];
    if (at) pan.setValue(at);
  }, [corners, corner, pan]);

  const responder = useMemo(
    () =>
      PanResponder.create({
        // Claim the gesture only once it is clearly a drag. A lower
        // threshold would swallow the taps that flip the camera.
        onMoveShouldSetPanResponder: (_evt, g) => Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4,
        onPanResponderGrant: () => {
          dragged.current = true;
          const at = cornersRef.current[cornerRef.current] ?? cornersRef.current[1]!;
          pan.setOffset({ x: at.x, y: at.y });
          pan.setValue({ x: 0, y: 0 });
        },
        onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], {
          useNativeDriver: false,
        }),
        onPanResponderRelease: (_evt, g) => {
          pan.flattenOffset();
          const at = cornersRef.current[cornerRef.current] ?? cornersRef.current[1]!;
          const dropped = { x: at.x + g.dx, y: at.y + g.dy };

          // Nearest corner by centre-to-centre distance.
          let best = 0;
          let bestDistance = Number.POSITIVE_INFINITY;
          cornersRef.current.forEach((c, index) => {
            const distance = (c.x - dropped.x) ** 2 + (c.y - dropped.y) ** 2;
            if (distance < bestDistance) {
              bestDistance = distance;
              best = index;
            }
          });

          setCorner(best);
          Animated.spring(pan, {
            toValue: cornersRef.current[best]!,
            useNativeDriver: false,
            friction: 8,
            tension: 70,
          }).start(() => {
            dragged.current = false;
          });
        },
      }),
    [pan],
  );

  return (
    <Animated.View
      {...responder.panHandlers}
      style={[styles.pip, { transform: pan.getTranslateTransform() }]}
    >
      <Pressable
        // Swallowed if the finger moved: releasing a drag over the tile
        // must not also flip the camera.
        onPress={() => {
          if (dragged.current) return;
          onPress?.();
        }}
        accessibilityRole="button"
        accessibilityLabel="Your camera. Drag to move, tap to switch camera."
        style={styles.fill}
      >
        <View style={styles.fill}>
          <CallParticipantTile
            participant={participant}
            VideoTrack={VideoTrack}
            label={label}
            avatarSize={48}
            hideName
            style={styles.fill as ViewStyle}
          />
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pip: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: PIP_WIDTH,
    height: PIP_HEIGHT,
    borderRadius: 16,
    overflow: 'hidden',
    // Lifted off the video so it reads as floating rather than inset.
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  fill: { flex: 1 },
});
