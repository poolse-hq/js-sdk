// Transcripts: the live panel beside a call and the viewer for a stored
// one. Same props as @poolse/react-ui.
//
//     <LiveTranscriptPanel callId={call.id} />
//     <TranscriptViewer callId={callId} />

import type { TranscriptSegment, TranscriptSpeaker } from '@poolse/sdk';
import {
  ApiError,
  captureErrorMessage,
  findInText,
  formatCallDuration,
  groupTranscript,
  useLiveTranscript,
  useTranscript,
} from '@poolse/react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { PoolseIcon } from './primitives/PoolseIcon.js';
import { useTheme } from './theme/PoolseTheme.js';

export interface LiveTranscriptPanelProps {
  /** The call. Null renders an empty panel. */
  callId: string | null;
  /** Keep the transcript topic open. Defaults to true; false while the panel is hidden. */
  enabled?: boolean;
  /** Start / Stop transcription buttons (someone in the call). Defaults to true. */
  showControls?: boolean;
  /** Shows a close button. */
  onClose?: () => void;
  title?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * The call's live transcript as it is spoken: speaker, time and text,
 * the current speaker's words in grey until they are final. Opens the
 * transcript topic while mounted (the last 200 lines arrive at once)
 * and sticks to the bottom unless you scroll up.
 */
export function LiveTranscriptPanel({
  callId,
  enabled = true,
  showControls = true,
  onClose,
  title = 'Live transcript',
  style,
}: LiveTranscriptPanelProps) {
  const theme = useTheme();
  const live = useLiveTranscript(callId, { enabled });
  const blocks = useMemo(() => groupTranscript(live.segments), [live.segments]);
  const scroller = useRef<ScrollView>(null);
  const pinned = useRef(true);
  const error = live.error ? transcriptError(live.error) : null;
  const text = { color: theme.colors.text, fontFamily: theme.fonts.body };
  const subtle = { color: theme.colors.textSubtle, fontFamily: theme.fonts.body };

  return (
    <View style={[styles.panel, { backgroundColor: theme.colors.surface }, style]}>
      <View style={[styles.head, { borderColor: theme.colors.border }]}>
        <Text style={[styles.title, text]} numberOfLines={1} accessibilityRole="header">
          {live.live ? '● ' : ''}
          {title}
        </Text>
        {showControls && callId ? (
          <Pressable
            onPress={() => void (live.live ? live.stop() : live.start())}
            disabled={live.pending}
            accessibilityRole="button"
            accessibilityLabel={live.live ? 'Stop the transcript' : 'Start the transcript'}
            hitSlop={8}
            style={({ pressed }) => [
              styles.btn,
              { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border },
              (pressed || live.pending) && styles.pressed,
            ]}
          >
            <Text style={[styles.btnText, text]}>
              {live.live ? 'Stop' : live.transcript ? 'Resume' : 'Start'}
            </Text>
          </Pressable>
        ) : null}
        {onClose ? (
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close transcript"
            hitSlop={8}
          >
            <PoolseIcon name="close" size={18} color={theme.colors.textMuted} label={null} />
          </Pressable>
        ) : null}
      </View>
      <ScrollView
        ref={scroller}
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        onScroll={(e) => {
          const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
          pinned.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 24;
        }}
        scrollEventThrottle={100}
        onContentSizeChange={() => {
          if (pinned.current) scroller.current?.scrollToEnd({ animated: false });
        }}
        accessibilityLiveRegion="polite"
      >
        {blocks.length === 0 ? (
          <Text style={[styles.empty, subtle]}>
            {error ??
              (live.live
                ? 'Listening…'
                : live.joined
                  ? 'Transcription is off. Start it to see what is said.'
                  : 'Opening the transcript…')}
          </Text>
        ) : (
          blocks.map((b, i) => (
            <View key={`${b.speaker}-${b.startMs}-${i}`} style={styles.block}>
              <View style={styles.who}>
                <Text style={[styles.name, text]} numberOfLines={1}>
                  {b.name}
                </Text>
                <Text style={[styles.time, subtle]}>{formatCallDuration(b.startMs)}</Text>
              </View>
              <Text style={[styles.text, text]}>
                {b.segments.map((s, k) => (
                  <Text key={k} style={s.final ? undefined : { color: theme.colors.textSubtle }}>
                    {k > 0 ? ' ' : ''}
                    {s.text}
                  </Text>
                ))}
              </Text>
            </View>
          ))
        )}
      </ScrollView>
      {error && blocks.length > 0 ? (
        <Text style={[styles.error, { color: theme.colors.danger, fontFamily: theme.fonts.body }]}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export interface TranscriptViewerProps {
  /** The call whose stored transcript to show. */
  callId: string | null;
  /**
   * Offer speaker renames. Defaults to true; the server allows it for
   * people who took part in the call and the conversation's owners and
   * admins, and anyone else gets an explanation instead.
   */
  canRename?: boolean;
  /** Makes timestamps pressable, e.g. to seek a recording (ms since the transcript started). */
  onSeek?: (ms: number) => void;
  title?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * A call's stored transcript: who spoke, when, and what they said;
 * search within it; and correct a speaker's name (everyone viewing sees
 * the change at once).
 */
export function TranscriptViewer({
  callId,
  canRename = true,
  onSeek,
  title = 'Transcript',
  style,
}: TranscriptViewerProps) {
  const theme = useTheme();
  const { transcript, loading, missing, error, renameSpeakers } = useTranscript(callId);
  const [query, setQuery] = useState('');
  const [hit, setHit] = useState(0);
  const blocks = useMemo(() => groupTranscript(transcript?.segments ?? []), [transcript]);
  const scroller = useRef<ScrollView>(null);
  const blockY = useRef(new Map<number, number>());

  const hits = useMemo(() => {
    const out: Array<{ b: number; s: number; r: [number, number] }> = [];
    if (!query.trim()) return out;
    blocks.forEach((block, b) =>
      block.segments.forEach((seg, s) => {
        for (const r of findInText(seg.text, query)) out.push({ b, s, r });
      }),
    );
    return out;
  }, [blocks, query]);

  const go = (next: number) => {
    setHit(next);
    const target = hits[next];
    const y = target ? blockY.current.get(target.b) : undefined;
    if (y !== undefined) scroller.current?.scrollTo({ y: Math.max(0, y - 40), animated: true });
  };
  const step = (d: number) => {
    if (hits.length) go((hit + d + hits.length) % hits.length);
  };

  if (!callId) return null;

  const text = { color: theme.colors.text, fontFamily: theme.fonts.body };
  const subtle = { color: theme.colors.textSubtle, fontFamily: theme.fonts.body };
  const meta = transcript
    ? [
        transcript.started_at ? formatDate(transcript.started_at) : null,
        duration(transcript),
        transcript.speakers.length === 1 ? '1 speaker' : `${transcript.speakers.length} speakers`,
      ]
        .filter(Boolean)
        .join(' · ')
    : null;

  return (
    <View style={[styles.panel, { backgroundColor: theme.colors.surface }, style]}>
      <View style={[styles.head, { borderColor: theme.colors.border }]}>
        <View style={styles.heading}>
          <Text style={[styles.title, text]} numberOfLines={1} accessibilityRole="header">
            {title}
          </Text>
          {meta ? (
            <Text style={[styles.meta, subtle]} numberOfLines={1}>
              {meta}
            </Text>
          ) : null}
        </View>
      </View>

      {transcript && transcript.segments.length > 0 ? (
        <View style={[styles.search, { backgroundColor: theme.colors.surfaceAlt }]}>
          <PoolseIcon name="search" size={15} color={theme.colors.textSubtle} label={null} />
          <TextInput
            value={query}
            onChangeText={(v) => {
              setQuery(v);
              setHit(0);
            }}
            onSubmitEditing={() => step(1)}
            placeholder="Search the transcript"
            placeholderTextColor={theme.colors.textSubtle}
            accessibilityLabel="Search the transcript"
            returnKeyType="search"
            style={[styles.searchInput, text]}
          />
          {query.trim() ? (
            <>
              <Text style={[styles.count, subtle]} accessibilityLiveRegion="polite">
                {hits.length ? `${hit + 1} of ${hits.length}` : 'No matches'}
              </Text>
              <Pressable
                onPress={() => step(-1)}
                disabled={!hits.length}
                accessibilityRole="button"
                accessibilityLabel="Previous match"
                hitSlop={6}
              >
                <PoolseIcon
                  name="chevron-up"
                  size={16}
                  color={theme.colors.textMuted}
                  label={null}
                />
              </Pressable>
              <Pressable
                onPress={() => step(1)}
                disabled={!hits.length}
                accessibilityRole="button"
                accessibilityLabel="Next match"
                hitSlop={6}
              >
                <PoolseIcon
                  name="chevron-down"
                  size={16}
                  color={theme.colors.textMuted}
                  label={null}
                />
              </Pressable>
            </>
          ) : null}
        </View>
      ) : null}

      {transcript && transcript.speakers.length > 0 ? (
        <SpeakerList
          speakers={transcript.speakers}
          canRename={canRename}
          onRename={renameSpeakers}
        />
      ) : null}

      <ScrollView ref={scroller} style={styles.body} contentContainerStyle={styles.bodyContent}>
        {loading && !transcript ? (
          <Text style={[styles.empty, subtle]}>Loading the transcript…</Text>
        ) : missing ? (
          <Text style={[styles.empty, subtle]}>This call has no transcript.</Text>
        ) : error && !transcript ? (
          <Text style={[styles.empty, subtle]}>{transcriptError(error)}</Text>
        ) : transcript && transcript.segments.length === 0 ? (
          <Text style={[styles.empty, subtle]}>Nothing was said in this call.</Text>
        ) : (
          blocks.map((block, b) => (
            <View
              key={`${block.speaker}-${block.startMs}-${b}`}
              style={styles.block}
              onLayout={(e) => blockY.current.set(b, e.nativeEvent.layout.y)}
            >
              <View style={styles.who}>
                <Text style={[styles.name, text]} numberOfLines={1}>
                  {block.name}
                </Text>
                {onSeek ? (
                  <Pressable
                    onPress={() => onSeek(block.startMs)}
                    accessibilityRole="button"
                    accessibilityLabel={`Play from ${formatCallDuration(block.startMs)}`}
                    hitSlop={6}
                  >
                    <Text style={[styles.time, subtle, styles.timeLink]}>
                      {formatCallDuration(block.startMs)}
                    </Text>
                  </Pressable>
                ) : (
                  <Text style={[styles.time, subtle]}>{formatCallDuration(block.startMs)}</Text>
                )}
              </View>
              <Text style={[styles.text, text]}>
                {block.segments.map((seg, s) => (
                  <Text key={s}>
                    {s > 0 ? ' ' : ''}
                    {highlight(seg, hits, b, s, hit, theme.colors.warning)}
                  </Text>
                ))}
              </Text>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

function SpeakerList({
  speakers,
  canRename,
  onRename,
}: {
  speakers: TranscriptSpeaker[];
  canRename: boolean;
  onRename: (names: Record<string, string | null>) => Promise<void>;
}) {
  const theme = useTheme();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const text = { color: theme.colors.text, fontFamily: theme.fonts.body };

  const save = async (key: string, name: string | null) => {
    setBusy(true);
    setError(null);
    try {
      await onRename({ [key]: name });
      setEditing(null);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 403
          ? 'Only people who were in the call can rename speakers.'
          : err instanceof ApiError && err.code === 'validation_failed'
            ? 'Names can be up to 100 characters.'
            : 'The name could not be saved. Try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  const action = (label: string, onPress: () => void, primary = false) => (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => [styles.renameBtn, (pressed || busy) && styles.pressed]}
    >
      <Text
        style={[
          styles.renameBtnText,
          {
            color: primary ? theme.colors.accentStrong : theme.colors.text,
            fontFamily: theme.fonts.body,
          },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );

  return (
    <View style={styles.speakers}>
      <View style={styles.speakerRow} accessibilityLabel="Speakers">
        {speakers.map((sp) =>
          editing === sp.key ? (
            <View key={sp.key} style={styles.rename}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                maxLength={100}
                autoFocus
                accessibilityLabel="Speaker name"
                onSubmitEditing={() => draft.trim() && void save(sp.key, draft.trim())}
                style={[
                  styles.renameInput,
                  text,
                  { borderColor: theme.colors.border, backgroundColor: theme.colors.background },
                ]}
              />
              {action('Save', () => draft.trim() && void save(sp.key, draft.trim()), true)}
              {sp.corrected ? action('Use their own name', () => void save(sp.key, null)) : null}
              {action('Cancel', () => setEditing(null))}
            </View>
          ) : (
            <View
              key={sp.key}
              style={[styles.speaker, { backgroundColor: theme.colors.surfaceAlt }]}
            >
              <Text style={[styles.speakerName, text]} numberOfLines={1}>
                {sp.name?.trim() || 'Speaker'}
              </Text>
              {canRename ? (
                <Pressable
                  onPress={() => {
                    setDraft(sp.name ?? '');
                    setError(null);
                    setEditing(sp.key);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Rename ${sp.name?.trim() || 'speaker'}`}
                  hitSlop={8}
                  style={styles.speakerEdit}
                >
                  <PoolseIcon name="edit" size={13} color={theme.colors.textMuted} label={null} />
                </Pressable>
              ) : null}
            </View>
          ),
        )}
      </View>
      {error ? (
        <Text style={[styles.error, { color: theme.colors.danger, fontFamily: theme.fonts.body }]}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function highlight(
  seg: TranscriptSegment,
  hits: Array<{ b: number; s: number; r: [number, number] }>,
  b: number,
  s: number,
  current: number,
  color: string,
): ReactNode {
  const mine = hits.map((h, i) => ({ ...h, i })).filter((h) => h.b === b && h.s === s);
  if (!mine.length) return seg.text;
  const out: ReactNode[] = [];
  let at = 0;
  for (const h of mine) {
    if (h.r[0] > at) out.push(seg.text.slice(at, h.r[0]));
    out.push(
      <Text key={h.i} style={{ backgroundColor: hexAlpha(color, h.i === current ? 0.65 : 0.3) }}>
        {seg.text.slice(h.r[0], h.r[1])}
      </Text>,
    );
    at = h.r[1];
  }
  if (at < seg.text.length) out.push(seg.text.slice(at));
  return out;
}

/** `#rrggbb` → `rgba(…, a)`; anything else as is. */
function hexAlpha(color: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return color;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function duration(t: { started_at: string | null; ended_at: string | null }): string | null {
  if (!t.started_at || !t.ended_at) return null;
  const ms = Date.parse(t.ended_at) - Date.parse(t.started_at);
  return Number.isFinite(ms) && ms > 0 ? formatCallDuration(ms) : null;
}

function formatDate(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function transcriptError(err: Error): string {
  const code = err instanceof ApiError ? err.code : err.message;
  if (code === 'forbidden') return 'You can’t open this transcript.';
  if (code === 'not_found') return 'There is no transcript for this call.';
  return captureErrorMessage(err instanceof ApiError ? err : { code });
}

const styles = StyleSheet.create({
  panel: { flex: 1, minHeight: 0 },
  pressed: { opacity: 0.6 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  heading: { flex: 1, minWidth: 0 },
  title: { flex: 1, fontSize: 15, fontWeight: '600' },
  meta: { fontSize: 12, fontWeight: '500' },
  btn: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  btnText: { fontSize: 12, fontWeight: '600' },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 12,
    marginTop: 8,
    paddingLeft: 10,
    paddingRight: 6,
    borderRadius: 12,
  },
  searchInput: { flex: 1, minWidth: 0, paddingVertical: 8, fontSize: 14 },
  count: { fontSize: 12, fontWeight: '500', fontVariant: ['tabular-nums'] },
  speakers: { paddingHorizontal: 12, paddingTop: 8 },
  speakerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  speaker: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: '100%',
    paddingLeft: 10,
    paddingRight: 4,
    paddingVertical: 3,
    borderRadius: 999,
  },
  speakerName: { flexShrink: 1, maxWidth: 220, fontSize: 12, fontWeight: '500' },
  speakerEdit: { padding: 4 },
  rename: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4, width: '100%' },
  renameInput: {
    flexGrow: 1,
    minWidth: 140,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 13,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  renameBtn: { paddingHorizontal: 8, paddingVertical: 6 },
  renameBtnText: { fontSize: 12, fontWeight: '600' },
  body: { flex: 1 },
  bodyContent: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 12 },
  empty: { marginVertical: 24, textAlign: 'center', fontSize: 14 },
  block: { paddingVertical: 6 },
  who: { flexDirection: 'row', alignItems: 'baseline', gap: 8, minWidth: 0 },
  name: { flexShrink: 1, fontSize: 13, fontWeight: '600' },
  time: { fontSize: 11, fontWeight: '500', fontVariant: ['tabular-nums'] },
  timeLink: { textDecorationLine: 'underline' },
  text: { marginTop: 2, fontSize: 14, lineHeight: 21 },
  error: { marginHorizontal: 12, marginVertical: 6, fontSize: 13, fontWeight: '500' },
});
