// After the call: the summary card (RT6, RT7), asking your meetings
// (RT8), clips (RT9) and the recording player (RT13). Same props as
// @poolse/react-ui; media plays through your adapter (`renderMedia`,
// see messageExtras.tsx and the README).
//
//     <SummaryCard summary={parseCallSummary(msg)!} onOpenMoment={seek} />
//     <AskMeetings onOpenMoment={openCall} />
//     <ClipPlayer attachment={att} renderMedia={expoVideo} />
//     <RecordingPlayer recording={rec} renderMedia={expoVideo} />

import type { Attachment, CallSummary, Message, Recording } from '@poolse/sdk';
import {
  ASK_QUESTION_MAX,
  PLAYBACK_RATES,
  activeSegmentIndex,
  chapterIndexAt,
  chaptersOf,
  clipOf,
  formatClock,
  formatDue,
  formatTimeRange,
  meetingsErrorMessage,
  parseCallSummary,
  silencesOf,
  skipSilenceTarget,
  speakerName,
  summaryStyleLabel,
  transcriptOffsetMs,
  useAskMeetings,
  useAttachmentUrl,
  useMembers,
  useRecordingUrl,
  useTranscript,
  useUser,
  type PlaybackRate,
} from '@poolse/react';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { AgentBadge } from './AgentBadge.js';
import { useMessageExtras, type RenderMedia } from './messageExtras.js';
import { PoolseIcon } from './primitives/PoolseIcon.js';
import { useTheme } from './theme/PoolseTheme.js';
import { UserName } from './UserName.js';

// ── Summary card ─────────────────────────────────────────────────────────

export interface SummaryCardProps {
  summary: CallSummary;
  /** A moment was pressed. Defaults to the provider's `onOpenMoment`; without one, moments are plain text. */
  onOpenMoment?: (callId: string, startMs: number) => void;
  /** A poolse user id → name, for assignees. Defaults to the provider's, then the conversation's members. */
  nameForUserId?: (userId: string) => string | null | undefined;
  style?: StyleProp<ViewStyle>;
}

/** A call's summary: decisions, action items, open questions and seekable key moments. */
export function SummaryCard({ summary, onOpenMoment, nameForUserId, style }: SummaryCardProps) {
  const theme = useTheme();
  const extras = useMessageExtras();
  const open = onOpenMoment ?? extras.onOpenMoment;
  const nameFor = nameForUserId ?? extras.nameForUserId;
  const needsMembers =
    !extras.externalIdForUserId && summary.actionItems.some((a) => a.assigneeUserId);
  const { members } = useMembers(needsMembers ? (summary.conversationId ?? '') : '');
  const extFor = (userId: string): string | null =>
    extras.externalIdForUserId?.(userId) ??
    members.find((m) => m.user_id === userId)?.external_id ??
    null;
  const text = { color: theme.colors.text, fontFamily: theme.fonts.body };
  const subtle = { color: theme.colors.textSubtle, fontFamily: theme.fonts.body };
  const style_ = summaryStyleLabel(summary.style);
  const empty =
    !summary.overview &&
    summary.decisions.length === 0 &&
    summary.actionItems.length === 0 &&
    summary.openQuestions.length === 0 &&
    summary.moments.length === 0;

  const section = (title: string, children: ReactNode) => (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, subtle]} accessibilityRole="header">
        {title.toUpperCase()}
      </Text>
      {children}
    </View>
  );
  const bullet = (t: string, i: number) => (
    <View key={i} style={styles.bulletRow}>
      <Text style={[styles.bullet, subtle]}>•</Text>
      <Text style={[styles.body, text]}>{t}</Text>
    </View>
  );

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderRadius: theme.radii.lg,
        },
        style,
      ]}
      accessibilityLabel={style_ === 'Call summary' ? 'Call summary' : `Call summary, ${style_}`}
    >
      <View style={styles.head}>
        <PoolseIcon name="pulse" size={16} color={theme.colors.accentStrong} label={null} />
        <Text style={[styles.title, text]}>Call summary</Text>
        {style_ !== 'Call summary' ? (
          <View style={[styles.pill, { backgroundColor: theme.colors.surfaceAlt }]}>
            <Text style={[styles.pillText, subtle]}>{style_}</Text>
          </View>
        ) : null}
      </View>
      {summary.overview ? <Text style={[styles.overview, subtle]}>{summary.overview}</Text> : null}
      {empty ? (
        <Text style={[styles.overview, subtle]}>Nothing to report from this call.</Text>
      ) : null}
      {summary.decisions.length > 0 ? section('Decisions', summary.decisions.map(bullet)) : null}
      {summary.actionItems.length > 0
        ? section(
            'Action items',
            summary.actionItems.map((a, i) => {
              const due = formatDue(a.due);
              const resolved = a.assigneeUserId ? (nameFor?.(a.assigneeUserId) ?? null) : null;
              const ext = a.assigneeUserId && !resolved ? extFor(a.assigneeUserId) : null;
              return (
                <View key={i} style={styles.task}>
                  <View style={[styles.box, { borderColor: theme.colors.textSubtle }]} />
                  <View style={styles.taskBody}>
                    <Text style={[styles.body, text]}>{a.text}</Text>
                    {resolved || ext || due ? (
                      <View style={styles.taskMeta}>
                        {resolved ? (
                          <Text style={[styles.meta, subtle]} numberOfLines={1}>
                            {resolved}
                          </Text>
                        ) : ext ? (
                          <UserName externalId={ext} />
                        ) : null}
                        {due ? (
                          <Text style={[styles.meta, subtle]}>
                            {resolved || ext ? '· ' : ''}
                            {due}
                          </Text>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                </View>
              );
            }),
          )
        : null}
      {summary.openQuestions.length > 0
        ? section('Open questions', summary.openQuestions.map(bullet))
        : null}
      {summary.moments.length > 0
        ? section(
            'Key moments',
            summary.moments.map((m, i) => (
              <MomentRow
                key={i}
                startMs={m.startMs}
                label={m.label}
                {...(open ? { onPress: () => open(summary.callId, m.startMs) } : {})}
              />
            )),
          )
        : null}
    </View>
  );
}

function MomentRow({
  startMs,
  label,
  onPress,
}: {
  startMs: number;
  label: string;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const row = (
    <View style={styles.moment}>
      <Text
        style={[styles.time, { color: theme.colors.accentStrong, fontFamily: theme.fonts.mono }]}
      >
        {formatClock(startMs)}
      </Text>
      <Text
        style={[styles.body, { color: theme.colors.text, fontFamily: theme.fonts.body }]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
  return onPress ? (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Play from ${formatClock(startMs)}: ${label}`}
      style={({ pressed }) => [pressed && { backgroundColor: theme.colors.surfaceAlt }]}
    >
      {row}
    </Pressable>
  ) : (
    row
  );
}

export interface SummaryMessageRowProps {
  msg: Message;
  meId: string | null;
  nameForUserId?: (userId: string) => string | null | undefined;
}

/** A `kind: "call_summary"` message in a list: who posted it, then the card. */
export function SummaryMessageRow({ msg, nameForUserId }: SummaryMessageRowProps) {
  const theme = useTheme();
  const summary = useMemo(() => parseCallSummary(msg), [msg]);
  const { profile, agent } = useUser(msg.sender_external_id);
  if (!summary) return null;
  const isAgent = !!agent || msg.is_agent === true;
  return (
    <View style={styles.cardRow}>
      {msg.sender_external_id ? (
        <View style={styles.sender}>
          <Text
            style={[
              styles.senderName,
              { color: theme.colors.textMuted, fontFamily: theme.fonts.body },
            ]}
            numberOfLines={1}
          >
            {profile?.displayName ?? msg.agent?.name ?? 'Note-taker'}
          </Text>
          {isAgent ? <AgentBadge size="xs" /> : null}
        </View>
      ) : null}
      <SummaryCard summary={summary} {...(nameForUserId ? { nameForUserId } : {})} />
    </View>
  );
}

// ── Ask your meetings ────────────────────────────────────────────────────

export interface AskMeetingsProps {
  callId?: string | null;
  onOpenMoment?: (callId: string, startMs: number) => void;
  placeholder?: string;
  style?: StyleProp<ViewStyle>;
}

/** A question box over your meetings, answered with links to the moments. */
export function AskMeetings({ callId, onOpenMoment, placeholder, style }: AskMeetingsProps) {
  const theme = useTheme();
  const extras = useMessageExtras();
  const open = onOpenMoment ?? extras.onOpenMoment;
  const { answer, question, loading, error, ask, reset } = useAskMeetings({
    callId: callId ?? null,
  });
  const [draft, setDraft] = useState('');
  const text = { color: theme.colors.text, fontFamily: theme.fonts.body };
  const subtle = { color: theme.colors.textSubtle, fontFamily: theme.fonts.body };
  const submit = () => {
    if (draft.trim()) void ask(draft);
  };

  return (
    <View style={style}>
      <View
        style={[
          styles.askForm,
          { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border },
        ]}
      >
        <PoolseIcon name="search" size={16} color={theme.colors.textSubtle} label={null} />
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={submit}
          returnKeyType="search"
          maxLength={ASK_QUESTION_MAX}
          placeholder={placeholder ?? (callId ? 'Ask about this meeting' : 'Ask your meetings')}
          placeholderTextColor={theme.colors.textSubtle}
          accessibilityLabel={callId ? 'Ask about this meeting' : 'Ask your meetings'}
          style={[styles.askInput, text]}
        />
        <Pressable
          onPress={submit}
          disabled={loading || !draft.trim()}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.askBtn,
            { backgroundColor: theme.colors.accent },
            (pressed || loading || !draft.trim()) && styles.pressed,
          ]}
        >
          <Text style={[styles.askBtnText, { color: theme.colors.accentText }]}>
            {loading ? 'Asking…' : 'Ask'}
          </Text>
        </Pressable>
      </View>
      <View accessibilityLiveRegion="polite" style={styles.askResult}>
        {loading ? (
          <Text style={[styles.meta, subtle]}>Looking through your meetings…</Text>
        ) : error ? (
          <Text style={[styles.meta, { color: theme.colors.danger }]} accessibilityRole="alert">
            {meetingsErrorMessage(error)}
          </Text>
        ) : answer ? (
          <>
            {question ? <Text style={[styles.meta, subtle]}>{question}</Text> : null}
            <Text style={[styles.answer, text]}>
              {answer.answer || 'Nothing in your meetings answers that.'}
            </Text>
            {answer.links.map((l, i) => (
              <MomentRow
                key={`${l.callId}-${l.startMs}-${i}`}
                startMs={l.startMs}
                label={l.snippet || 'In the meeting'}
                {...(open ? { onPress: () => open(l.callId, l.startMs) } : {})}
              />
            ))}
            <Pressable
              onPress={() => {
                reset();
                setDraft('');
              }}
              accessibilityRole="button"
              hitSlop={8}
            >
              <Text style={[styles.link, { color: theme.colors.link }]}>Clear</Text>
            </Pressable>
          </>
        ) : null}
      </View>
    </View>
  );
}

// ── Media controls shared by the players ────────────────────────────────

function useMediaState() {
  const [paused, setPaused] = useState(true);
  const [posMs, setPosMs] = useState(0);
  const [durMs, setDurMs] = useState<number | null>(null);
  const [seek, setSeek] = useState<{ ms: number; nonce: number } | null>(null);
  const seekTo = (ms: number) => {
    const target = Math.max(0, ms);
    setPosMs(target);
    setSeek((s) => ({ ms: target, nonce: (s?.nonce ?? 0) + 1 }));
  };
  return { paused, setPaused, posMs, setPosMs, durMs, setDurMs, seek, seekTo };
}

function PlayButton({ paused, onPress }: { paused: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={paused ? 'Play' : 'Pause'}
      style={({ pressed }) => [
        styles.play,
        { backgroundColor: theme.colors.accent },
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.playText, { color: theme.colors.accentText }]}>
        {paused ? 'Play' : 'Pause'}
      </Text>
    </Pressable>
  );
}

// ── Clips ────────────────────────────────────────────────────────────────

export interface ClipPlayerProps {
  /** A clip attachment (it carries `clip`) — plays its own file. */
  attachment?: Attachment | null;
  /** Or a range of a recording: plays from `startMs` and stops at `endMs`. */
  clip?: { recordingId: string; startMs: number; endMs: number } | null;
  onOpenRecording?: (recordingId: string, startMs: number) => void;
  /** The media adapter. Defaults to the provider's `renderMedia`. */
  renderMedia?: RenderMedia;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** A short piece of a call's recording, shared in chat. */
export function ClipPlayer({
  attachment,
  clip: rangeClip,
  onOpenRecording,
  renderMedia,
  compact = false,
  style,
}: ClipPlayerProps) {
  const theme = useTheme();
  const extras = useMessageExtras();
  const render = renderMedia ?? extras.renderMedia;
  const info = (attachment ? clipOf(attachment) : null) ?? rangeClip ?? null;
  const fileUrl = useAttachmentUrl(render && attachment ? attachment.id : null);
  const recUrl = useRecordingUrl(render && !attachment && rangeClip ? rangeClip.recordingId : null);
  const url = attachment ? fileUrl.url : recUrl.url;
  const error = attachment ? fileUrl.error : recUrl.error;
  const ranged = !attachment && !!rangeClip;
  const m = useMediaState();
  const subtle = { color: theme.colors.textSubtle, fontFamily: theme.fonts.body };
  const label = info ? formatTimeRange(info.startMs, info.endMs) : null;
  const isVideo = !!attachment?.content_type.startsWith('video/');

  return (
    <View
      style={[
        styles.clip,
        compact && styles.clipCompact,
        { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radii.md },
        style,
      ]}
      accessibilityLabel={label ? `Clip, ${label}` : 'Clip'}
    >
      <View style={styles.clipHead}>
        <PoolseIcon name="video" size={14} color={theme.colors.textMuted} label={null} />
        <Text style={[styles.clipTitle, { color: theme.colors.textMuted }]}>Clip</Text>
        {label ? <Text style={[styles.meta, subtle]}>{label}</Text> : null}
        {info ? (
          <Text style={[styles.meta, subtle, styles.push]}>
            {formatClock(info.endMs - info.startMs)}
          </Text>
        ) : null}
      </View>
      {render ? (
        error ? (
          <Text style={[styles.meta, { color: theme.colors.danger }]}>
            The clip couldn’t be loaded.
          </Text>
        ) : url ? (
          <>
            {render({
              uri: url,
              contentType: attachment?.content_type ?? null,
              kind: isVideo ? 'video' : 'audio',
              paused: m.paused,
              rate: 1,
              seek: m.seek,
              onProgress: (ms) => {
                m.setPosMs(ms);
                if (ranged && rangeClip && ms >= rangeClip.endMs) m.setPaused(true);
              },
              onLoad: (d) => {
                m.setDurMs(d);
                if (ranged && rangeClip) m.seekTo(rangeClip.startMs);
              },
              onEnd: () => m.setPaused(true),
              onError: () => {
                if (!attachment) recUrl.refresh();
              },
              ...(isVideo ? { style: styles.clipVideo } : {}),
            })}
            <View style={styles.controls}>
              <PlayButton paused={m.paused} onPress={() => m.setPaused((p) => !p)} />
              <Text style={[styles.meta, subtle]}>
                {formatClock(ranged && rangeClip ? m.posMs - rangeClip.startMs : m.posMs)}
              </Text>
            </View>
          </>
        ) : (
          <Text style={[styles.meta, subtle]}>Loading…</Text>
        )
      ) : null}
      {info && onOpenRecording ? (
        <Pressable
          onPress={() => onOpenRecording(info.recordingId, info.startMs)}
          accessibilityRole="button"
          hitSlop={8}
        >
          <Text style={[styles.link, { color: theme.colors.link }]}>Open the recording</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ── Recording player ─────────────────────────────────────────────────────

export interface RecordingPlayerProps {
  recording: Recording;
  showTranscript?: boolean;
  /** Start here (ms since the transcript started); a new value seeks. */
  startMs?: number | null;
  defaultSkipSilence?: boolean;
  /** The media adapter. Defaults to the provider's `renderMedia`. */
  renderMedia?: RenderMedia;
  style?: StyleProp<ViewStyle>;
}

export interface RecordingPlayerHandle {
  /** Seek to transcript time `ms` and play. */
  seek: (ms: number) => void;
  play: () => void;
  pause: () => void;
}

/**
 * A finished recording: 1×–2× speed, skip silence (when the recording
 * lists its silences), chapters, and the transcript scrolling along —
 * tap a line to play from there.
 */
export const RecordingPlayer = forwardRef<RecordingPlayerHandle, RecordingPlayerProps>(
  function RecordingPlayer(
    { recording, showTranscript = true, startMs, defaultSkipSilence = false, renderMedia, style },
    ref,
  ) {
    const theme = useTheme();
    const extras = useMessageExtras();
    const render = renderMedia ?? extras.renderMedia;
    const ready = recording.status === 'ready';
    const { url, contentType, error, refresh } = useRecordingUrl(
      ready && render ? recording.id : null,
    );
    const { transcript } = useTranscript(showTranscript && ready ? recording.call_id : null);
    const offset = transcriptOffsetMs(recording.started_at, transcript?.started_at);
    const chapters = useMemo(() => chaptersOf(recording), [recording]);
    const silences = useMemo(() => silencesOf(recording), [recording]);
    const segments = useMemo(() => transcript?.segments ?? [], [transcript]);
    const m = useMediaState();
    const [rate, setRate] = useState<PlaybackRate>(1);
    const [skip, setSkip] = useState(defaultSkipSilence);
    const renewals = useRef<number[]>([]);
    const resumeAt = useRef<number | null>(null);

    useImperativeHandle(ref, () => ({
      seek: (ms) => {
        m.seekTo(ms - offset);
        m.setPaused(false);
      },
      play: () => m.setPaused(false),
      pause: () => m.setPaused(true),
    }));

    useEffect(() => {
      if (typeof startMs === 'number') m.seekTo(startMs - offset);
      // Only a new start point seeks.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [startMs]);

    const active = activeSegmentIndex(segments, m.posMs + offset);
    const scroller = useRef<ScrollView>(null);
    const lineY = useRef(new Map<number, number>());
    const userScrolledAt = useRef(0);
    useEffect(() => {
      if (active < 0 || Date.now() - userScrolledAt.current < 4000) return;
      const y = lineY.current.get(active);
      if (y !== undefined) scroller.current?.scrollTo({ y: Math.max(0, y - 60), animated: true });
    }, [active]);

    const chapterIdx = chapterIndexAt(chapters, m.posMs);
    const text = { color: theme.colors.text, fontFamily: theme.fonts.body };
    const subtle = { color: theme.colors.textSubtle, fontFamily: theme.fonts.body };

    return (
      <View style={[styles.player, style]} accessibilityLabel="Recording">
        {!ready ? (
          <Text style={[styles.note, subtle]}>
            {recording.status === 'failed'
              ? 'This recording couldn’t be saved.'
              : 'The recording is still being saved.'}
          </Text>
        ) : !render ? null : error && !url ? (
          <Text style={[styles.note, { color: theme.colors.danger }]} accessibilityRole="alert">
            {meetingsErrorMessage(error)}
          </Text>
        ) : !url ? (
          <Text style={[styles.note, subtle]}>Loading the recording…</Text>
        ) : (
          <>
            {render({
              uri: url,
              contentType,
              kind: recording.mode === 'audio' ? 'audio' : 'video',
              paused: m.paused,
              rate,
              seek: m.seek,
              onProgress: (ms) => {
                if (skip && !m.paused) {
                  const to = skipSilenceTarget(silences, ms);
                  if (to !== null) {
                    m.seekTo(to);
                    return;
                  }
                }
                m.setPosMs(ms);
              },
              onLoad: (d) => {
                m.setDurMs(d);
                if (resumeAt.current !== null) {
                  m.seekTo(resumeAt.current);
                  resumeAt.current = null;
                }
              },
              onEnd: () => m.setPaused(true),
              onError: () => {
                // Most likely the five-minute link ran out: renew it (at
                // most three times a minute) and go on from the same spot.
                const now = Date.now();
                renewals.current = renewals.current.filter((t) => now - t < 60_000);
                if (renewals.current.length >= 3) return;
                renewals.current.push(now);
                resumeAt.current = m.posMs;
                refresh();
              },
              ...(recording.mode === 'audio' ? {} : { style: styles.video }),
            })}
            <View style={styles.controls}>
              <PlayButton paused={m.paused} onPress={() => m.setPaused((p) => !p)} />
              <Pressable
                onPress={() => m.seekTo(m.posMs - 15_000)}
                accessibilityRole="button"
                accessibilityLabel="Back 15 seconds"
                hitSlop={8}
              >
                <Text style={[styles.skipText, text]}>−15s</Text>
              </Pressable>
              <Pressable
                onPress={() => m.seekTo(m.posMs + 15_000)}
                accessibilityRole="button"
                accessibilityLabel="Forward 15 seconds"
                hitSlop={8}
              >
                <Text style={[styles.skipText, text]}>+15s</Text>
              </Pressable>
              <Text style={[styles.meta, subtle, styles.push]}>
                {formatClock(m.posMs)}
                {m.durMs ? ` / ${formatClock(m.durMs)}` : ''}
              </Text>
            </View>
          </>
        )}

        {ready && render ? (
          <View style={styles.controls}>
            <View
              style={[styles.rates, { backgroundColor: theme.colors.surfaceAlt }]}
              accessibilityLabel="Playback speed"
            >
              {PLAYBACK_RATES.map((r) => (
                <Pressable
                  key={r}
                  onPress={() => setRate(r)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: rate === r }}
                  accessibilityLabel={`${r}× speed`}
                  style={[styles.rate, rate === r && { backgroundColor: theme.colors.surface }]}
                >
                  <Text style={[styles.rateText, rate === r ? text : subtle]}>{r}×</Text>
                </Pressable>
              ))}
            </View>
            {silences.length > 0 ? (
              <View style={[styles.skipRow, styles.push]}>
                <Text style={[styles.meta, subtle]}>Skip silence</Text>
                <Switch value={skip} onValueChange={setSkip} accessibilityLabel="Skip silence" />
              </View>
            ) : null}
          </View>
        ) : null}

        {chapters.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chapters}
          >
            {chapters.map((c, i) => (
              <Pressable
                key={`${c.startMs}-${i}`}
                onPress={() => {
                  m.seekTo(c.startMs);
                  m.setPaused(false);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: i === chapterIdx }}
                accessibilityLabel={`Chapter ${c.title}, ${formatClock(c.startMs)}`}
                style={[
                  styles.chapter,
                  {
                    borderColor: i === chapterIdx ? theme.colors.accent : theme.colors.border,
                    backgroundColor:
                      i === chapterIdx ? theme.colors.accentSoft : theme.colors.surface,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.time,
                    { color: theme.colors.accentStrong, fontFamily: theme.fonts.mono },
                  ]}
                >
                  {formatClock(c.startMs)}
                </Text>
                <Text style={[styles.chapterTitle, text]} numberOfLines={1}>
                  {c.title}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        {showTranscript && segments.length > 0 ? (
          <ScrollView
            ref={scroller}
            style={[styles.transcript, { borderColor: theme.colors.border }]}
            onScrollBeginDrag={() => {
              userScrolledAt.current = Date.now();
            }}
            accessibilityLabel="Transcript"
          >
            {segments.map((s, i) => {
              const newSpeaker = i === 0 || segments[i - 1]!.speaker !== s.speaker;
              const on = i === active;
              return (
                <Pressable
                  key={`${s.start_ms}-${i}`}
                  onLayout={(e) => lineY.current.set(i, e.nativeEvent.layout.y)}
                  onPress={() => {
                    m.seekTo(s.start_ms - offset);
                    m.setPaused(false);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  style={[styles.line, on && { backgroundColor: theme.colors.accentSoft }]}
                >
                  {newSpeaker ? (
                    <Text style={[styles.speaker, text]} numberOfLines={1}>
                      {speakerName(s)}
                    </Text>
                  ) : null}
                  <View style={styles.lineRow}>
                    <Text style={[styles.lineTime, subtle]}>
                      {formatClock(Math.max(0, s.start_ms - offset))}
                    </Text>
                    <Text style={[styles.body, on ? text : { color: theme.colors.textMuted }]}>
                      {s.text}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}
      </View>
    );
  },
);

const styles = StyleSheet.create({
  cardRow: { paddingHorizontal: 12, paddingVertical: 6, gap: 4 },
  sender: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  senderName: { flexShrink: 1, fontSize: 12, fontWeight: '700' },
  card: { borderWidth: 1, padding: 12, maxWidth: 520, width: '100%' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 14, fontWeight: '700' },
  pill: { paddingHorizontal: 8, paddingVertical: 1, borderRadius: 999 },
  pillText: { fontSize: 11, fontWeight: '600' },
  overview: { marginTop: 8, fontSize: 13, lineHeight: 19 },
  section: { marginTop: 10, gap: 4 },
  sectionTitle: { fontSize: 10, fontWeight: '700', letterSpacing: 0.4 },
  bulletRow: { flexDirection: 'row', gap: 6 },
  bullet: { fontSize: 13, lineHeight: 19 },
  body: { flex: 1, fontSize: 13, lineHeight: 19 },
  task: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  box: { width: 14, height: 14, marginTop: 2, borderWidth: 1.5, borderRadius: 4 },
  taskBody: { flex: 1, minWidth: 0 },
  taskMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, minWidth: 0 },
  meta: { fontSize: 12 },
  moment: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 32,
    paddingHorizontal: 4,
  },
  time: { minWidth: 44, fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
  link: { marginTop: 6, fontSize: 13, fontWeight: '600' },
  pressed: { opacity: 0.6 },
  askForm: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 10,
    paddingRight: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
  },
  askInput: { flex: 1, minHeight: 44, fontSize: 15 },
  askBtn: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 999 },
  askBtnText: { fontSize: 14, fontWeight: '600' },
  askResult: { marginTop: 8, gap: 4 },
  answer: { fontSize: 15, lineHeight: 21, marginVertical: 4 },
  clip: { padding: 8, marginVertical: 4, gap: 6, width: 320, maxWidth: '100%' },
  clipCompact: { width: '100%', maxWidth: 300 },
  clipHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  clipTitle: { fontSize: 12, fontWeight: '600' },
  clipVideo: { width: '100%', aspectRatio: 16 / 9, borderRadius: 8 },
  push: { marginLeft: 'auto' },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  play: {
    minHeight: 36,
    minWidth: 64,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 999,
  },
  playText: { fontSize: 14, fontWeight: '700' },
  skipText: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  player: { gap: 8 },
  video: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000' },
  note: { padding: 16, textAlign: 'center', fontSize: 13 },
  rates: { flexDirection: 'row', padding: 2, borderRadius: 999 },
  rate: {
    minWidth: 48,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
  },
  rateText: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  skipRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chapters: { gap: 6, paddingVertical: 2 },
  chapter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: 220,
    minHeight: 32,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderRadius: 999,
  },
  chapterTitle: { flexShrink: 1, fontSize: 12 },
  transcript: { maxHeight: 320, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12 },
  line: { paddingHorizontal: 10, paddingVertical: 6 },
  speaker: { fontSize: 12, fontWeight: '700', marginBottom: 2 },
  lineRow: { flexDirection: 'row', gap: 8 },
  lineTime: { width: 48, fontSize: 12, fontVariant: ['tabular-nums'] },
});
