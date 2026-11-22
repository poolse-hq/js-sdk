// What draws over a call: live captions (CL13), floating reactions and
// the reaction bar (CL6), connection marks and the "your network…"
// banner (CL15), the whiteboard (CL12) and annotations on a shared
// screen (CL4, view only on phones).
//
//     const t = useLiveTranscript(callId, { enabled: captionsOn });
//     {captionsOn && <CaptionsOverlay segments={t.segments} />}
//     <ReactionsOverlay reactions={useCallReactions(media.room).reactions} />
//     <NetworkBanner issues={useCallQuality(media.room)?.issues ?? []} />
//     // @poolse/native: diagnoseCallNetwork({ quality: snapshot.connectionQuality, reconnecting: snapshot.phase === 'reconnecting' })

import type {
  AnnotationState,
  CallConnectionQuality,
  CallNetworkIssue,
  CallReaction,
  LiveTranscriptSegment,
  WhiteboardItem,
  WhiteboardModel,
} from '@poolse/sdk';
import { DEFAULT_CALL_REACTIONS, WHITEBOARD_SIZE, connectionQualityLabel } from '@poolse/sdk';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Circle, Ellipse, G, Path, Rect, Svg, Text as SvgText } from 'react-native-svg';

import { arrowHeadPath, captionLines, pointsToPath, qualityBars } from './internal/meetingsLive.js';
import { useTheme } from './theme/PoolseTheme.js';

function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled?.()
      .then((r) => alive && setReduce(r))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', setReduce);
    return () => {
      alive = false;
      sub?.remove();
    };
  }, []);
  return reduce;
}

// ── Captions (CL13) ──────────────────────────────────────────────────────

export interface CaptionsOverlayProps {
  /** `useLiveTranscript(callId).segments`. */
  segments: readonly LiveTranscriptSegment[];
  /** How many lines to show. Defaults to 2. */
  lines?: number;
  style?: StyleProp<ViewStyle>;
}

/** The last lines of the live transcript, with speaker names; words still being spoken are dimmed. */
export function CaptionsOverlay({ segments, lines = 2, style }: CaptionsOverlayProps) {
  const shown = useMemo(() => captionLines(segments, lines), [segments, lines]);
  if (shown.length === 0) return null;
  return (
    <View style={[styles.captions, style]} accessibilityLiveRegion="polite" pointerEvents="none">
      {shown.map((l) => (
        <Text key={l.key} style={styles.captionText} numberOfLines={2}>
          <Text style={styles.captionSpeaker}>{l.speaker}: </Text>
          <Text style={l.interim ? styles.interim : null}>{l.text}</Text>
        </Text>
      ))}
    </View>
  );
}

// ── Reactions (CL6) ──────────────────────────────────────────────────────

function FloatingReaction({
  reaction,
  reduce,
  lane,
}: {
  reaction: CallReaction;
  reduce: boolean;
  lane: number;
}) {
  const rise = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduce) return;
    Animated.timing(rise, { toValue: 1, duration: 3500, useNativeDriver: true }).start();
  }, [rise, reduce]);
  const style = reduce
    ? { opacity: 1 }
    : {
        opacity: rise.interpolate({ inputRange: [0, 0.8, 1], outputRange: [1, 1, 0] }),
        transform: [
          { translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [0, -220] }) },
        ],
      };
  return (
    <Animated.View style={[styles.floating, { left: `${10 + lane * 12}%` }, style]}>
      <Text style={styles.floatingEmoji}>{reaction.emoji}</Text>
    </Animated.View>
  );
}

export interface ReactionsOverlayProps {
  /** `useCallReactions(room).reactions`. */
  reactions: readonly CallReaction[];
  style?: StyleProp<ViewStyle>;
}

/** Reactions rising over the call (still, with Reduce Motion). Never takes touches. */
export function ReactionsOverlay({ reactions, style }: ReactionsOverlayProps) {
  const reduce = useReduceMotion();
  return (
    <View style={[StyleSheet.absoluteFill, style]} pointerEvents="none">
      {reactions.map((r, i) => (
        <FloatingReaction key={r.id} reaction={r} reduce={reduce} lane={i % 7} />
      ))}
    </View>
  );
}

export interface ReactionPickerBarProps {
  onReact: (emoji: string) => void;
  emojis?: readonly string[];
  style?: StyleProp<ViewStyle>;
}

/** A row of reaction buttons (`DEFAULT_CALL_REACTIONS`). */
export function ReactionPickerBar({
  onReact,
  emojis = DEFAULT_CALL_REACTIONS,
  style,
}: ReactionPickerBarProps) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.picker,
        { backgroundColor: theme.colors.surface, borderRadius: theme.radii.pill },
        style,
      ]}
      accessibilityRole="toolbar"
    >
      {emojis.map((e) => (
        <Pressable
          key={e}
          onPress={() => onReact(e)}
          accessibilityRole="button"
          accessibilityLabel={`React ${e}`}
          hitSlop={4}
          style={({ pressed }) => [styles.pickerBtn, pressed && { opacity: 0.6 }]}
        >
          <Text style={styles.pickerEmoji}>{e}</Text>
        </Pressable>
      ))}
    </View>
  );
}

// ── Call quality (CL15) ──────────────────────────────────────────────────

export interface ConnectionIndicatorProps {
  /** A web `CallConnectionQuality` or the native core's `'good' | 'poor' | 'lost' | 'unknown'`. */
  quality: CallConnectionQuality | 'good' | 'poor' | 'lost' | 'unknown' | null | undefined;
  /** Bar height in px. Defaults to 12. */
  size?: number;
  style?: StyleProp<ViewStyle>;
}

/** Three signal bars; a weak link turns amber, a lost one red. Labelled for screen readers. */
export function ConnectionIndicator({ quality, size = 12, style }: ConnectionIndicatorProps) {
  const theme = useTheme();
  const bars = qualityBars(quality);
  const color =
    quality === 'lost'
      ? theme.colors.danger
      : quality === 'poor'
        ? theme.colors.warning
        : theme.colors.success;
  if (!quality || quality === 'unknown') return null;
  return (
    <View
      style={[styles.bars, { height: size }, style]}
      accessible
      accessibilityLabel={connectionQualityLabel(quality)}
    >
      {[1, 2, 3].map((n) => (
        <View
          key={n}
          style={{
            width: Math.max(2, size / 4),
            height: (size * n) / 3,
            borderRadius: 1,
            backgroundColor: n <= bars ? color : theme.colors.border,
          }}
        />
      ))}
    </View>
  );
}

export interface NetworkBannerProps {
  /** `useCallQuality(room)?.issues`, or `diagnoseCallNetwork(…)` from a native snapshot. */
  issues: readonly CallNetworkIssue[];
  onDismiss?: () => void;
  style?: StyleProp<ViewStyle>;
}

/** The worst network problem in plain words ("Your network is dropping packets…"). */
export function NetworkBanner({ issues, onDismiss, style }: NetworkBannerProps) {
  const theme = useTheme();
  const issue = issues[0];
  if (!issue) return null;
  const tone = issue.severity === 'error' ? theme.colors.danger : theme.colors.warning;
  return (
    <View
      style={[
        styles.network,
        { borderColor: tone, backgroundColor: theme.colors.surface, borderRadius: theme.radii.md },
        style,
      ]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <View style={[styles.networkDot, { backgroundColor: tone }]} />
      <View style={styles.grow}>
        <Text
          style={[styles.networkTitle, { color: theme.colors.text, fontFamily: theme.fonts.body }]}
        >
          {issue.title}
        </Text>
        <Text
          style={[
            styles.networkDetail,
            { color: theme.colors.textMuted, fontFamily: theme.fonts.body },
          ]}
        >
          {issue.detail}
        </Text>
      </View>
      {onDismiss ? (
        <Pressable
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          hitSlop={8}
        >
          <Text style={{ color: theme.colors.textMuted, fontSize: 18 }}>×</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ── Whiteboard (CL12) ────────────────────────────────────────────────────

function BoardItem({ item }: { item: WhiteboardItem }) {
  switch (item.kind) {
    case 'stroke':
      return (
        <Path
          d={pointsToPath(item.points)}
          stroke={item.color}
          strokeWidth={item.width}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case 'rect':
      return (
        <Rect
          x={Math.min(item.x, item.x + item.w)}
          y={Math.min(item.y, item.y + item.h)}
          width={Math.abs(item.w)}
          height={Math.abs(item.h)}
          stroke={item.color}
          strokeWidth={item.width}
          fill={item.fill ?? 'none'}
        />
      );
    case 'ellipse':
      return (
        <Ellipse
          cx={item.x + item.w / 2}
          cy={item.y + item.h / 2}
          rx={Math.abs(item.w / 2)}
          ry={Math.abs(item.h / 2)}
          stroke={item.color}
          strokeWidth={item.width}
          fill={item.fill ?? 'none'}
        />
      );
    case 'line':
      return (
        <Path
          d={`M${item.x} ${item.y} L${item.x + item.w} ${item.y + item.h}`}
          stroke={item.color}
          strokeWidth={item.width}
          strokeLinecap="round"
        />
      );
    case 'arrow':
      return (
        <G>
          <Path
            d={`M${item.x} ${item.y} L${item.x + item.w} ${item.y + item.h}`}
            stroke={item.color}
            strokeWidth={item.width}
            strokeLinecap="round"
          />
          <Path
            d={arrowHeadPath(item)}
            stroke={item.color}
            strokeWidth={item.width}
            fill="none"
            strokeLinecap="round"
          />
        </G>
      );
    case 'text':
      return (
        <SvgText x={item.x} y={item.y} fill={item.color} fontSize={item.size}>
          {item.text}
        </SvgText>
      );
  }
}

export interface WhiteboardViewProps {
  /** `useWhiteboard(callId, Y).items`. */
  items: readonly WhiteboardItem[];
  /** With a model and not `readOnly`, a finger draws pen strokes. */
  model?: WhiteboardModel | null;
  readOnly?: boolean;
  /** Pen colour and width (board units). */
  color?: string;
  width?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * The call's whiteboard, fit to the view (1600 × 900 board units). View
 * only by default; pass the model to draw simple pen strokes.
 */
export function WhiteboardView({
  items,
  model,
  readOnly = true,
  color = '#1f2328',
  width = 4,
  style,
}: WhiteboardViewProps) {
  const theme = useTheme();
  const [box, setBox] = useState({ w: 0, h: 0 });
  const current = useRef<{ id: string | null; points: number[] }>({ id: null, points: [] });
  const scale =
    box.w && box.h ? Math.min(box.w / WHITEBOARD_SIZE.width, box.h / WHITEBOARD_SIZE.height) : 1;
  const ox = (box.w - WHITEBOARD_SIZE.width * scale) / 2;
  const oy = (box.h - WHITEBOARD_SIZE.height * scale) / 2;
  const drawing = !!model && !readOnly;
  const toBoard = (x: number, y: number) => [(x - ox) / scale, (y - oy) / scale] as const;

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => drawing,
        onMoveShouldSetPanResponder: () => drawing,
        onPanResponderGrant: (e) => {
          const [x, y] = toBoard(e.nativeEvent.locationX, e.nativeEvent.locationY);
          current.current = {
            id: model?.add({ kind: 'stroke', points: [x, y], color, width }) ?? null,
            points: [x, y],
          };
        },
        onPanResponderMove: (e) => {
          const c = current.current;
          if (!c.id || !model) return;
          const [x, y] = toBoard(e.nativeEvent.locationX, e.nativeEvent.locationY);
          c.points.push(Math.round(x), Math.round(y));
          // One replace per 4 points keeps the Yjs updates small.
          if (c.points.length % 8 === 0) model.update(c.id, { points: [...c.points] } as never);
        },
        onPanResponderRelease: () => {
          const c = current.current;
          if (c.id && model) model.update(c.id, { points: [...c.points] } as never);
          current.current = { id: null, points: [] };
        },
      }),
    // toBoard depends on the box and scale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drawing, model, color, width, scale, ox, oy],
  );

  return (
    <View
      style={[
        styles.board,
        {
          backgroundColor: '#ffffff',
          borderColor: theme.colors.border,
          borderRadius: theme.radii.md,
        },
        style,
      ]}
      onLayout={(e: LayoutChangeEvent) =>
        setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })
      }
      accessible
      accessibilityLabel={`Whiteboard, ${items.length} ${items.length === 1 ? 'item' : 'items'}${drawing ? '. Draw with one finger' : ''}`}
      {...(drawing ? pan.panHandlers : {})}
    >
      {box.w > 0 ? (
        <Svg width={box.w} height={box.h}>
          <G transform={`translate(${ox} ${oy}) scale(${scale})`}>
            {items.map((item) => (
              <BoardItem key={item.id} item={item} />
            ))}
          </G>
        </Svg>
      ) : null}
    </View>
  );
}

// ── Annotations on a shared screen (CL4) ─────────────────────────────────

export interface AnnotationOverlayProps {
  /** `useScreenAnnotations(room, sharerUserId).state`. */
  state: AnnotationState | null;
  style?: StyleProp<ViewStyle>;
}

/**
 * Lines and pointers others draw on a shared screen, laid over the
 * screen's video (same box, `fit="contain"` area). View only.
 */
export function AnnotationOverlay({ state, style }: AnnotationOverlayProps) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  return (
    <View
      style={[StyleSheet.absoluteFill, style]}
      pointerEvents="none"
      onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
    >
      {state && box.w > 0 ? (
        <Svg width={box.w} height={box.h}>
          {state.strokes.map((s) => (
            <Path
              key={s.id}
              d={pointsToPath(s.points, box.w, box.h)}
              stroke={s.color}
              strokeWidth={Math.max(1.5, s.width * box.w)}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          {state.pointers.map((p) => (
            <G key={p.userId}>
              <Circle cx={p.x * box.w} cy={p.y * box.h} r={7} fill="#e5484d" opacity={0.85} />
              <SvgText
                x={p.x * box.w + 10}
                y={p.y * box.h + 4}
                fill="#ffffff"
                stroke="#000000"
                strokeWidth={0.3}
                fontSize={12}
              >
                {(p.name ?? 'Someone').slice(0, 24)}
              </SvgText>
            </G>
          ))}
        </Svg>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  captions: {
    alignSelf: 'center',
    maxWidth: 680,
    backgroundColor: 'rgba(0,0,0,0.72)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 2,
  },
  captionText: { color: '#ffffff', fontSize: 16, lineHeight: 22 },
  captionSpeaker: { fontWeight: '600', color: '#d0d7de' },
  interim: { opacity: 0.7, fontStyle: 'italic' },
  floating: { position: 'absolute', bottom: 24 },
  floatingEmoji: { fontSize: 32 },
  picker: {
    flexDirection: 'row',
    paddingHorizontal: 6,
    paddingVertical: 4,
    gap: 2,
    alignSelf: 'center',
  },
  pickerBtn: {
    padding: 6,
    minWidth: 40,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerEmoji: { fontSize: 24 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 1.5 },
  network: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 10, borderWidth: 1 },
  networkDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  networkTitle: { fontSize: 14, fontWeight: '600' },
  networkDetail: { fontSize: 13, lineHeight: 18 },
  board: { overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, aspectRatio: 16 / 9 },
});
