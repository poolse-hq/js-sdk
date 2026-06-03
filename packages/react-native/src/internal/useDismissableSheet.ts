import { useMemo, useRef } from 'react';
import { Animated, PanResponder } from 'react-native';

interface Options {
  /** Called once the dismiss animation completes. */
  onClose: () => void;
  /**
   * Sheet height in pixels — used as the off-screen target when
   * animating dismissal. Pass `Dimensions.get('window').height * 0.85`
   * for a standard 85% bottom sheet.
   */
  sheetHeight: number;
  /**
   * Fraction of sheetHeight the user must drag past to commit
   * dismissal on release. Defaults to 0.22. Quick flicks (high
   * vertical velocity) also commit regardless of distance.
   */
  dismissThreshold?: number;
}

/**
 * Adds a pull-down-to-dismiss gesture to a bottom sheet. Returns an
 * Animated `translateY` to apply to the sheet's outer wrapper +
 * `panHandlers` to spread on whichever sub-view captures the drag
 * (typically the drag-pill area at the top, OR the whole sheet if
 * you want anywhere-drag to work).
 *
 * Only claims the gesture on clear downward motion; horizontal /
 * upward drags pass through to children (so a FlatList inside the
 * sheet can still scroll normally).
 */
export function useDismissableSheet({ onClose, sheetHeight, dismissThreshold = 0.22 }: Options) {
  const translateY = useRef(new Animated.Value(0)).current;

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => {
          // Only claim on clear downward intent. Lets the FlatList
          // inside the sheet handle vertical scrolls upward.
          return g.dy > 6 && g.dy > Math.abs(g.dx);
        },
        onPanResponderMove: (_, g) => {
          // Only follow downward drag (positive dy). Upward goes
          // back to 0 — sheet can't be pulled UP past its anchor.
          translateY.setValue(Math.max(0, g.dy));
        },
        onPanResponderRelease: (_, g) => {
          const committed = g.dy > sheetHeight * dismissThreshold || g.vy > 0.6;
          if (committed) {
            // Animate the sheet off-screen, THEN fire onClose. Without
            // this the modal's own slide-out + our reset would fight.
            Animated.timing(translateY, {
              toValue: sheetHeight,
              duration: 180,
              useNativeDriver: true,
            }).start(() => {
              translateY.setValue(0);
              onClose();
            });
          } else {
            Animated.spring(translateY, {
              toValue: 0,
              useNativeDriver: true,
              speed: 22,
              bounciness: 4,
            }).start();
          }
        },
        onPanResponderTerminate: () => {
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            speed: 22,
            bounciness: 4,
          }).start();
        },
      }),
    [onClose, sheetHeight, dismissThreshold, translateY],
  );

  return { translateY, panHandlers: panResponder.panHandlers };
}
