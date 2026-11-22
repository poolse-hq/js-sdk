// During the call: the stage and raised hands, Q&A (CL3), breakout rooms
// (CL5), the lobby (CL10), mark a moment (CL14), the agenda (CA5), who is
// in a room (CL2) and meeting cards in chat (CA4, CA11). Same props as
// @poolse/react-ui; each takes the matching @poolse/react hook's result,
// so it works with the JS CallRoom and with @poolse/native alike.
//
//     const stage = useStage(conversationId, callId, me.id);
//     <StagePanel stage={stage} participants={people} selfUserId={me.id} />
//     <QuestionsPanel questions={useQuestions(conversationId, callId)} canModerate />
//     <MeetingCard card={meetingCardOf(msg)!} onRsvp={rsvp} onJoin={join} />

import type {
  AgendaItem,
  GuestLobbyStatus,
  LiveCall,
  MeetingCard as MeetingCardData,
  Message,
  Question,
  RsvpResponse,
  RoomSession,
} from '@poolse/sdk';
import { QUESTION_MAX, meetingCardOf, meetingJoinable, rsvpOf } from '@poolse/sdk';
import type {
  UseAgenda,
  UseBreakouts,
  UseLobby,
  UseMoments,
  UseQuestions,
  UseStage,
} from '@poolse/react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {
  avatarOverflow,
  formatCountdown,
  meetingTimeText,
  overrunText,
  rsvpSummary,
} from './internal/meetingsLive.js';
import { useMessageExtras } from './messageExtras.js';
import { Avatar } from './primitives/Avatar.js';
import { PoolseIcon } from './primitives/PoolseIcon.js';
import { useTheme } from './theme/PoolseTheme.js';

/** Someone in the call, as the panels name them. */
export interface MeetingParticipant {
  userId: string;
  name?: string | null;
  /** Joined from a guest link: shown with a Guest mark. */
  guest?: boolean;
  avatarUrl?: string | null;
}

type NameFor = (userId: string) => string | null | undefined;

/** A name for a user id: given, then the provider's resolver, never the id itself. */
function useNamer(nameForUserId?: NameFor) {
  const extras = useMessageExtras();
  const fn = nameForUserId ?? extras.nameForUserId;
  return (userId: string | null | undefined, given?: string | null) =>
    given?.trim() || (userId ? fn?.(userId)?.trim() : null) || 'Someone';
}

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
  danger = false,
  disabled = false,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const { theme } = useText();
  const bg = primary ? theme.colors.accent : danger ? theme.colors.danger : theme.colors.surfaceAlt;
  const fg = primary || danger ? theme.colors.accentText : theme.colors.text;
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
        { backgroundColor: bg, borderRadius: theme.radii.pill, opacity: disabled ? 0.5 : 1 },
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.btnText, { color: fg, fontFamily: theme.fonts.body }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function GuestMark() {
  const { theme, subtle } = useText();
  return (
    <Text
      style={[
        styles.guest,
        subtle,
        { borderColor: theme.colors.border, borderRadius: theme.radii.sm },
      ]}
      accessibilityLabel="guest"
    >
      Guest
    </Text>
  );
}

function PersonRow({
  name,
  guest,
  avatarUrl,
  seed,
  children,
  extra,
}: {
  name: string;
  guest?: boolean | undefined;
  avatarUrl?: string | null | undefined;
  seed: string;
  children?: ReactNode;
  extra?: string | null;
}) {
  const { text, subtle } = useText();
  return (
    <View style={styles.personRow}>
      <Avatar name={name} seed={seed} src={avatarUrl ?? null} size="sm" />
      <View style={styles.personName}>
        <View style={styles.inline}>
          <Text style={[styles.body, text, styles.shrink]} numberOfLines={1}>
            {name}
          </Text>
          {guest ? <GuestMark /> : null}
        </View>
        {extra ? (
          <Text style={[styles.small, subtle]} numberOfLines={1}>
            {extra}
          </Text>
        ) : null}
      </View>
      {children ? <View style={styles.inline}>{children}</View> : null}
    </View>
  );
}

function Header({ title, count }: { title: string; count?: number }) {
  const { subtle } = useText();
  return (
    <Text style={[styles.sectionTitle, subtle]} accessibilityRole="header">
      {title.toUpperCase()}
      {count !== undefined ? ` · ${count}` : ''}
    </Text>
  );
}

// ── Stage (CL3) ──────────────────────────────────────────────────────────

export interface StagePanelProps {
  stage: UseStage;
  /** Everyone in the call (from the call roster). */
  participants: readonly MeetingParticipant[];
  selfUserId?: string | null;
  nameForUserId?: NameFor;
  style?: StyleProp<ViewStyle>;
}

/**
 * Speakers and audience, your raise-hand button, and — for moderators —
 * raised hands with Bring up / Lower, and Move to audience on speakers.
 */
export function StagePanel({
  stage,
  participants,
  selfUserId,
  nameForUserId,
  style,
}: StagePanelProps) {
  const { card, muted } = useText();
  const nameOf = useNamer(nameForUserId);
  const byId = useMemo(() => new Map(participants.map((p) => [p.userId, p])), [participants]);
  const speakers = participants.filter((p) => stage.roleOf(p.userId) !== 'audience');
  const audience = participants.filter((p) => stage.roleOf(p.userId) === 'audience');
  const hands = stage.stage?.hands ?? [];
  const mod = stage.isModerator;
  const isSelf = (id: string) => !!selfUserId && id === selfUserId;
  const label = (id: string) =>
    isSelf(id) ? `${nameOf(id, byId.get(id)?.name)} (you)` : nameOf(id, byId.get(id)?.name);

  return (
    <View style={[styles.card, card, style]}>
      {stage.myRole === 'audience' || stage.stage?.mode === 'meeting' ? (
        <View style={styles.row}>
          <Button
            label={stage.handRaised ? 'Lower hand' : 'Raise hand'}
            primary={!stage.handRaised}
            disabled={stage.pending}
            onPress={() => void (stage.handRaised ? stage.lowerHand() : stage.raiseHand())}
          />
          {stage.handRaised ? (
            <Text style={[styles.small, muted]}>The moderator sees your hand.</Text>
          ) : null}
        </View>
      ) : null}

      {mod && hands.length > 0 ? (
        <View style={styles.section}>
          <Header title="Raised hands" count={hands.length} />
          {hands.map((h) => (
            <PersonRow
              key={h.userId}
              seed={h.userId}
              name={label(h.userId)}
              guest={byId.get(h.userId)?.guest}
              avatarUrl={byId.get(h.userId)?.avatarUrl}
            >
              {stage.stage?.mode === 'stage' && stage.roleOf(h.userId) === 'audience' ? (
                <Button
                  label="Bring up"
                  primary
                  onPress={() => void stage.setRole(h.userId, 'speaker')}
                  accessibilityLabel={`Bring ${nameOf(h.userId, byId.get(h.userId)?.name)} up`}
                />
              ) : null}
              <Button label="Lower" onPress={() => void stage.lowerHand(h.userId)} />
            </PersonRow>
          ))}
        </View>
      ) : null}

      <View style={styles.section}>
        <Header
          title={stage.stage?.mode === 'stage' ? 'On stage' : 'In the call'}
          count={speakers.length}
        />
        {speakers.map((p) => (
          <PersonRow
            key={p.userId}
            seed={p.userId}
            name={label(p.userId)}
            guest={p.guest}
            avatarUrl={p.avatarUrl}
            extra={stage.roleOf(p.userId) === 'moderator' ? 'Moderator' : null}
          >
            {mod && !isSelf(p.userId) && stage.stage?.mode === 'stage' ? (
              <Button
                label="Move to audience"
                onPress={() => void stage.setRole(p.userId, 'audience')}
              />
            ) : null}
          </PersonRow>
        ))}
      </View>

      {stage.stage?.mode === 'stage' ? (
        <View style={styles.section}>
          <Header title="Audience" count={audience.length} />
          {audience.length === 0 ? (
            <Text style={[styles.small, muted]}>Nobody in the audience yet.</Text>
          ) : null}
          {audience.map((p) => (
            <PersonRow
              key={p.userId}
              seed={p.userId}
              name={label(p.userId)}
              guest={p.guest}
              avatarUrl={p.avatarUrl}
            >
              {mod ? (
                <Button label="Bring up" onPress={() => void stage.setRole(p.userId, 'speaker')} />
              ) : null}
            </PersonRow>
          ))}
        </View>
      ) : null}
      {stage.error ? <ErrorLine error={stage.error} /> : null}
    </View>
  );
}

function ErrorLine({ error }: { error: Error }) {
  const { theme } = useText();
  return (
    <Text
      style={[styles.small, { color: theme.colors.danger, fontFamily: theme.fonts.body }]}
      accessibilityRole="alert"
      numberOfLines={2}
    >
      {friendly(error)}
    </Text>
  );
}

function friendly(error: Error): string {
  const m = error.message;
  if (/forbidden|403/.test(m)) return 'You can’t do that in this call.';
  if (/rate_limited|429/.test(m)) return 'Too many tries — wait a moment.';
  if (/network|fetch|timeout/i.test(m)) return 'No connection. Try again.';
  return 'Something went wrong. Try again.';
}

// ── Q&A (CL3) ────────────────────────────────────────────────────────────

export interface QuestionsPanelProps {
  questions: UseQuestions;
  /** Show Answered / Dismiss on open questions. */
  canModerate?: boolean;
  /** Offer "Ask anonymously". Defaults to true. */
  allowAnonymous?: boolean;
  nameForUserId?: NameFor;
  style?: StyleProp<ViewStyle>;
}

/** Ask a question, upvote others', and (moderators) mark them answered. */
export function QuestionsPanel({
  questions,
  canModerate = false,
  allowAnonymous = true,
  nameForUserId,
  style,
}: QuestionsPanelProps) {
  const { theme, card, text, muted } = useText();
  const nameOf = useNamer(nameForUserId);
  const [draft, setDraft] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const submit = async () => {
    if (!draft.trim()) return;
    if (await questions.ask(draft, { anonymous })) setDraft('');
  };
  const open = questions.questions.filter((q) => q.status === 'open');
  const answered = questions.questions.filter((q) => q.status === 'answered');

  const row = (q: Question) => (
    <View key={q.id} style={[styles.question, { borderColor: theme.colors.border }]}>
      <Pressable
        onPress={() => void questions.toggleVote(q.id)}
        disabled={q.status !== 'open'}
        accessibilityRole="button"
        accessibilityState={{ selected: q.votedByMe, disabled: q.status !== 'open' }}
        accessibilityLabel={`${q.votes} ${q.votes === 1 ? 'vote' : 'votes'}${q.votedByMe ? ', you voted' : ''}. ${q.votedByMe ? 'Remove your vote' : 'Vote up'}`}
        hitSlop={6}
        style={[
          styles.vote,
          {
            borderRadius: theme.radii.md,
            backgroundColor: q.votedByMe ? theme.colors.accentSoft : theme.colors.surfaceAlt,
          },
        ]}
      >
        <PoolseIcon
          name="chevron-up"
          size={16}
          color={q.votedByMe ? theme.colors.accentStrong : theme.colors.textMuted}
        />
        <Text
          style={[
            styles.voteCount,
            { color: q.votedByMe ? theme.colors.accentStrong : theme.colors.text },
          ]}
        >
          {q.votes}
        </Text>
      </Pressable>
      <View style={styles.grow}>
        <Text style={[styles.body, text]}>{q.text}</Text>
        <Text style={[styles.small, muted]} numberOfLines={1}>
          {q.author ? nameOf(q.author.userId, q.author.displayName) : 'Anonymous'}
          {q.status === 'answered' ? ' · Answered' : ''}
        </Text>
        {canModerate && q.status === 'open' ? (
          <View style={[styles.inline, styles.gapTop]}>
            <Button label="Answered" onPress={() => void questions.setStatus(q.id, 'answered')} />
            <Button label="Dismiss" onPress={() => void questions.setStatus(q.id, 'dismissed')} />
          </View>
        ) : null}
      </View>
    </View>
  );

  return (
    <View style={[styles.card, card, style]}>
      <TextInput
        value={draft}
        onChangeText={setDraft}
        placeholder="Ask a question"
        placeholderTextColor={theme.colors.textSubtle}
        maxLength={QUESTION_MAX}
        multiline
        accessibilityLabel="Your question"
        style={[
          styles.input,
          text,
          { borderColor: theme.colors.border, borderRadius: theme.radii.md },
        ]}
      />
      <View style={styles.row}>
        {allowAnonymous ? (
          <View style={[styles.inline, styles.grow]}>
            <Switch
              value={anonymous}
              onValueChange={setAnonymous}
              accessibilityLabel="Ask anonymously"
            />
            <Text style={[styles.small, muted]}>Anonymous</Text>
          </View>
        ) : (
          <View style={styles.grow} />
        )}
        <Button
          label="Ask"
          primary
          disabled={!draft.trim() || questions.pending}
          onPress={() => void submit()}
        />
      </View>
      {questions.error ? <ErrorLine error={questions.error} /> : null}
      <View style={styles.section}>
        <Header title="Questions" count={open.length} />
        {open.length === 0 ? <Text style={[styles.small, muted]}>No questions yet.</Text> : null}
        {open.map(row)}
      </View>
      {answered.length > 0 ? (
        <View style={styles.section}>
          <Header title="Answered" count={answered.length} />
          {answered.map(row)}
        </View>
      ) : null}
    </View>
  );
}

// ── Breakouts (CL5) ──────────────────────────────────────────────────────

export interface BreakoutBannerProps {
  breakouts: UseBreakouts;
  /** You are in your breakout room now (not the main call). */
  inBreakout?: boolean;
  /** Connect to the room's session (switch the call's media to it). */
  onJoined?: (session: RoomSession) => void;
  /** Connect back to the main call. */
  onReturned?: (session: RoomSession) => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * "Breakout · Room 2 · 12:30 left · Join room", then "Return to main";
 * while closing, "Returning to the main call in 0:45". Nothing without a
 * session or a room for you.
 */
export function BreakoutBanner({
  breakouts,
  inBreakout = false,
  onJoined,
  onReturned,
  style,
}: BreakoutBannerProps) {
  const { theme, text, muted, card } = useText();
  const s = breakouts.session;
  const room = breakouts.myRoom;
  if (!s || (!room && s.status !== 'closing')) return null;
  const left = breakouts.secondsLeft;
  const closing = s.status === 'closing';
  const line = closing
    ? `Returning to the main call${left !== null ? ` in ${formatCountdown(left)}` : ''}`
    : `${room?.name ?? 'Breakout'}${left !== null ? ` · ${formatCountdown(left)} left` : ''}`;
  return (
    <View
      style={[
        styles.banner,
        card,
        { borderColor: closing ? theme.colors.warning : theme.colors.border },
        style,
      ]}
      accessibilityRole="summary"
      accessibilityLiveRegion="polite"
    >
      <PoolseIcon name="users" size={18} color={theme.colors.textMuted} />
      <View style={styles.grow}>
        <Text style={[styles.small, muted]}>Breakout rooms</Text>
        <Text style={[styles.body, text]} numberOfLines={1}>
          {line}
        </Text>
      </View>
      {room && !inBreakout && !closing ? (
        <Button
          label="Join room"
          primary
          disabled={breakouts.pending}
          onPress={async () => {
            const session = await breakouts.join(room.id);
            if (session) onJoined?.(session);
          }}
        />
      ) : null}
      {inBreakout ? (
        <Button
          label="Return to main"
          disabled={breakouts.pending}
          onPress={async () => {
            const session = await breakouts.returnToMain();
            if (session) onReturned?.(session);
          }}
        />
      ) : null}
    </View>
  );
}

// ── Lobby (CL10) ─────────────────────────────────────────────────────────

export interface LobbyWaitingProps {
  /** The name the guest gave. */
  name: string;
  /** Where the guest stands (`waitInLobby`'s status). */
  status: GuestLobbyStatus['status'];
  /** The meeting's title, when known. */
  title?: string | null;
  onLeave: () => void;
  style?: StyleProp<ViewStyle>;
}

/** A guest's waiting screen: "Waiting for the host to let you in", then denied or ended. */
export function LobbyWaiting({ name, status, title, onLeave, style }: LobbyWaitingProps) {
  const { theme, text, muted } = useText();
  const headline =
    status === 'denied'
      ? 'The host didn’t let you in'
      : status === 'ended'
        ? 'This meeting has ended'
        : status === 'admitted'
          ? 'You’re in — joining…'
          : 'Waiting for the host to let you in';
  return (
    <View style={[styles.lobby, style]} accessibilityLiveRegion="polite">
      {status === 'waiting' || status === 'admitted' ? (
        <ActivityIndicator color={theme.colors.accent} />
      ) : null}
      {title ? (
        <Text style={[styles.small, muted]} numberOfLines={2}>
          {title}
        </Text>
      ) : null}
      <Text
        style={[styles.headline, text, { fontFamily: theme.fonts.display }]}
        accessibilityRole="header"
      >
        {headline}
      </Text>
      <View style={styles.inline}>
        <Text style={[styles.body, muted, styles.shrink]} numberOfLines={1}>
          Joining as {name.trim() || 'Guest'}
        </Text>
        <GuestMark />
      </View>
      <Button label={status === 'waiting' ? 'Leave' : 'Close'} onPress={onLeave} />
    </View>
  );
}

export interface LobbyAdmitListProps {
  lobby: UseLobby;
  style?: StyleProp<ViewStyle>;
}

/** For members: who is waiting, with Admit / Deny and Admit all. Nothing when nobody waits. */
export function LobbyAdmitList({ lobby, style }: LobbyAdmitListProps) {
  const { card } = useText();
  const waiting = lobby.lobby?.waiting ?? [];
  if (waiting.length === 0) return null;
  return (
    <View style={[styles.card, card, style]} accessibilityLiveRegion="polite">
      <View style={styles.row}>
        <View style={styles.grow}>
          <Header title="Waiting to join" count={waiting.length} />
        </View>
        {waiting.length > 1 ? (
          <Button
            label="Admit all"
            primary
            disabled={lobby.pending}
            onPress={() => void lobby.admitAll()}
          />
        ) : null}
      </View>
      {waiting.map((e) => (
        <PersonRow key={e.id} seed={e.id} name={e.name} guest={e.guest}>
          <Button
            label="Admit"
            primary
            disabled={lobby.pending}
            onPress={() => void lobby.admit(e.id)}
            accessibilityLabel={`Admit ${e.name}`}
          />
          <Button
            label="Deny"
            disabled={lobby.pending}
            onPress={() => void lobby.deny(e.id)}
            accessibilityLabel={`Deny ${e.name}`}
          />
        </PersonRow>
      ))}
      {lobby.error ? <ErrorLine error={lobby.error} /> : null}
    </View>
  );
}

// ── Mark a moment (CL14) ─────────────────────────────────────────────────

export interface MarkMomentButtonProps {
  moments: UseMoments;
  /** Icon only (a call control); the label is still read out. */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** "Mark moment": highlights this point in the recording and the summary; says "Marked" for 2 s. */
export function MarkMomentButton({ moments, compact = false, style }: MarkMomentButtonProps) {
  const { theme } = useText();
  const [marked, setMarked] = useState(false);
  useEffect(() => {
    if (!marked) return;
    const t = setTimeout(() => setMarked(false), 2000);
    return () => clearTimeout(t);
  }, [marked]);
  const label = marked ? 'Marked' : 'Mark moment';
  return (
    <Pressable
      onPress={async () => {
        if (await moments.mark()) setMarked(true);
      }}
      disabled={moments.pending}
      accessibilityRole="button"
      accessibilityLabel={marked ? 'Moment marked' : 'Mark this moment as important'}
      accessibilityLiveRegion="polite"
      hitSlop={6}
      style={({ pressed }) => [
        styles.btn,
        styles.inline,
        {
          backgroundColor: marked ? theme.colors.accentSoft : theme.colors.surfaceAlt,
          borderRadius: theme.radii.pill,
        },
        pressed && styles.pressed,
        style,
      ]}
    >
      <PoolseIcon
        name={marked ? 'check' : 'pin'}
        size={16}
        color={marked ? theme.colors.accentStrong : theme.colors.text}
      />
      {compact ? null : (
        <Text style={[styles.btnText, { color: theme.colors.text, fontFamily: theme.fonts.body }]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

// ── Agenda (CA5) ─────────────────────────────────────────────────────────

export interface AgendaPanelProps {
  agenda: UseAgenda;
  /** Show Start / Done / Reopen. */
  canEdit?: boolean;
  nameForUserId?: NameFor;
  style?: StyleProp<ViewStyle>;
}

/** The meeting's agenda: owner and minutes per item, the current one highlighted, an over-time nudge. */
export function AgendaPanel({ agenda, canEdit = false, nameForUserId, style }: AgendaPanelProps) {
  const { theme, card, text, muted } = useText();
  const nameOf = useNamer(nameForUserId);
  const a = agenda.agenda;
  if (!a || a.items.length === 0) return null;
  const nudge =
    agenda.current &&
    overrunText(agenda.current.title, Math.max(agenda.overrunMs, agenda.overtime?.overByMs ?? 0));
  const item = (i: AgendaItem) => {
    const current = i.id === a.currentItemId;
    const meta = [
      i.owner ? nameOf(i.owner.userId, i.owner.displayName) : null,
      i.minutes ? `${i.minutes} min` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    return (
      <View
        key={i.id}
        style={[
          styles.agendaItem,
          { borderRadius: theme.radii.md },
          current && { backgroundColor: theme.colors.accentSoft },
        ]}
        accessibilityState={{ checked: i.status === 'done', selected: current }}
      >
        <Pressable
          onPress={() =>
            canEdit && void (i.status === 'done' ? agenda.reopen(i.id) : agenda.done(i.id))
          }
          disabled={!canEdit}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: i.status === 'done', disabled: !canEdit }}
          accessibilityLabel={i.title}
          hitSlop={8}
          style={[
            styles.check,
            {
              borderColor: i.status === 'done' ? theme.colors.success : theme.colors.border,
              backgroundColor: i.status === 'done' ? theme.colors.success : 'transparent',
            },
          ]}
        >
          {i.status === 'done' ? (
            <PoolseIcon name="check" size={12} color={theme.colors.accentText} />
          ) : null}
        </Pressable>
        <View style={styles.grow}>
          <Text style={[styles.body, text, i.status === 'done' && styles.done]} numberOfLines={2}>
            {i.title}
          </Text>
          {meta ? (
            <Text style={[styles.small, muted]} numberOfLines={1}>
              {meta}
            </Text>
          ) : null}
        </View>
        {canEdit && i.status === 'pending' ? (
          <Button label="Start" onPress={() => void agenda.start(i.id)} />
        ) : null}
      </View>
    );
  };
  return (
    <View style={[styles.card, card, style]}>
      <Header title="Agenda" />
      {nudge ? (
        <Text
          style={[styles.small, { color: theme.colors.warning, fontFamily: theme.fonts.body }]}
          accessibilityRole="alert"
        >
          {nudge}
        </Text>
      ) : null}
      {a.items.map(item)}
      {agenda.error ? <ErrorLine error={agenda.error} /> : null}
    </View>
  );
}

// ── Room presence (CL2) ──────────────────────────────────────────────────

export interface RoomPresenceProps {
  /** The room's live call (`useRoomPresence(ids)[id]`); nothing renders when null or empty. */
  call: LiveCall | null | undefined;
  /** Most avatars to show; the rest become "+N". Defaults to 3. */
  max?: number;
  nameForUserId?: NameFor;
  style?: StyleProp<ViewStyle>;
}

/** Who is in a room, for a sidebar row: overlapping avatars and "+N". */
export function RoomPresence({ call, max = 3, nameForUserId, style }: RoomPresenceProps) {
  const { theme, muted } = useText();
  const nameOf = useNamer(nameForUserId);
  const people = call?.participants ?? [];
  if (people.length === 0) return null;
  const { shown, more } = avatarOverflow(people, max);
  const names = people.map((p) => nameOf(p.user_id, p.display_name));
  return (
    <View
      style={[styles.inline, style]}
      accessible
      accessibilityLabel={`${people.length} in the room: ${names.slice(0, 5).join(', ')}${people.length > 5 ? ' and others' : ''}`}
    >
      {shown.map((p, i) => (
        <View
          key={p.user_id}
          style={[
            styles.stack,
            i > 0 && styles.stackOverlap,
            { borderColor: theme.colors.surface },
          ]}
        >
          <Avatar
            name={nameOf(p.user_id, p.display_name)}
            seed={p.external_id ?? p.user_id}
            size="xs"
          />
        </View>
      ))}
      {more > 0 ? <Text style={[styles.small, muted]}>+{more}</Text> : null}
    </View>
  );
}

// ── Meeting cards (CA4, CA11) ────────────────────────────────────────────

export interface MeetingCardProps {
  card: MeetingCardData;
  /** Your user id, to find your answer in the lists. */
  meId?: string | null;
  /** Record your answer (the Workspace API); the card updates when the server rewrites the message. */
  onRsvp?: (response: RsvpResponse) => void | Promise<void>;
  /** Join the meeting's room. */
  onJoin?: (card: MeetingCardData) => void;
  nameForUserId?: NameFor;
  style?: StyleProp<ViewStyle>;
}

const RSVP_LABELS: Record<RsvpResponse, string> = {
  accepted: 'Accept',
  tentative: 'Maybe',
  declined: 'Decline',
};

/** An invite in chat: title, time, who's coming, Accept / Maybe / Decline and Join. */
export function MeetingCard({
  card,
  meId,
  onRsvp,
  onJoin,
  nameForUserId,
  style,
}: MeetingCardProps) {
  const { theme, card: cardStyle, text, muted } = useText();
  const nameOf = useNamer(nameForUserId);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const [pending, setPending] = useState<RsvpResponse | null>(null);
  const mine = pending ?? rsvpOf(card, meId);
  const when = meetingTimeText(card);
  const counts = rsvpSummary(card);
  const joinable = meetingJoinable(card, now);
  const status =
    card.status === 'live'
      ? 'Happening now'
      : card.status === 'cancelled'
        ? 'Cancelled'
        : card.status === 'ended'
          ? 'Ended'
          : null;
  return (
    <View style={[styles.card, cardStyle, style]}>
      <View style={styles.inline}>
        <PoolseIcon
          name={card.media === 'video' ? 'video' : 'phone'}
          size={16}
          color={theme.colors.textMuted}
        />
        <Text
          style={[styles.title, text, styles.shrink]}
          numberOfLines={2}
          accessibilityRole="header"
        >
          {card.title}
        </Text>
      </View>
      {when ? <Text style={[styles.small, muted]}>{when}</Text> : null}
      {status ? (
        <Text
          style={[
            styles.small,
            {
              color: card.status === 'live' ? theme.colors.success : theme.colors.textMuted,
              fontFamily: theme.fonts.body,
            },
          ]}
        >
          {status}
        </Text>
      ) : null}
      {card.organizer ? (
        <Text style={[styles.small, muted]} numberOfLines={1}>
          Organised by {nameOf(card.organizer.userId, card.organizer.displayName)}
        </Text>
      ) : null}
      {counts ? <Text style={[styles.small, muted]}>{counts}</Text> : null}
      {card.status !== 'cancelled' && card.status !== 'ended' ? (
        <View style={[styles.inline, styles.wrap, styles.gapTop]}>
          {onRsvp
            ? (['accepted', 'tentative', 'declined'] as const).map((r) => (
                <Pressable
                  key={r}
                  onPress={async () => {
                    setPending(r);
                    try {
                      await onRsvp(r);
                    } finally {
                      setPending(null);
                    }
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: mine === r }}
                  accessibilityLabel={RSVP_LABELS[r]}
                  hitSlop={4}
                  style={[
                    styles.btn,
                    {
                      borderRadius: theme.radii.pill,
                      borderWidth: 1,
                      borderColor: mine === r ? theme.colors.accent : theme.colors.border,
                      backgroundColor: mine === r ? theme.colors.accentSoft : 'transparent',
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.btnText,
                      {
                        color: mine === r ? theme.colors.accentStrong : theme.colors.text,
                        fontFamily: theme.fonts.body,
                      },
                    ]}
                  >
                    {RSVP_LABELS[r]}
                  </Text>
                </Pressable>
              ))
            : null}
          {onJoin ? (
            <Button
              label="Join"
              primary
              disabled={!joinable}
              onPress={() => onJoin(card)}
              accessibilityLabel={`Join ${card.title}`}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export interface MeetingCardMessageRowProps extends Omit<MeetingCardProps, 'card'> {
  msg: Message;
}

/** A meeting-card message in a list; nothing for any other message. */
export function MeetingCardMessageRow({ msg, ...rest }: MeetingCardMessageRowProps) {
  const card = useMemo(() => meetingCardOf(msg), [msg]);
  if (!card) return null;
  return (
    <View style={styles.cardRow}>
      <MeetingCard card={card} {...rest} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, padding: 12, gap: 8 },
  cardRow: { paddingHorizontal: 12, paddingVertical: 4 },
  section: { gap: 6, marginTop: 4 },
  sectionTitle: { fontSize: 11, fontWeight: '600', letterSpacing: 0.6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  wrap: { flexWrap: 'wrap' },
  grow: { flex: 1, minWidth: 0 },
  shrink: { flexShrink: 1 },
  gapTop: { marginTop: 4 },
  body: { fontSize: 15, lineHeight: 20 },
  small: { fontSize: 13, lineHeight: 18 },
  title: { fontSize: 16, fontWeight: '600' },
  headline: { fontSize: 20, fontWeight: '600', textAlign: 'center' },
  btn: { paddingHorizontal: 12, paddingVertical: 7, minHeight: 32, justifyContent: 'center' },
  btnText: { fontSize: 14, fontWeight: '500' },
  pressed: { opacity: 0.7 },
  guest: { fontSize: 11, borderWidth: 1, paddingHorizontal: 4, overflow: 'hidden' },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40 },
  personName: { flex: 1, minWidth: 0 },
  question: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  vote: { alignItems: 'center', width: 40, paddingVertical: 4 },
  voteCount: { fontSize: 13, fontWeight: '600' },
  input: {
    borderWidth: 1,
    minHeight: 44,
    maxHeight: 120,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
  },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderWidth: 1 },
  lobby: { alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 },
  agendaItem: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8 },
  check: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  done: { textDecorationLine: 'line-through', opacity: 0.6 },
  stack: { borderWidth: 2, borderRadius: 12 },
  stackOverlap: { marginLeft: -12 },
});
