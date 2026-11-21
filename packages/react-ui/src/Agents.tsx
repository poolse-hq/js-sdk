// Agents in chat: the approval card (AG4) and the sources under an
// assistant's answer (AG5). Same props in @poolse/react-native.
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

import { AgentBadge } from './AgentBadge.js';
import { useMessageExtras } from './messageExtras.js';
import { PoolseIcon } from './PoolseIcon.js';

export interface ApprovalCardProps {
  /** The request — from `parseApproval(message)` or `useApprovals()`. */
  approval: AgentApproval;
  /** The agent's name when the request leaves it out (e.g. the message's sender). */
  agentName?: string | null;
  /** After an answer went through. */
  onDecided?: (approval: AgentApproval) => void;
  /** How many detail lines show before "Show all". Defaults to 4. */
  maxDetails?: number;
  className?: string;
}

/**
 * An agent asking before it does something outside the chat — send an
 * email, create an issue, book a meeting. One tap approves or denies; a
 * reason is optional. Follows the shared approvals store, so an answer
 * given anywhere (another device, the pending list) shows here at once.
 */
export function ApprovalCard({
  approval: initial,
  agentName,
  onDecided,
  maxDetails = 4,
  className,
}: ApprovalCardProps) {
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
    <section
      className={['poolse-approval', `poolse-approval--${status}`, className]
        .filter(Boolean)
        .join(' ')}
      aria-label={`Approval request from ${name}`}
    >
      <header className="poolse-approval__head">
        <span className="poolse-approval__agent" title={name}>
          {name}
        </span>
        <AgentBadge size="xs" />
        <span className={`poolse-approval__status poolse-approval__status--${status}`}>
          {approvalStatusLabel(status)}
        </span>
      </header>
      <p className="poolse-approval__summary">{approval.summary}</p>
      {details.length > 0 && (
        <dl className="poolse-approval__details">
          {details.map((d, i) =>
            d.label ? (
              <div key={i} className="poolse-approval__detail">
                <dt>{d.label}</dt>
                <dd>{d.value}</dd>
              </div>
            ) : (
              <div key={i} className="poolse-approval__detail poolse-approval__detail--text">
                <dd>{d.value}</dd>
              </div>
            ),
          )}
        </dl>
      )}
      {approval.details.length > maxDetails && (
        <button
          type="button"
          className="poolse-approval__more"
          onClick={() => setAllDetails((v) => !v)}
          aria-expanded={allDetails}
        >
          {allDetails ? 'Show less' : `Show all ${approval.details.length} details`}
        </button>
      )}
      {open && approval.expiresAt && (
        <p className="poolse-approval__expiry">Expires {formatShortTime(approval.expiresAt)}</p>
      )}
      {!open && approval.reason && (
        <p className="poolse-approval__reason">
          <span>Reason:</span> {approval.reason}
        </p>
      )}
      {open && reasonOpen && (
        <textarea
          className="poolse-approval__reason-input"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={APPROVAL_REASON_MAX}
          rows={2}
          placeholder="Reason (optional)"
          aria-label="Reason"
          disabled={!!pending}
          autoFocus
        />
      )}
      {open && (
        <div className="poolse-approval__actions">
          <button
            type="button"
            className="poolse-approval__btn poolse-approval__btn--approve"
            onClick={() => void answer('approve')}
            disabled={!!pending}
          >
            {pending === 'approve' ? 'Approving…' : 'Approve'}
          </button>
          <button
            type="button"
            className="poolse-approval__btn"
            onClick={() => void answer('deny')}
            disabled={!!pending}
          >
            {pending === 'deny' ? 'Denying…' : 'Deny'}
          </button>
          {!reasonOpen && (
            <button
              type="button"
              className="poolse-approval__link"
              onClick={() => setReasonOpen(true)}
              disabled={!!pending}
            >
              Add a reason
            </button>
          )}
        </div>
      )}
      {error && (
        <p className="poolse-approval__error" role="alert">
          {approvalErrorMessage(error)}
        </p>
      )}
    </section>
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
    <div className="poolse-card-row" data-message-id={msg.id} role="article" tabIndex={-1}>
      <ApprovalCard approval={approval} agentName={profile?.displayName ?? null} />
    </div>
  );
}

export interface ApprovalListProps {
  /** Shown when nothing is waiting. */
  emptyState?: ReactNode;
  /** Re-list every so often as a fallback to live events (ms; 0 = never). Defaults to 60 s. */
  pollMs?: number;
  className?: string;
}

/** Everything waiting for your approval, newest first, live. */
export function ApprovalList({ emptyState, pollMs, className }: ApprovalListProps) {
  const { approvals, loading, error } = useApprovals(pollMs !== undefined ? { pollMs } : {});
  return (
    <div className={['poolse-approval-list', className].filter(Boolean).join(' ')}>
      {loading && approvals.length === 0 ? (
        <p className="poolse-approval-list__empty">Loading…</p>
      ) : error && approvals.length === 0 ? (
        <p className="poolse-approval-list__empty" role="alert">
          {approvalErrorMessage(error)}
        </p>
      ) : approvals.length === 0 ? (
        <p className="poolse-approval-list__empty">
          {emptyState ?? 'Nothing is waiting for your approval.'}
        </p>
      ) : (
        approvals.map((a) => <ApprovalCard key={a.id} approval={a} />)
      )}
    </div>
  );
}

export interface MessageCitationsProps {
  message: Message;
  /** Defaults to `citationsOf(message)`. */
  citations?: Citation[];
  /** Defaults to the `MessageExtrasProvider`'s `onOpenCitation`. */
  onOpenCitation?: (citation: Citation, message: Message) => void;
  className?: string;
}

/**
 * The sources of an assistant's answer as links: a message (focus it),
 * a file, or a moment of a meeting (with its time). Plain text when
 * nothing handles a press.
 */
export function MessageCitations({
  message,
  citations,
  onOpenCitation,
  className,
}: MessageCitationsProps) {
  const extras = useMessageExtras();
  const list = citations ?? citationsOf(message);
  const open = onOpenCitation ?? extras.onOpenCitation;
  if (list.length === 0) return null;
  return (
    <nav className={['poolse-citations', className].filter(Boolean).join(' ')} aria-label="Sources">
      <span className="poolse-citations__title">Sources</span>
      <ol className="poolse-citations__list">
        {list.map((c, i) => {
          const time =
            c.type === 'transcript' && c.startMs !== null ? formatClock(c.startMs) : null;
          const content = (
            <>
              <span className="poolse-citations__num" aria-hidden="true">
                {i + 1}
              </span>
              <PoolseIcon name={CITATION_ICON[c.type]} size={13} label={null} />
              <span className="poolse-citations__text">{citationLabel(c)}</span>
              {time && <span className="poolse-citations__time">{time}</span>}
            </>
          );
          return (
            <li key={`${c.type}-${c.id}-${i}`}>
              {open ? (
                <button
                  type="button"
                  className="poolse-citations__link"
                  onClick={(e) => {
                    e.stopPropagation();
                    open(c, message);
                  }}
                  title={citationLabel(c)}
                  aria-label={`${CITATION_KIND[c.type]}${time ? ` at ${time}` : ''}: ${citationLabel(c)}`}
                >
                  {content}
                </button>
              ) : (
                <span className="poolse-citations__link poolse-citations__link--static">
                  {content}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

const CITATION_ICON = { message: 'message', file: 'attachment', transcript: 'mic' } as const;
const CITATION_KIND = { message: 'Message', file: 'File', transcript: 'Meeting' } as const;

/** True once a pending approval's `expiresAt` has passed (re-checked each 30 s). */
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

function formatShortTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? `at ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
    : d.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
}
