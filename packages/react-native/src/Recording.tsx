// Recording and consent UI (docs/RECORDING.md): the banner everyone in a
// captured call sees, a small indicator, the consent prompt, and the
// chat line for the recording notice. Same props as @poolse/react-ui.
//
//     const rec = useRecording(call.id, call.conversation_id);
//     <RecordingBanner recording={rec.active} transcribing={!!rec.transcription?.active} … />
//     {rec.needsConsent && (
//       <ConsentPrompt recording={rec.active} onAnswer={rec.consent} onAccepted={republish} />
//     )}

import type { ConsentDecision, Message, RecordingMode, Uuid } from '@poolse/sdk';
import { captureLabel, recordingNoticeDisplayFor } from '@poolse/react';
import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useTheme } from './theme/PoolseTheme.js';

/** The red recording light, pulsing while live (still with Reduce Motion). */
function RecDot({ off = false, color }: { off?: boolean; color?: string }) {
  const theme = useTheme();
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (off) return;
    let loop: Animated.CompositeAnimation | null = null;
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled?.()
      .then((reduce) => {
        if (reduce || cancelled) return;
        loop = Animated.loop(
          Animated.sequence([
            Animated.timing(opacity, { toValue: 0.35, duration: 800, useNativeDriver: true }),
            Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }),
          ]),
        );
        loop.start();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      loop?.stop();
    };
  }, [off, opacity]);
  return (
    <Animated.View
      style={[
        styles.dot,
        {
          backgroundColor: off ? theme.colors.textSubtle : (color ?? theme.colors.danger),
          opacity: off ? 1 : opacity,
        },
      ]}
    />
  );
}

export interface RecordingBannerProps {
  /** A recording is running. */
  recording: boolean;
  /** A live transcript is running. */
  transcribing?: boolean;
  mode?: RecordingMode | null;
  /** Capture needs consent here (`useRecording().consentRequired`). */
  consentRequired?: boolean;
  /** Your answer (`useRecording().myConsent`). `declined` shows "listen-only" and a way to change it. */
  myConsent?: ConsentDecision | null;
  /** Shows a Stop button (for whoever may stop it). */
  onStop?: () => void;
  /** After declining: reopen the prompt. */
  onChangeConsent?: () => void;
  /** Disable the buttons (a request is in flight). */
  pending?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * "● Recording · Everyone in the call is told   [Stop]" — a strip across
 * a captured call, for everyone in it (late joiners too). Renders nothing
 * while nothing is captured.
 */
export function RecordingBanner({
  recording,
  transcribing = false,
  mode,
  consentRequired = false,
  myConsent,
  onStop,
  onChangeConsent,
  pending = false,
  style,
}: RecordingBannerProps) {
  const theme = useTheme();
  const label = captureLabel(recording, transcribing, mode);
  if (!label) return null;
  const listenOnly = consentRequired && myConsent === 'declined';
  const meta = listenOnly
    ? 'You declined — you are listen-only'
    : consentRequired
      ? 'Only people who agreed are captured'
      : 'Everyone in the call is told';
  const button = (text: string, onPress: () => void) => (
    <Pressable
      onPress={onPress}
      disabled={pending}
      accessibilityRole="button"
      accessibilityLabel={text === 'Stop' ? 'Stop recording' : 'Change consent'}
      hitSlop={8}
      style={({ pressed }) => [
        styles.bannerBtn,
        { borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
        (pressed || pending) && styles.pressed,
      ]}
    >
      <Text
        style={[styles.bannerBtnText, { color: theme.colors.text, fontFamily: theme.fonts.body }]}
      >
        {text}
      </Text>
    </Pressable>
  );
  return (
    <View
      style={[
        styles.banner,
        { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.danger },
        style,
      ]}
      accessibilityRole="summary"
      accessibilityLabel={`${label}. ${meta}`}
    >
      <RecDot />
      <View style={styles.bannerText}>
        <Text
          style={[styles.bannerTitle, { color: theme.colors.text, fontFamily: theme.fonts.body }]}
          numberOfLines={1}
        >
          {label}
        </Text>
        <Text
          style={[
            styles.bannerMeta,
            { color: theme.colors.textMuted, fontFamily: theme.fonts.body },
          ]}
          numberOfLines={2}
        >
          {meta}
        </Text>
      </View>
      {listenOnly && onChangeConsent ? button('Change', onChangeConsent) : null}
      {recording && onStop ? button('Stop', onStop) : null}
    </View>
  );
}

export interface RecordingIndicatorProps {
  recording: boolean;
  transcribing?: boolean;
  mode?: RecordingMode | null;
  /** Text colour, e.g. white over video. Defaults to the theme's danger colour. */
  color?: string;
  style?: StyleProp<ViewStyle>;
}

/** A small "● REC" pill for a call header or tile. Nothing while nothing is captured. */
export function RecordingIndicator({
  recording,
  transcribing = false,
  mode,
  color,
  style,
}: RecordingIndicatorProps) {
  const theme = useTheme();
  const label = captureLabel(recording, transcribing, mode);
  if (!label) return null;
  return (
    <View
      style={[styles.indicator, style]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
    >
      <RecDot />
      <Text
        style={[
          styles.indicatorText,
          { color: color ?? theme.colors.danger, fontFamily: theme.fonts.body },
        ]}
      >
        {recording ? 'REC' : 'Transcript'}
      </Text>
    </View>
  );
}

export interface ConsentPromptProps {
  /** A recording is running. */
  recording: boolean;
  /** A live transcript is running. */
  transcribing?: boolean;
  mode?: RecordingMode | null;
  /** Who started it, if known. Never pass a raw id. */
  startedByName?: string | null;
  /** Answer (e.g. `useRecording().consent`). A `false` result keeps the prompt open with an error. */
  onAnswer: (decision: ConsentDecision) => Promise<boolean | void> | boolean | void;
  /**
   * Called once an accept went through: publishing is allowed again.
   * With the native call core, re-enable the microphone and camera here;
   * the SDK's `CallRoom` does it by itself.
   */
  onAccepted?: () => void;
  /** Called after a decline went through (e.g. close the prompt). */
  onDeclined?: () => void;
  pending?: boolean;
  error?: string | null;
  /** Cover the parent with a scrim (absolute fill). Defaults to true; false renders the card only. */
  overlay?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Asks someone in a captured call for consent — shown to anyone who
 * hasn't accepted, late joiners included, when the room requires it.
 * Until they agree their microphone and camera stay off; they still hear
 * and see everyone. Declining keeps them listen-only.
 */
export function ConsentPrompt({
  recording,
  transcribing = false,
  mode,
  startedByName,
  onAnswer,
  onAccepted,
  onDeclined,
  pending = false,
  error,
  overlay = true,
  style,
}: ConsentPromptProps) {
  const theme = useTheme();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const what =
    recording && transcribing
      ? 'recorded and transcribed'
      : recording
        ? mode === 'audio'
          ? 'recorded (audio)'
          : 'recorded'
        : 'transcribed';
  const title = `This call is being ${what}`;

  useEffect(() => {
    AccessibilityInfo.announceForAccessibility?.(title);
  }, [title]);

  const answer = async (decision: ConsentDecision) => {
    setBusy(true);
    setFailed(false);
    try {
      const ok = await onAnswer(decision);
      if (ok === false) {
        setFailed(true);
        return;
      }
      if (decision === 'accepted') onAccepted?.();
      else onDeclined?.();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  const disabled = busy || pending;
  const shownError = error ?? (failed ? 'That didn’t go through. Try again.' : null);

  const card = (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
        !overlay && style,
      ]}
      accessibilityViewIsModal={overlay}
    >
      <View style={styles.cardHead}>
        <RecDot />
        <Text
          style={[styles.cardTitle, { color: theme.colors.text, fontFamily: theme.fonts.body }]}
          accessibilityRole="header"
        >
          {title}
        </Text>
      </View>
      <Text
        style={[styles.cardBody, { color: theme.colors.textMuted, fontFamily: theme.fonts.body }]}
      >
        {startedByName ? `${startedByName} started it. ` : ''}
        Your microphone and camera stay off until you agree. You can still hear and see everyone.
      </Text>
      <View style={styles.cardActions}>
        <Pressable
          onPress={() => void answer('declined')}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel="Stay listen-only"
          style={({ pressed }) => [
            styles.cardBtn,
            { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border },
            (pressed || disabled) && styles.pressed,
          ]}
        >
          <Text
            style={[styles.cardBtnText, { color: theme.colors.text, fontFamily: theme.fonts.body }]}
          >
            Stay listen-only
          </Text>
        </Pressable>
        <Pressable
          onPress={() => void answer('accepted')}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel="Agree to be recorded"
          style={({ pressed }) => [
            styles.cardBtn,
            { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
            (pressed || disabled) && styles.pressed,
          ]}
        >
          <Text
            style={[
              styles.cardBtnText,
              { color: theme.colors.accentText, fontFamily: theme.fonts.body },
            ]}
          >
            Agree
          </Text>
        </Pressable>
      </View>
      {shownError ? (
        <Text
          style={[styles.cardError, { color: theme.colors.danger, fontFamily: theme.fonts.body }]}
          accessibilityLiveRegion="assertive"
        >
          {shownError}
        </Text>
      ) : null}
    </View>
  );
  if (!overlay) return card;
  return (
    <View style={[styles.scrim, { backgroundColor: theme.colors.overlay }, style]}>{card}</View>
  );
}

export interface RecordingNoticeRowProps {
  /** The recording notice message. Rows that aren't one render nothing. */
  msg: Pick<Message, 'type' | 'body' | 'inserted_at'> & { deleted_at?: string | null };
  /** Current user's id — "by you". */
  meId: string | null;
  /** A poolse user id → display name. Unknown: the name is left out. */
  nameFor?: (userId: Uuid) => string | null | undefined;
}

/**
 * "● Recording started · by Elena · 10:04" — the chat line the server
 * posts when a recording starts or stops. `<MessageRow>` renders it.
 */
export function RecordingNoticeRow({ msg, meId, nameFor }: RecordingNoticeRowProps) {
  const theme = useTheme();
  const display = recordingNoticeDisplayFor(msg, meId, nameFor);
  if (!display) return null;
  const time = formatTime(msg.inserted_at);
  const label = [display.title, display.detail, time].filter(Boolean).join(', ');
  const metaStyle = [styles.meta, { color: theme.colors.textSubtle, fontFamily: theme.fonts.body }];
  return (
    <View style={styles.noticeWrap} accessible accessibilityLabel={label}>
      <View
        style={[
          styles.chip,
          { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border },
        ]}
      >
        <RecDot off={display.event === 'stopped'} />
        <Text
          style={[
            styles.chipTitle,
            { color: theme.colors.textMuted, fontFamily: theme.fonts.body },
          ]}
          numberOfLines={1}
        >
          {display.title}
        </Text>
        {display.detail ? (
          <Text style={metaStyle} numberOfLines={1}>
            · {display.detail}
          </Text>
        ) : null}
        {time ? <Text style={metaStyle}>· {time}</Text> : null}
      </View>
    </View>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

const styles = StyleSheet.create({
  dot: { width: 8, height: 8, borderRadius: 4 },
  pressed: { opacity: 0.6 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  bannerText: { flex: 1, minWidth: 0 },
  bannerTitle: { fontSize: 13, fontWeight: '600' },
  bannerMeta: { fontSize: 12, fontWeight: '500' },
  bannerBtn: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  bannerBtnText: { fontSize: 12, fontWeight: '600' },
  indicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  indicatorText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4 },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    padding: 18,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardTitle: { flex: 1, fontSize: 16, fontWeight: '700' },
  cardBody: { marginTop: 8, marginBottom: 16, fontSize: 14, lineHeight: 20 },
  cardActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8 },
  cardBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  cardBtnText: { fontSize: 14, fontWeight: '600' },
  cardError: { marginTop: 10, fontSize: 13, fontWeight: '500' },
  noticeWrap: {
    alignItems: 'center',
    alignSelf: 'stretch',
    marginVertical: 6,
    paddingHorizontal: 16,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '100%',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipTitle: { fontSize: 11, fontWeight: '600', letterSpacing: 0.3, flexShrink: 1 },
  meta: { fontSize: 11, fontWeight: '500', letterSpacing: 0.3, flexShrink: 1 },
});
