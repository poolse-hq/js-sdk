// Agents in calls: the agent's mark on a roster row or tile (AG13), the
// invite menu (AG13), your private whisper (AG15) and your agent's
// questions while it attends for you (AG16). Same props as
// @poolse/react-ui; works with the JS CallRoom and with @poolse/native.
//
//     const agents = useCallAgents(conversationId, callId);
//     <InviteAgentMenu callAgents={agents} />
//     <WhisperPanel whisper={useWhisper(callId)} />
//     <EscalationList />                       // or <EscalationCard escalation={e} />
//
// With @poolse/native, a roster entry is an agent when `isAgent` (or
// `agents.agentFor(p.userId)`): name it `agentLabel` and show
// <CallAgentTag agent={…} speaking={p.speaking} />.

import type { AgentEscalation, CallAgent, EscalationReply } from '@poolse/sdk';
import {
  ESCALATION_ANSWER_MAX,
  callAgentModeLabel,
  callAgentStateLabel,
  callAgentStateOf,
  escalationErrorMessage,
  escalationStatusLabel,
  useEscalations,
  usePoolse,
  whisperErrorMessage,
  whisperHintKindLabel,
  type UseCallAgents,
  type UseWhisper,
} from '@poolse/react';
import { useEffect, useRef, useState } from 'react';
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

import { AgentBadge, withAlpha } from './AgentBadge.js';
import { useTheme } from './theme/PoolseTheme.js';

function useText() {
  const theme = useTheme();
  return {
    theme,
    text: { color: theme.colors.text, fontFamily: theme.fonts.body },
    muted: { color: theme.colors.textMuted, fontFamily: theme.fonts.body },
    subtle: { color: theme.colors.textSubtle, fontFamily: theme.fonts.body },
    card: {
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.border,
      borderRadius: theme.radii.lg,
    },
  };
}

function Button({
  label,
  onPress,
  primary = false,
  disabled = false,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const { theme, text } = useText();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      hitSlop={6}
      style={({ pressed }) => [
        styles.btn,
        primary
          ? { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent }
          : { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border },
        (pressed || disabled) && styles.pressed,
      ]}
    >
      <Text
        style={[styles.btnText, primary ? { color: theme.colors.accentText } : text]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// ── the agent in a row or tile (AG13, AG14) ─────────────────────────────

export interface CallAgentTagProps {
  agent: Pick<CallAgent, 'mode' | 'status' | 'speaking'>;
  /** Show what it's doing ("Taking notes"). Defaults to true. */
  showState?: boolean;
  /** The participant's live speaking flag; overrides the agent's. */
  speaking?: boolean;
  /** Over video: light text. */
  onMedia?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** The Agent badge with the agent's state — beside its name wherever it's listed in a call. */
export function CallAgentTag({
  agent,
  showState = true,
  speaking,
  onMedia,
  style,
}: CallAgentTagProps) {
  const { theme, subtle } = useText();
  const state = callAgentStateOf({ ...agent, speaking: speaking ?? agent.speaking });
  return (
    <View style={[styles.tag, style]}>
      <AgentBadge size="xs" />
      {showState ? (
        <Text
          style={[
            styles.tagState,
            subtle,
            onMedia ? { color: 'rgba(255,255,255,0.85)' } : null,
            state === 'speaking' ? { color: theme.colors.success } : null,
          ]}
          numberOfLines={1}
          accessibilityLiveRegion="polite"
        >
          {callAgentStateLabel(state)}
        </Text>
      ) : null}
    </View>
  );
}

// ── invite (AG13) ────────────────────────────────────────────────────────

export interface InviteAgentMenuProps {
  /** `useCallAgents(conversationId, callId)`. */
  callAgents: UseCallAgents;
  onDone?: () => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * Bring a note-taker (silent: transcript, summary and tasks) or an
 * assistant (answers when addressed by name) into the call, switch
 * one's mode, or send one out.
 */
export function InviteAgentMenu({ callAgents, onDone, style }: InviteAgentMenuProps) {
  const { card, text, subtle, theme } = useText();
  const { agents, available, loading, pending, error, invite, setMode, remove } = callAgents;
  const act = (fn: () => Promise<void>) => {
    fn().then(
      () => onDone?.(),
      () => undefined,
    );
  };
  return (
    <View style={[styles.card, card, style]} accessibilityLabel="Agents in this call">
      <Text style={[styles.title, text]} accessibilityRole="header">
        Agents
      </Text>
      {agents.map((a) => (
        <View key={a.agentId} style={styles.row}>
          <View style={styles.who}>
            <View style={styles.inline}>
              <Text style={[styles.name, text]} numberOfLines={1}>
                {a.label}
              </Text>
              <CallAgentTag agent={a} />
            </View>
            <Text style={[styles.small, subtle]} numberOfLines={1}>
              {callAgentModeLabel(a)}
            </Text>
          </View>
          {a.mode !== 'delegate' ? (
            <View style={styles.actions}>
              <Button
                label={a.mode === 'notetaker' ? 'Let it answer' : 'Notes only'}
                disabled={pending === a.agentId}
                onPress={() =>
                  act(() => setMode(a.agentId, a.mode === 'notetaker' ? 'assistant' : 'notetaker'))
                }
              />
              <Button
                label={pending === a.agentId ? 'Removing…' : 'Remove'}
                disabled={pending === a.agentId}
                accessibilityLabel={`Remove ${a.label} from the call`}
                onPress={() => act(() => remove(a.agentId))}
              />
            </View>
          ) : null}
        </View>
      ))}
      {available.map((a) => (
        <View key={a.id} style={styles.row}>
          <View style={[styles.who, styles.inline]}>
            <Text style={[styles.name, text]} numberOfLines={1}>
              {a.name}
            </Text>
            <AgentBadge size="xs" />
          </View>
          <View style={styles.actions}>
            <Button
              label="Take notes"
              primary
              disabled={pending === a.id}
              accessibilityLabel={`Invite ${a.name} to take notes`}
              onPress={() => act(() => invite(a.id, 'notetaker'))}
            />
            <Button
              label="Assist"
              disabled={pending === a.id}
              accessibilityLabel={`Invite ${a.name} as an assistant`}
              onPress={() => act(() => invite(a.id, 'assistant'))}
            />
          </View>
        </View>
      ))}
      {!loading && agents.length === 0 && available.length === 0 ? (
        <Text style={[styles.small, subtle]}>No agents can join calls yet.</Text>
      ) : null}
      {error ? (
        <Text style={[styles.small, { color: theme.colors.danger }]} accessibilityRole="alert">
          {inviteErrorMessage(error)}
        </Text>
      ) : null}
    </View>
  );
}

// ── whisper (AG15) ───────────────────────────────────────────────────────

export interface WhisperPanelProps {
  /** `useWhisper(callId)`. */
  whisper: UseWhisper;
  /** Height of the hint list before it scrolls. Defaults to 320. */
  maxHeight?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Private hints during a call — facts, what you promised last time,
 * questions to raise. Only you see them; the panel says so.
 */
export function WhisperPanel({ whisper, maxHeight = 320, style }: WhisperPanelProps) {
  const { card, text, subtle, muted, theme } = useText();
  const { on, hints, agentName, loading, pending, error, setOn } = whisper;
  const scroll = useRef<ScrollView>(null);
  useEffect(() => {
    scroll.current?.scrollToEnd({ animated: true });
  }, [hints.length]);

  return (
    <View style={[styles.card, card, style]} accessibilityLabel="Whisper">
      <View style={styles.headRow}>
        <Text style={[styles.title, text, styles.grow]} accessibilityRole="header">
          Whisper
        </Text>
        <Switch
          value={on}
          disabled={pending || loading}
          onValueChange={(v) => void setOn(v).catch(() => undefined)}
          accessibilityLabel={on ? 'Turn whisper off' : 'Turn whisper on'}
        />
      </View>
      <View
        style={[
          styles.private,
          { backgroundColor: withAlpha(theme.colors.accent, 0.12), borderRadius: theme.radii.pill },
        ]}
      >
        <Text style={[styles.privateText, { color: theme.colors.accent }]}>
          🔒 Only you see this
        </Text>
      </View>
      {on && agentName ? (
        <View style={styles.inline}>
          <Text style={[styles.small, muted, styles.shrink]} numberOfLines={1}>
            {agentName}
          </Text>
          <AgentBadge size="xs" />
          <Text style={[styles.small, muted]}>is whispering to you</Text>
        </View>
      ) : null}
      {hints.length > 0 ? (
        <ScrollView ref={scroll} style={{ maxHeight }} contentContainerStyle={styles.hints}>
          {hints.map((h) => (
            <View
              key={h.id}
              style={[
                styles.hint,
                { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radii.md },
              ]}
            >
              <Text
                style={[
                  styles.kind,
                  subtle,
                  h.kind === 'promise' ? { color: theme.colors.warning } : null,
                  h.kind === 'question' ? { color: theme.colors.info } : null,
                ]}
              >
                {whisperHintKindLabel(h.kind).toUpperCase()}
              </Text>
              <Text style={[styles.hintText, text]}>{h.text}</Text>
              {h.sources.some((s) => s.title) ? (
                <Text style={[styles.small, subtle]} numberOfLines={2}>
                  {h.sources
                    .filter((s) => s.title)
                    .map((s) => s.title)
                    .join(' · ')}
                </Text>
              ) : null}
            </View>
          ))}
        </ScrollView>
      ) : (
        <Text style={[styles.small, subtle]}>
          {on
            ? 'Hints show up here as the call goes.'
            : 'Turn on to get private hints during this call.'}
        </Text>
      )}
      {error ? (
        <Text style={[styles.small, { color: theme.colors.danger }]} accessibilityRole="alert">
          {whisperErrorMessage(error)}
        </Text>
      ) : null}
    </View>
  );
}

// ── escalations (AG16) ───────────────────────────────────────────────────

export interface EscalationCardProps {
  escalation: AgentEscalation;
  /** The agent's name; defaults to the directory's, else "Your agent". */
  agentName?: string | null;
  meetingTitle?: string | null;
  /** Defaults to `poolse.escalations.reply`. */
  reply?: (id: string, reply: EscalationReply) => Promise<unknown>;
  onReplied?: (escalation: AgentEscalation) => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * Your agent, in a meeting for you, asking something its brief doesn't
 * cover: Approve, Decline, or write an answer.
 */
export function EscalationCard({
  escalation: e,
  agentName,
  meetingTitle,
  reply,
  onReplied,
  style,
}: EscalationCardProps) {
  const poolse = usePoolse();
  const { theme, text, subtle } = useText();
  const name =
    agentName ?? (e.agentId ? poolse.agents.peek(e.agentId)?.name : null) ?? 'Your agent';
  const [answerText, setAnswerText] = useState('');
  const [answering, setAnswering] = useState(false);
  const [sending, setSending] = useState<'approve' | 'decline' | 'answer' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const expired = useExpired(e.expiresAt);
  const status = e.status === 'pending' && expired ? 'expired' : e.status;
  const open = status === 'pending';
  const statusColor =
    status === 'pending'
      ? theme.colors.warning
      : status === 'declined' || status === 'expired'
        ? theme.colors.danger
        : status === 'cancelled'
          ? theme.colors.textMuted
          : theme.colors.success;

  const send = async (decision: 'approve' | 'decline' | 'answer') => {
    const t = answerText.trim();
    if (decision === 'answer' && !t) return;
    const r: EscalationReply = decision === 'answer' ? { answer: t } : { decision };
    setSending(decision);
    setError(null);
    try {
      await (reply ? reply(e.id, r) : poolse.escalations.reply(e.id, r));
      setAnswerText('');
      setAnswering(false);
      onReplied?.(e);
    } catch (err) {
      setError(err);
    } finally {
      setSending(null);
    }
  };

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.surface,
          borderColor: open ? withAlpha(theme.colors.warning, 0.55) : theme.colors.border,
          borderRadius: theme.radii.lg,
        },
        style,
      ]}
      accessibilityLabel={`Question from ${name}`}
    >
      <View style={styles.headRow}>
        <Text style={[styles.agent, text, styles.shrink]} numberOfLines={1}>
          {name}
        </Text>
        <AgentBadge size="xs" />
        <View style={[styles.status, { backgroundColor: withAlpha(statusColor, 0.14) }]}>
          <Text style={[styles.statusText, { color: statusColor }]} numberOfLines={1}>
            {escalationStatusLabel(status)}
          </Text>
        </View>
      </View>
      {meetingTitle ? (
        <Text style={[styles.small, subtle]} numberOfLines={1}>
          In {meetingTitle}
        </Text>
      ) : null}
      <Text style={[styles.question, text]}>{e.question}</Text>
      {!open && e.answer ? <Text style={[styles.small, subtle]}>You said: {e.answer}</Text> : null}
      {open && answering ? (
        <TextInput
          value={answerText}
          onChangeText={setAnswerText}
          maxLength={ESCALATION_ANSWER_MAX}
          multiline
          placeholder="Your answer"
          placeholderTextColor={theme.colors.textSubtle}
          accessibilityLabel="Your answer"
          editable={!sending}
          autoFocus
          style={[
            styles.input,
            text,
            { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border },
          ]}
        />
      ) : null}
      {open ? (
        <View style={styles.actionsWrap}>
          {answering ? (
            <Button
              label={sending === 'answer' ? 'Sending…' : 'Send answer'}
              primary
              disabled={!!sending || !answerText.trim()}
              onPress={() => void send('answer')}
            />
          ) : (
            <>
              {e.options.includes('approve') ? (
                <Button
                  label={sending === 'approve' ? 'Approving…' : 'Approve'}
                  primary
                  disabled={!!sending}
                  onPress={() => void send('approve')}
                />
              ) : null}
              {e.options.includes('decline') ? (
                <Button
                  label={sending === 'decline' ? 'Declining…' : 'Decline'}
                  disabled={!!sending}
                  onPress={() => void send('decline')}
                />
              ) : null}
            </>
          )}
          {e.options.includes('answer') || answering ? (
            <Pressable
              onPress={() => setAnswering((v) => !v)}
              disabled={!!sending}
              accessibilityRole="button"
              hitSlop={8}
            >
              <Text style={[styles.link, { color: theme.colors.link }]}>
                {answering ? 'Back' : 'Answer'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {error ? (
        <Text style={[styles.small, { color: theme.colors.danger }]} accessibilityRole="alert">
          {escalationErrorMessage(error)}
        </Text>
      ) : null}
    </View>
  );
}

export interface EscalationListProps {
  /** Only this call's. */
  callId?: string | null;
  /** Shown when nothing waits. Defaults to nothing. */
  empty?: string | null;
  style?: StyleProp<ViewStyle>;
}

/** Everything your agents wait for you to answer, live. */
export function EscalationList({ callId, empty = null, style }: EscalationListProps) {
  const { subtle } = useText();
  const { escalations, agentNameOf } = useEscalations({ callId: callId ?? null });
  if (escalations.length === 0)
    return empty ? <Text style={[styles.small, subtle, styles.empty]}>{empty}</Text> : null;
  return (
    <View style={[styles.list, style]}>
      {escalations.map((e) => (
        <EscalationCard key={e.id} escalation={e} agentName={agentNameOf(e)} />
      ))}
    </View>
  );
}

function inviteErrorMessage(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  switch (code) {
    case 'not_in_call':
      return 'Join the call to invite an agent.';
    case 'agents_not_allowed':
      return 'You can’t invite agents to this call.';
    case 'agent_not_member':
      return 'Add the agent to this conversation first.';
    case 'agent_paused':
      return 'This agent is paused.';
    case 'transcription_disabled':
    case 'transcription_unavailable':
      return 'Agents need live transcription, which isn’t available here.';
    case 'speaking_disabled':
      return 'Agents can’t speak in calls here — invite it to take notes.';
    case 'voice_unavailable':
      return 'Agents can’t join calls right now. Try again soon.';
    case 'rate_limited':
      return 'Too many changes. Wait a moment.';
    default:
      return 'That didn’t work. Try again.';
  }
}

function useExpired(expiresAt: string | null): boolean {
  const at = expiresAt ? Date.parse(expiresAt) : NaN;
  const [expired, setExpired] = useState(() => Number.isFinite(at) && at <= Date.now());
  useEffect(() => {
    if (!Number.isFinite(at)) return;
    const left = at - Date.now();
    if (left <= 0) {
      setExpired(true);
      return;
    }
    setExpired(false);
    const t = setTimeout(() => setExpired(true), Math.min(left, 2_147_000_000));
    return () => clearTimeout(t);
  }, [at]);
  return expired;
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, padding: 12, gap: 8, width: '100%', maxWidth: 520 },
  title: { fontSize: 15, fontWeight: '700' },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  grow: { flex: 1 },
  shrink: { flexShrink: 1 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0, flexWrap: 'wrap' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, flexWrap: 'wrap' },
  who: { flex: 1, minWidth: 120, gap: 2 },
  name: { flexShrink: 1, fontSize: 14, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 6 },
  actionsWrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  small: { fontSize: 12, lineHeight: 16 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 0 },
  tagState: { fontSize: 11, fontWeight: '600' },
  private: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 2 },
  privateText: { fontSize: 12, fontWeight: '700' },
  hints: { gap: 8 },
  hint: { padding: 10, gap: 2 },
  kind: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4 },
  hintText: { fontSize: 14, lineHeight: 19 },
  agent: { fontSize: 13, fontWeight: '700' },
  status: { marginLeft: 'auto', paddingHorizontal: 8, paddingVertical: 1, borderRadius: 999 },
  statusText: { fontSize: 11, fontWeight: '600' },
  question: { fontSize: 14, fontWeight: '600', lineHeight: 19 },
  input: {
    minHeight: 44,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    fontSize: 14,
  },
  btn: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
  },
  btnText: { fontSize: 14, fontWeight: '600' },
  pressed: { opacity: 0.6 },
  link: { fontSize: 13, fontWeight: '600' },
  list: { gap: 10 },
  empty: { padding: 16, textAlign: 'center' },
});
