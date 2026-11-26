// After the call: the summary card (RT6, RT7), asking your meetings
// (RT8), clips (RT9) and the recording player (RT13). Same props as
// @poolse/react-ui; media plays through your adapter (`renderMedia`,
// see messageExtras.tsx and the README).
//
//     <SummaryCard summary={parseCallSummary(msg)!} onOpenMoment={open} />
//     <AskMeetings onOpenMoment={open} />
//     <ClipPlayer attachment={att} renderMedia={expoVideo} />
//     <RecordingPlayer recordingId={id} renderMedia={expoVideo} />

import type { Attachment, CallSummary, MeetingMoment, Message, SummaryItem } from '@poolse/sdk';
import {
  ASK_QUESTION_MAX,
  PLAYBACK_RATES,
  activeSegmentIndex,
  chapterIndexAt,
  clipOf,
  formatClock,
  formatDue,
  formatTimeRange,
  meetingsErrorMessage,
  momentOf,
  parseCallSummary,
  silencesFromSegments,
  silencesOf,
  skipSilenceTarget,
  speakerName,
  summaryStatusText,
  summaryStyleLabel,
  useAskMeetings,
  useAttachmentUrl,
  useCallSummary,
  useClip,
  useMediaRenewal,
  useMembers,
  useRecordingPlayback,
  useRecordingUrl,
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
  /** A timed line or moment was pressed. Defaults to the provider's; without one, times are plain text. */
  onOpenMoment?: (moment: MeetingMoment) => void;
  /** A poolse user id → name, for assignees. Defaults to the provider's, then the conversation's members. */
  nameForUserId?: (userId: string) => string | null | undefined;
  /** Fetch the full copy when shortened and follow `summary:ready`. Defaults to true. */
  live?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** A call's summary: overview, decisions, action items, open questions, sections and moments. */
export function SummaryCard({
  summary: initial,
  onOpenMoment,
  nameForUserId,
  live = true,
  style,
}: SummaryCardProps) {
  const theme = useTheme();
  const extras = useMessageExtras();
  const followed = useCallSummary(live ? initial.callId : null, initial);
  const summary = (live ? followed.summary : null) ?? initial;
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
  const styleLabel = summaryStyleLabel(summary.style);
  const status = summaryStatusText(summary);
  const empty =
    !summary.overview &&
    summary.decisions.length === 0 &&
    summary.actionItems.length === 0 &&
    summary.openQuestions.length === 0 &&
    summary.moments.length === 0 &&
    summary.sections.length === 0;

  const time = (item: SummaryItem) =>
    item.startMs === null ? null : (
      <TimeLink
        ms={item.startMs}
        {...(open ? { onPress: () => open(momentOf(summary, item)) } : {})}
      />
    );
  const section = (title: string, children: ReactNode, key?: string) => (
    <View style={styles.section} key={key}>
      <Text style={[styles.sectionTitle, subtle]} accessibilityRole="header">
        {title.toUpperCase()}
      </Text>
      {children}
    </View>
  );
  const bullets = (list: SummaryItem[]) =>
    list.map((d, i) => (
      <View key={i} style={styles.bulletRow}>
        <Text style={[styles.bullet, subtle]}>•</Text>
        <Text style={[styles.body, text]}>{d.text}</Text>
        {time(d)}
      </View>
    ));

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
      accessibilityLabel={styleLabel === 'Meeting' ? 'Call summary' : `Call summary, ${styleLabel}`}
    >
      <View style={styles.head}>
        <PoolseIcon name="pulse" size={16} color={theme.colors.accentStrong} label={null} />
        <Text style={[styles.title, text]}>Call summary</Text>
        {styleLabel !== 'Meeting' ? (
          <View style={[styles.pill, { backgroundColor: theme.colors.surfaceAlt }]}>
            <Text style={[styles.pillText, subtle]}>{styleLabel}</Text>
          </View>
        ) : null}
      </View>
      {status ? (
        <Text style={[styles.overview, subtle]}>{status}</Text>
      ) : (
        <>
          {summary.overview ? (
            <Text style={[styles.overview, subtle]}>{summary.overview}</Text>
          ) : null}
          {empty ? (
            <Text style={[styles.overview, subtle]}>Nothing to report from this call.</Text>
          ) : null}
          {summary.decisions.length > 0 ? section('Decisions', bullets(summary.decisions)) : null}
          {summary.actionItems.length > 0
            ? section(
                'Action items',
                summary.actionItems.map((a, i) => {
                  const due = formatDue(a.dueDate, a.dueText);
                  const resolved = a.assigneeUserId ? (nameFor?.(a.assigneeUserId) ?? null) : null;
                  const ext = a.assigneeUserId && !resolved ? extFor(a.assigneeUserId) : null;
                  const said = !resolved && !ext ? a.assigneeName : null;
                  return (
                    <View key={a.id ?? i} style={styles.task}>
                      <View style={[styles.box, { borderColor: theme.colors.textSubtle }]} />
                      <View style={styles.taskBody}>
                        <Text style={[styles.body, text]}>{a.text}</Text>
                        {resolved || ext || said || due ? (
                          <View style={styles.taskMeta}>
                            {resolved || said ? (
                              <Text style={[styles.meta, subtle]} numberOfLines={1}>
                                {resolved ?? said}
                              </Text>
                            ) : ext ? (
                              <UserName externalId={ext} />
                            ) : null}
                            {due ? (
                              <Text style={[styles.meta, subtle]} numberOfLines={1}>
                                {resolved || ext || said ? '· ' : ''}
                                {due}
                              </Text>
                            ) : null}
                          </View>
                        ) : null}
                      </View>
                      {time(a)}
                    </View>
                  );
                }),
              )
            : null}
          {summary.openQuestions.length > 0
            ? section('Open questions', bullets(summary.openQuestions))
            : null}
          {summary.sections.map((sec, i) => section(sec.title, bullets(sec.items), `s${i}`))}
          {summary.moments.length > 0
            ? section(
                'Key moments',
                summary.moments.map((m, i) => (
                  <MomentRow
                    key={i}
                    startMs={m.startMs}
                    label={m.speakerName ? `${m.title} · ${m.speakerName}` : m.title}
                    {...(open && m.startMs !== null
                      ? { onPress: () => open(momentOf(summary, m)) }
                      : {})}
                  />
                )),
              )
            : null}
          {summary.truncated ? (
            <Text style={[styles.note, subtle]}>
              The meeting was long: this covers its first part.
            </Text>
          ) : null}
        </>
      )}
    </View>
  );
}

function TimeLink({ ms, onPress }: { ms: number; onPress?: () => void }) {
  const theme = useTheme();
  const label = formatClock(ms);
  const t = (
    <Text
      style={[
        styles.itemTime,
        {
          color: onPress ? theme.colors.accentStrong : theme.colors.textSubtle,
          fontFamily: theme.fonts.mono,
        },
      ]}
    >
      {label}
    </Text>
  );
  return onPress ? (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Play from ${label}`}
      hitSlop={8}
    >
      {t}
    </Pressable>
  ) : (
    t
  );
}

function MomentRow({
  startMs,
  label,
  onPress,
}: {
  startMs: number | null;
  label: string;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const at = startMs !== null ? formatClock(startMs) : '–';
  const row = (
    <View style={styles.moment}>
      <Text
        style={[styles.time, { color: theme.colors.accentStrong, fontFamily: theme.fonts.mono }]}
      >
        {at}
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
      accessibilityLabel={`Play from ${at}: ${label}`}
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
  const isAgent = !!agent || msg.sender_is_agent === true;
  const name = profile?.displayName ?? agent?.name ?? null;
  return (
    <View style={styles.cardRow}>
      {name ? (
        <View style={styles.sender}>
          <Text
            style={[
              styles.senderName,
              { color: theme.colors.textMuted, fontFamily: theme.fonts.body },
            ]}
            numberOfLines={1}
          >
            {name}
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
  conversationId?: string | null;
  onOpenMoment?: (moment: MeetingMoment) => void;
  placeholder?: string;
  style?: StyleProp<ViewStyle>;
}

/** A question box over your meetings, answered with links to the moments. */
export function AskMeetings({
  callId,
  conversationId,
  onOpenMoment,
  placeholder,
  style,
}: AskMeetingsProps) {
  const theme = useTheme();
  const extras = useMessageExtras();
  const open = onOpenMoment ?? extras.onOpenMoment;
  const { answer, question, loading, error, ask, reset } = useAskMeetings({
    callId: callId ?? null,
    conversationId: conversationId ?? null,
  });
  const [draft, setDraft] = useState('');
  const text = { color: theme.colors.text, fontFamily: theme.fonts.body };
  const subtle = { color: theme.colors.textSubtle, fontFamily: theme.fonts.body };
  const submit = () => {
    if (draft.trim()) void ask(draft);
  };
  const label = callId ? 'Ask about this meeting' : 'Ask your meetings';

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
          placeholder={placeholder ?? label}
          placeholderTextColor={theme.colors.textSubtle}
          accessibilityLabel={label}
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
              {answer.answer ?? 'Nothing in your meetings answers that.'}
            </Text>
            {answer.citations.map((c, i) => (
              <MomentRow
                key={`${c.callId}-${c.startMs}-${i}`}
                startMs={c.startMs}
                label={[c.speakerName, c.text].filter(Boolean).join(': ') || 'In the meeting'}
                {...(open && (c.startMs !== null || c.recordingMs !== null)
                  ? { onPress: () => open(c) }
                  : {})}
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
  /** A clip shared in chat (an attachment) — plays its own file. */
  attachment?: Attachment | null;
  /** A clip by id — shows "Cutting…" until `clip:ready`. */
  clipId?: string | null;
  /** Or a range of a recording: plays from `startMs` and stops at `endMs`. */
  clip?: { recordingId: string; startMs: number; endMs: number } | null;
  onOpenRecording?: (recordingId: string, startMs: number) => void;
  /** The media adapter. Defaults to the provider's `renderMedia`. */
  renderMedia?: RenderMedia;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** A short piece of a call's recording. */
export function ClipPlayer({
  attachment,
  clipId,
  clip: rangeClip,
  onOpenRecording,
  renderMedia,
  compact = false,
  style,
}: ClipPlayerProps) {
  const theme = useTheme();
  const extras = useMessageExtras();
  const render = renderMedia ?? extras.renderMedia;
  const mode = attachment ? 'file' : clipId ? 'clip' : rangeClip ? 'range' : 'none';
  const fileUrl = useAttachmentUrl(render && mode === 'file' ? attachment!.id : null);
  const cut = useClip(mode === 'clip' ? clipId! : null);
  const recUrl = useRecordingUrl(render && mode === 'range' ? rangeClip!.recordingId : null);
  const info =
    mode === 'file'
      ? clipOf(attachment)
      : mode === 'clip' && cut.clip
        ? { recordingId: cut.clip.recordingId, startMs: cut.clip.startMs, endMs: cut.clip.endMs }
        : (rangeClip ?? null);
  const url = mode === 'file' ? fileUrl.url : mode === 'clip' ? cut.url : recUrl.url;
  const error = mode === 'file' ? fileUrl.error : mode === 'clip' ? cut.error : recUrl.error;
  const contentType =
    mode === 'file' ? attachment!.content_type : mode === 'clip' ? cut.clip?.contentType : null;
  const isVideo = !!contentType?.startsWith('video/');
  const ranged = mode === 'range';
  const status = mode === 'clip' ? cut.clip?.status : null;
  // A media error renews the link (they expire), at most three times a
  // minute; after that the clip can't play and says so.
  const renewal = useMediaRenewal(
    () => {
      if (mode === 'range') recUrl.refresh();
      if (mode === 'clip') cut.refresh();
    },
    `${mode}:${attachment?.id ?? clipId ?? rangeClip?.recordingId ?? ''}`,
    mode === 'file' ? { max: 0 } : undefined,
  );
  const m = useMediaState();
  const subtle = { color: theme.colors.textSubtle, fontFamily: theme.fonts.body };
  const label = info ? formatTimeRange(info.startMs, info.endMs) : null;

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
        <Text style={[styles.clipTitle, { color: theme.colors.textMuted }]} numberOfLines={1}>
          {(mode === 'clip' ? cut.clip?.title : null) ?? 'Clip'}
        </Text>
        {label ? <Text style={[styles.meta, subtle]}>{label}</Text> : null}
        {info ? (
          <Text style={[styles.meta, subtle, styles.push]}>
            {formatClock(info.endMs - info.startMs)}
          </Text>
        ) : null}
      </View>
      {status === 'queued' || status === 'cutting' ? (
        <Text style={[styles.meta, subtle]}>Cutting the clip…</Text>
      ) : status === 'failed' || status === 'deleted' ? (
        <Text style={[styles.meta, { color: theme.colors.danger }]}>
          {status === 'deleted' ? 'This clip was deleted.' : 'The clip couldn’t be cut.'}
        </Text>
      ) : render ? (
        error ? (
          <Text style={[styles.meta, { color: theme.colors.danger }]}>
            {meetingsErrorMessage(error)}
          </Text>
        ) : renewal.exhausted ? (
          <Text style={[styles.meta, { color: theme.colors.danger }]} accessibilityRole="alert">
            The clip couldn’t be played.
          </Text>
        ) : url ? (
          <>
            {render({
              uri: url,
              contentType: contentType ?? null,
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
              onError: () => void renewal.renew(),
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
  recordingId: string;
  showTranscript?: boolean;
  /** Start here (recording ms — a moment's `recordingMs`); a new value seeks. */
  startMs?: number | null;
  defaultSkipSilence?: boolean;
  /** The media adapter. Defaults to the provider's `renderMedia`. */
  renderMedia?: RenderMedia;
  style?: StyleProp<ViewStyle>;
}

export interface RecordingPlayerHandle {
  /** Seek to recording time `ms` and play. */
  seek: (ms: number) => void;
  /** Seek to transcript time `ms` (a summary item's `startMs`) and play. */
  seekTranscript: (ms: number) => void;
  play: () => void;
  pause: () => void;
}

/**
 * A finished recording (`GET /v1/recordings/:id/playback`): 1×–2× speed,
 * skip silence, chapters, and the transcript scrolling along — tap a line
 * to play from there.
 */
export const RecordingPlayer = forwardRef<RecordingPlayerHandle, RecordingPlayerProps>(
  function RecordingPlayer(
    { recordingId, showTranscript = true, startMs, defaultSkipSilence = false, renderMedia, style },
    ref,
  ) {
    const theme = useTheme();
    const extras = useMessageExtras();
    const render = renderMedia ?? extras.renderMedia;
    const { playback, error, refresh } = useRecordingPlayback(recordingId);
    const url = playback?.url || null;
    const segments = useMemo(() => playback?.transcript?.segments ?? [], [playback]);
    const offset = playback?.transcript?.offsetMs ?? 0;
    const chapters = playback?.chapters ?? [];
    const silences = useMemo(() => {
      const listed = silencesOf(playback?.recording);
      return listed.length > 0 ? listed : silencesFromSegments(segments);
    }, [playback, segments]);
    const m = useMediaState();
    const [rate, setRate] = useState<PlaybackRate>(1);
    const [skip, setSkip] = useState(defaultSkipSilence);
    const renewal = useMediaRenewal(refresh, recordingId);
    const resumeAt = useRef<number | null>(null);

    useImperativeHandle(ref, () => ({
      seek: (ms) => {
        m.seekTo(ms);
        m.setPaused(false);
      },
      seekTranscript: (ms) => {
        m.seekTo(ms + offset);
        m.setPaused(false);
      },
      play: () => m.setPaused(false),
      pause: () => m.setPaused(true),
    }));

    useEffect(() => {
      if (typeof startMs === 'number') m.seekTo(startMs);
      // Only a new start point seeks.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [startMs]);

    const active = activeSegmentIndex(segments, m.posMs);
    const scroller = useRef<ScrollView>(null);
    const lineY = useRef(new Map<number, number>());
    const userScrolledAt = useRef(0);
    useEffect(() => {
      if (active < 0 || Date.now() - userScrolledAt.current < 4000) return;
      const y = lineY.current.get(active);
      if (y !== undefined) scroller.current?.scrollTo({ y: Math.max(0, y - 60), animated: true });
    }, [active]);

    const chapterIdx = chapterIndexAt(chapters, m.posMs);
    const isAudio =
      playback?.recording?.mode === 'audio' || !!playback?.contentType?.startsWith('audio/');
    const text = { color: theme.colors.text, fontFamily: theme.fonts.body };
    const subtle = { color: theme.colors.textSubtle, fontFamily: theme.fonts.body };

    return (
      <View style={[styles.player, style]} accessibilityLabel="Recording">
        {!render ? null : error && !url ? (
          <Text style={[styles.note, { color: theme.colors.danger }]} accessibilityRole="alert">
            {meetingsErrorMessage(error)}
          </Text>
        ) : renewal.exhausted ? (
          <Text style={[styles.note, { color: theme.colors.danger }]} accessibilityRole="alert">
            The recording couldn’t be played. Try again later.
          </Text>
        ) : !url ? (
          <Text style={[styles.note, subtle]}>Loading the recording…</Text>
        ) : (
          <>
            {render({
              uri: url,
              contentType: playback?.contentType ?? null,
              kind: isAudio ? 'audio' : 'video',
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
                const at = m.posMs;
                if (renewal.renew()) resumeAt.current = at;
              },
              ...(isAudio ? {} : { style: styles.video }),
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
          </>
        )}

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
                    m.seekTo(s.start_ms);
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
                    <Text style={[styles.lineTime, subtle]}>{formatClock(s.start_ms)}</Text>
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
  note: { marginTop: 10, fontSize: 12, padding: 0 },
  section: { marginTop: 10, gap: 4 },
  sectionTitle: { fontSize: 10, fontWeight: '700', letterSpacing: 0.4 },
  bulletRow: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
  bullet: { fontSize: 13, lineHeight: 19 },
  body: { flex: 1, fontSize: 13, lineHeight: 19 },
  itemTime: { fontSize: 11, fontWeight: '600', lineHeight: 19, fontVariant: ['tabular-nums'] },
  task: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  box: { width: 14, height: 14, marginTop: 2, borderWidth: 1.5, borderRadius: 4 },
  taskBody: { flex: 1, minWidth: 0 },
  taskMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, minWidth: 0 },
  meta: { fontSize: 12, flexShrink: 1 },
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
  clipTitle: { flexShrink: 1, fontSize: 12, fontWeight: '600' },
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
