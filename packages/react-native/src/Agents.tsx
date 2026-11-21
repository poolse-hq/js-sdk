// Agents in chat: the approval card (AG4) and the sources under an
// assistant's answer (AG5). Same props as @poolse/react-ui.
//
//     <ApprovalCard approval={a} />          // approve / deny, with a reason
//     <ApprovalList />                       // everything waiting for you
//     <MessageCitations message={msg} />     // links under an answer

import type { AgentApproval, Citation, Message } from '@poolse/sdk';
import {
  APPROVAL_REASON_MAX,
  approvalErrorMessage,
  approvalStatusLabel,
  citationLabel,
  citationsOf,
  formatClock,
  parseApproval,
  useApproval,
  useApprovals,
  useUser,
} from '@poolse/react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
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

import { AgentBadge, withAlpha } from './AgentBadge.js';
import { useMessageExtras } from './messageExtras.js';
import { PoolseIcon } from './primitives/PoolseIcon.js';
import { useTheme } from './theme/PoolseTheme.js';

export interface ApprovalCardProps {
  /** The request — from `parseApproval(message)` or `useApprovals()`. */
  approval: AgentApproval;
  /** The agent's name when the request leaves it out (e.g. the message's sender). */
  agentName?: string | null;
  /** After an answer went through. */
  onDecided?: (approval: AgentApproval) => void;
  /** How many detail lines show before "Show all". Defaults to 4. */
  maxDetails?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * An agent asking before it does something outside the chat. One tap
 * approves or denies; a reason is optional. Follows the shared
 * approvals store, so an answer given anywhere shows here at once.
 */
export function ApprovalCard({
  approval: initial,
  agentName,
  onDecided,
  maxDetails = 4,
  style,
}: ApprovalCardProps) {
  const theme = useTheme();
  const { approval: live, pending, error, approve, deny } = useApproval(initial);
  const approval = live ?? initial;
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [allDetails, setAllDetails] = useState(false);
  const expired = useExpired(approval);
  const status = approval.status === 'pending' && expired ? 'expired' : approval.status;
  const open = status === 'pending';
  const name = approval.agent?.name ?? agentName ?? 'An agent';
  const details = allDetails ? approval.details : approval.details.slice(0, maxDetails);
  const statusColor =
    status === 'approved'
      ? theme.colors.success
      : status === 'denied'
        ? theme.colors.danger
        : status === 'pending'
          ? theme.colors.warning
          : theme.colors.textMuted;
  const text = { color: theme.colors.text, fontFamily: theme.fonts.body };
  const subtle = { color: theme.colors.textSubtle, fontFamily: theme.fonts.body };

  const answer = async (action: 'approve' | 'deny') => {
    const r = reason.trim() || undefined;
    try {
      await (action === 'approve' ? approve(r) : deny(r));
      setReasonOpen(false);
      setReason('');
      onDecided?.(approval);
    } catch {
      // Shown from `error` below.
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
      accessibilityLabel={`Approval request from ${name}`}
    >
      <View style={styles.head}>
        <Text style={[styles.agent, text]} numberOfLines={1}>
          {name}
        </Text>
        <AgentBadge size="xs" />
        <View style={[styles.status, { backgroundColor: withAlpha(statusColor, 0.14) }]}>
          <Text style={[styles.statusText, { color: statusColor }]} numberOfLines={1}>
            {approvalStatusLabel(status)}
          </Text>
        </View>
      </View>
      <Text style={[styles.summary, text]}>{approval.summary}</Text>
      {details.length > 0 ? (
        <View style={styles.details}>
          {details.map((d, i) => (
            <View key={i} style={d.label ? styles.detail : null}>
              {d.label ? (
                <Text style={[styles.detailLabel, subtle]} numberOfLines={1}>
                  {d.label}
                </Text>
              ) : null}
              <Text style={[styles.detailValue, text]} numberOfLines={8}>
                {d.value}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {approval.details.length > maxDetails ? (
        <Pressable onPress={() => setAllDetails((v) => !v)} accessibilityRole="button" hitSlop={6}>
          <Text style={[styles.link, { color: theme.colors.link }]}>
            {allDetails ? 'Show less' : `Show all ${approval.details.length} details`}
          </Text>
        </Pressable>
      ) : null}
      {!open && approval.reason ? (
        <Text style={[styles.note, subtle]}>Reason: {approval.reason}</Text>
      ) : null}
      {open && reasonOpen ? (
        <TextInput
          value={reason}
          onChangeText={setReason}
          maxLength={APPROVAL_REASON_MAX}
          multiline
          placeholder="Reason (optional)"
          placeholderTextColor={theme.colors.textSubtle}
          accessibilityLabel="Reason"
          editable={!pending}
          autoFocus
          style={[
            styles.input,
            text,
            { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border },
          ]}
        />
      ) : null}
      {open ? (
        <View style={styles.actions}>
          <Pressable
            onPress={() => void answer('approve')}
            disabled={!!pending}
            accessibilityRole="button"
            accessibilityState={{ disabled: !!pending }}
            style={({ pressed }) => [
              styles.btn,
              { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
              (pressed || !!pending) && styles.pressed,
            ]}
          >
            <Text style={[styles.btnText, { color: theme.colors.accentText }]}>
              {pending === 'approve' ? 'Approving…' : 'Approve'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => void answer('deny')}
            disabled={!!pending}
            accessibilityRole="button"
            accessibilityState={{ disabled: !!pending }}
            style={({ pressed }) => [
              styles.btn,
              { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border },
              (pressed || !!pending) && styles.pressed,
            ]}
          >
            <Text style={[styles.btnText, text]}>{pending === 'deny' ? 'Denying…' : 'Deny'}</Text>
          </Pressable>
          {!reasonOpen ? (
            <Pressable
              onPress={() => setReasonOpen(true)}
              disabled={!!pending}
              accessibilityRole="button"
              hitSlop={8}
            >
              <Text style={[styles.link, { color: theme.colors.link }]}>Add a reason</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {error ? (
        <Text style={[styles.note, { color: theme.colors.danger }]} accessibilityRole="alert">
          {approvalErrorMessage(error)}
        </Text>
      ) : null}
    </View>
  );
}

export interface ApprovalMessageRowProps {
  msg: Message;
  meId: string | null;
}

/** A `kind: "agent_approval"` message in a list: the card, full width. */
export function ApprovalMessageRow({ msg }: ApprovalMessageRowProps) {
  const approval = useMemo(() => parseApproval(msg), [msg]);
  const { profile } = useUser(approval?.agent?.name ? null : msg.sender_external_id);
  if (!approval) return null;
  return (
    <View style={styles.cardRow}>
      <ApprovalCard approval={approval} agentName={profile?.displayName ?? null} />
    </View>
  );
}

export interface ApprovalListProps {
  emptyState?: ReactNode;
  /** Re-list every so often as a fallback to live events (ms; 0 = never). Defaults to 60 s. */
  pollMs?: number;
  style?: StyleProp<ViewStyle>;
}

/** Everything waiting for your approval, newest first, live. */
export function ApprovalList({ emptyState, pollMs, style }: ApprovalListProps) {
  const theme = useTheme();
  const { approvals, loading, error } = useApprovals(pollMs !== undefined ? { pollMs } : {});
  const subtle = { color: theme.colors.textSubtle, fontFamily: theme.fonts.body };
  return (
    <ScrollView style={style} contentContainerStyle={styles.list}>
      {loading && approvals.length === 0 ? (
        <Text style={[styles.empty, subtle]}>Loading…</Text>
      ) : error && approvals.length === 0 ? (
        <Text style={[styles.empty, subtle]}>{approvalErrorMessage(error)}</Text>
      ) : approvals.length === 0 ? (
        typeof emptyState === 'string' || emptyState === undefined ? (
          <Text style={[styles.empty, subtle]}>
            {emptyState ?? 'Nothing is waiting for your approval.'}
          </Text>
        ) : (
          emptyState
        )
      ) : (
        approvals.map((a) => <ApprovalCard key={a.id} approval={a} />)
      )}
    </ScrollView>
  );
}

export interface MessageCitationsProps {
  message: Message;
  /** Defaults to `citationsOf(message)`. */
  citations?: Citation[];
  /** Defaults to the `MessageExtrasProvider`'s `onOpenCitation`. */
  onOpenCitation?: (citation: Citation, message: Message) => void;
  /** `onBrand` inside your own (coloured) bubble. */
  tone?: 'default' | 'onBrand';
  style?: StyleProp<ViewStyle>;
}

/** The sources of an assistant's answer as links. Plain text when nothing handles a press. */
export function MessageCitations({
  message,
  citations,
  onOpenCitation,
  tone = 'default',
  style,
}: MessageCitationsProps) {
  const theme = useTheme();
  const extras = useMessageExtras();
  const list = citations ?? citationsOf(message);
  const open = onOpenCitation ?? extras.onOpenCitation;
  if (list.length === 0) return null;
  const linkColor = tone === 'onBrand' ? theme.colors.ownBubbleText : theme.colors.link;
  const muted = tone === 'onBrand' ? theme.colors.ownBubbleText : theme.colors.textSubtle;
  return (
    <View style={[styles.citations, { borderColor: theme.colors.border }, style]}>
      <Text style={[styles.citationsTitle, { color: muted }]}>SOURCES</Text>
      {list.map((c, i) => {
        const time = c.type === 'transcript' && c.startMs !== null ? formatClock(c.startMs) : null;
        const label = citationLabel(c);
        const row = (
          <View style={styles.citation}>
            <Text style={[styles.citationNum, { color: muted }]}>{i + 1}</Text>
            <PoolseIcon
              name={CITATION_ICON[c.type]}
              size={13}
              color={open ? linkColor : muted}
              label={null}
            />
            <Text
              style={[
                styles.citationText,
                { color: open ? linkColor : muted, fontFamily: theme.fonts.body },
              ]}
              numberOfLines={1}
            >
              {label}
            </Text>
            {time ? <Text style={[styles.citationTime, { color: muted }]}>{time}</Text> : null}
          </View>
        );
        return open ? (
          <Pressable
            key={`${c.type}-${c.id}-${i}`}
            onPress={() => open(c, message)}
            accessibilityRole="link"
            accessibilityLabel={`${CITATION_KIND[c.type]}${time ? ` at ${time}` : ''}: ${label}`}
            hitSlop={4}
          >
            {row}
          </Pressable>
        ) : (
          <View key={`${c.type}-${c.id}-${i}`}>{row}</View>
        );
      })}
    </View>
  );
}

const CITATION_ICON = { message: 'message', file: 'attachment', transcript: 'mic' } as const;
const CITATION_KIND = { message: 'Message', file: 'File', transcript: 'Meeting' } as const;

function useExpired(a: AgentApproval): boolean {
  const at = a.expiresAt ? Date.parse(a.expiresAt) : NaN;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (a.status !== 'pending' || !Number.isFinite(at)) return;
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [a.status, at]);
  return Number.isFinite(at) && at <= now;
}

const styles = StyleSheet.create({
  cardRow: { paddingHorizontal: 12, paddingVertical: 6, alignItems: 'stretch' },
  card: { borderWidth: 1, padding: 12, maxWidth: 520, width: '100%' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  agent: { flexShrink: 1, fontSize: 13, fontWeight: '700' },
  status: { marginLeft: 'auto', paddingHorizontal: 8, paddingVertical: 1, borderRadius: 999 },
  statusText: { fontSize: 11, fontWeight: '600' },
  summary: { marginTop: 8, fontSize: 14, fontWeight: '600', lineHeight: 19 },
  details: { marginTop: 8, gap: 4 },
  detail: { flexDirection: 'row', gap: 8 },
  detailLabel: { width: 84, fontSize: 13 },
  detailValue: { flex: 1, fontSize: 13, lineHeight: 18 },
  note: { marginTop: 8, fontSize: 12 },
  input: {
    marginTop: 8,
    minHeight: 44,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    fontSize: 14,
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 10 },
  btn: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1,
  },
  btnText: { fontSize: 14, fontWeight: '600' },
  pressed: { opacity: 0.6 },
  link: { marginTop: 6, fontSize: 13, fontWeight: '600' },
  list: { padding: 12, gap: 10 },
  empty: { padding: 16, textAlign: 'center', fontSize: 13 },
  citations: {
    marginTop: 6,
    marginHorizontal: 12,
    marginBottom: 6,
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  citationsTitle: { fontSize: 10, fontWeight: '700', letterSpacing: 0.4 },
  citation: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 28 },
  citationNum: { minWidth: 14, fontSize: 12, fontWeight: '700' },
  citationText: { flex: 1, fontSize: 13 },
  citationTime: { fontSize: 12, fontVariant: ['tabular-nums'] },
});
