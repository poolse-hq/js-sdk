// Agents in calls: the agent's mark on a tile or roster row (AG13), the
// invite menu (AG13), your private whisper (AG15) and your agent's
// questions while it attends for you (AG16). Same props in
// @poolse/react-native.
//
//     const agents = useCallAgents(conversationId, callId);
//     <InviteAgentMenu callAgents={agents} />
//     <WhisperPanel whisper={useWhisper(callId)} />
//     <EscalationList />                       // or <EscalationCard escalation={e} />

import type { AgentEscalation, CallAgent, EscalationReply } from '@poolse/sdk';
import {
  ESCALATION_ANSWER_MAX,
  callAgentInviteErrorMessage,
  callAgentModeLabel,
  callAgentStateLabel,
  callAgentStateOf,
  escalationErrorMessage,
  escalationStatusLabel,
  usePoolse,
  useEscalations,
  whisperErrorMessage,
  whisperHintKindLabel,
  type UseCallAgents,
  type UseWhisper,
} from '@poolse/react';
import { useEffect, useRef, useState } from 'react';

import { AgentBadge } from './AgentBadge.js';

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

// ── the agent in a tile or row (AG13, AG14) ─────────────────────────────

export interface CallAgentTagProps {
  agent: CallAgent;
  /** Show what it's doing ("Taking notes"). Defaults to true. */
  showState?: boolean;
  /** LiveKit's speaking flag for its participant: overrides the state with "Speaking". */
  speaking?: boolean;
  className?: string;
}

/** The Agent badge with the agent's state — beside its name wherever it's listed in a call. */
export function CallAgentTag({ agent, showState = true, speaking, className }: CallAgentTagProps) {
  const state = callAgentStateOf({ ...agent, speaking: speaking ?? agent.speaking });
  return (
    <span className={cx('poolse-call-agent', className)}>
      <AgentBadge size="xs" />
      {showState ? (
        <span
          className={cx('poolse-call-agent__state', `poolse-call-agent__state--${state}`)}
          aria-live="polite"
        >
          {callAgentStateLabel(state)}
        </span>
      ) : null}
    </span>
  );
}

// ── invite (AG13) ────────────────────────────────────────────────────────

export interface InviteAgentMenuProps {
  /** `useCallAgents(conversationId, callId)`. */
  callAgents: UseCallAgents;
  /** After an invite or remove went through. */
  onDone?: () => void;
  className?: string;
}

/**
 * Bring a note-taker (silent: transcript, summary and tasks) or an
 * assistant (answers when addressed by name) into the call, or send one
 * out. Lists the agents you can see that may join calls.
 */
export function InviteAgentMenu({ callAgents, onDone, className }: InviteAgentMenuProps) {
  const { agents, available, loading, pending, error, invite, setMode, remove } = callAgents;
  const act = (fn: () => Promise<void>) => {
    fn().then(
      () => onDone?.(),
      () => undefined,
    );
  };

  return (
    <section
      className={cx('poolse-panel', 'poolse-invite-agent', className)}
      aria-label="Agents in this call"
    >
      <div className="poolse-panel__head">
        <h3 className="poolse-panel__title">Agents</h3>
      </div>
      {agents.length > 0 ? (
        <ul className="poolse-invite-agent__list">
          {agents.map((a) => (
            <li key={a.agentId} className="poolse-invite-agent__row">
              <span className="poolse-invite-agent__who">
                <span className="poolse-invite-agent__name" title={a.label}>
                  {a.label}
                </span>
                <CallAgentTag agent={a} />
                <span className="poolse-invite-agent__role">{callAgentModeLabel(a)}</span>
              </span>
              {a.mode !== 'delegate' ? (
                <span className="poolse-invite-agent__actions">
                  <button
                    type="button"
                    className="poolse-btn"
                    disabled={pending === a.agentId}
                    onClick={() =>
                      act(() =>
                        setMode(a.agentId, a.mode === 'notetaker' ? 'assistant' : 'notetaker'),
                      )
                    }
                    aria-label={
                      a.mode === 'notetaker'
                        ? `Let ${a.label} answer when named`
                        : `Make ${a.label} take notes only`
                    }
                  >
                    {a.mode === 'notetaker' ? 'Let it answer' : 'Notes only'}
                  </button>
                  <button
                    type="button"
                    className="poolse-btn"
                    disabled={pending === a.agentId}
                    onClick={() => act(() => remove(a.agentId))}
                    aria-label={`Remove ${a.label} from the call`}
                  >
                    {pending === a.agentId ? 'Removing…' : 'Remove'}
                  </button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {available.length > 0 ? (
        <ul className="poolse-invite-agent__list">
          {available.map((a) => (
            <li key={a.id} className="poolse-invite-agent__row">
              <span className="poolse-invite-agent__who">
                <span className="poolse-invite-agent__name" title={a.name}>
                  {a.name}
                </span>
                <AgentBadge size="xs" />
              </span>
              <span className="poolse-invite-agent__actions">
                <button
                  type="button"
                  className="poolse-btn poolse-btn--brand"
                  disabled={pending === a.id}
                  onClick={() => act(() => invite(a.id, 'notetaker'))}
                  aria-label={`Invite ${a.name} to take notes`}
                >
                  Take notes
                </button>
                <button
                  type="button"
                  className="poolse-btn"
                  disabled={pending === a.id}
                  onClick={() => act(() => invite(a.id, 'assistant'))}
                  aria-label={`Invite ${a.name} as an assistant`}
                >
                  Assist
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : !loading && agents.length === 0 ? (
        <p className="poolse-panel__empty">No agents can join calls yet.</p>
      ) : null}
      {error ? (
        <p className="poolse-panel__error" role="alert">
          {callAgentInviteErrorMessage(error)}
        </p>
      ) : null}
    </section>
  );
}

// ── whisper (AG15) ───────────────────────────────────────────────────────

export interface WhisperPanelProps {
  /** `useWhisper(callId)`. */
  whisper: UseWhisper;
  className?: string;
}

/**
 * Private hints during a call — facts, what you promised last time,
 * questions to raise. Only you see them; the panel says so.
 */
export function WhisperPanel({ whisper, className }: WhisperPanelProps) {
  const { on, hints, agentName, loading, pending, error, toggle } = whisper;
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [hints.length]);

  return (
    <section className={cx('poolse-panel', 'poolse-whisper', className)} aria-label="Whisper">
      <div className="poolse-panel__head">
        <h3 className="poolse-panel__title">Whisper</h3>
        <button
          type="button"
          className={cx('poolse-btn', on && 'poolse-btn--active')}
          aria-pressed={on}
          disabled={pending || loading}
          onClick={() => void toggle().catch(() => undefined)}
        >
          {on ? 'Turn off' : 'Turn on'}
        </button>
      </div>
      <p className="poolse-whisper__private">
        <span aria-hidden="true">🔒</span> Only you see this
      </p>
      {on && agentName ? (
        <p className="poolse-panel__meta" title={agentName}>
          {agentName} <AgentBadge size="xs" /> is whispering to you
        </p>
      ) : null}
      {hints.length > 0 ? (
        <ol className="poolse-whisper__list" ref={listRef}>
          {hints.map((h) => (
            <li
              key={h.id}
              className={cx('poolse-whisper__hint', `poolse-whisper__hint--${h.kind}`)}
            >
              <span className="poolse-whisper__kind">{whisperHintKindLabel(h.kind)}</span>
              <p className="poolse-whisper__text">{h.text}</p>
              {h.sources.some((src) => src.title) ? (
                <p className="poolse-whisper__sources">
                  {h.sources
                    .filter((src) => src.title)
                    .map((src) => (
                      <span
                        key={`${src.type}:${src.id}`}
                        className="poolse-whisper__source"
                        title={src.title!}
                      >
                        {src.title}
                      </span>
                    ))}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="poolse-panel__empty">
          {on
            ? 'Hints show up here as the call goes.'
            : 'Turn on to get private hints during this call.'}
        </p>
      )}
      {error ? (
        <p className="poolse-panel__error" role="alert">
          {whisperErrorMessage(error)}
        </p>
      ) : null}
    </section>
  );
}

// ── escalations (AG16) ───────────────────────────────────────────────────

export interface EscalationCardProps {
  escalation: AgentEscalation;
  /** The agent's name; defaults to the directory's, else "Your agent". */
  agentName?: string | null;
  /** The meeting's title, when the host knows it. */
  meetingTitle?: string | null;
  /** Defaults to `poolse.escalations.reply`. */
  reply?: (id: string, reply: EscalationReply) => Promise<unknown>;
  onReplied?: (escalation: AgentEscalation) => void;
  className?: string;
}

/**
 * Your agent, in a meeting for you, asking something its brief doesn't
 * cover ("They ask for 10% off — accept?"): Approve, Decline, or write
 * an answer. Answered ones show what you said.
 */
export function EscalationCard({
  escalation: e,
  agentName,
  meetingTitle,
  reply,
  onReplied,
  className,
}: EscalationCardProps) {
  const poolse = usePoolse();
  const name =
    agentName ?? (e.agentId ? poolse.agents.peek(e.agentId)?.name : null) ?? 'Your agent';
  const [text, setText] = useState('');
  const [answering, setAnswering] = useState(false);
  const [sending, setSending] = useState<'approve' | 'decline' | 'answer' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const expired = useExpired(e.expiresAt);
  const status = e.status === 'pending' && expired ? 'expired' : e.status;
  const open = status === 'pending';

  const send = async (decision: 'approve' | 'decline' | 'answer') => {
    const t = text.trim();
    if (decision === 'answer' && !t) return;
    const r: EscalationReply = decision === 'answer' ? { answer: t } : { decision };
    setSending(decision);
    setError(null);
    try {
      await (reply ? reply(e.id, r) : poolse.escalations.reply(e.id, r));
      setText('');
      setAnswering(false);
      onReplied?.(e);
    } catch (err) {
      setError(err);
    } finally {
      setSending(null);
    }
  };

  return (
    <section
      className={cx(
        'poolse-approval',
        'poolse-escalation',
        `poolse-approval--${status}`,
        className,
      )}
      aria-label={`Question from ${name}`}
    >
      <header className="poolse-approval__head">
        <span className="poolse-approval__agent" title={name}>
          {name}
        </span>
        <AgentBadge size="xs" />
        <span
          className={`poolse-approval__status poolse-approval__status--${status === 'pending' ? 'pending' : status === 'declined' || status === 'expired' ? 'declined' : 'done'}`}
        >
          {escalationStatusLabel(status)}
        </span>
      </header>
      {meetingTitle ? (
        <p className="poolse-approval__expiry" title={meetingTitle}>
          In {meetingTitle}
        </p>
      ) : null}
      <p className="poolse-approval__summary">{e.question}</p>
      {!open && e.answer ? (
        <p className="poolse-approval__reason">
          <span>You said:</span> {e.answer}
        </p>
      ) : null}
      {open && answering ? (
        <textarea
          className="poolse-approval__reason-input"
          value={text}
          onChange={(ev) => setText(ev.target.value)}
          maxLength={ESCALATION_ANSWER_MAX}
          rows={2}
          placeholder="Your answer"
          aria-label="Your answer"
          disabled={!!sending}
          autoFocus
        />
      ) : null}
      {open ? (
        <div className="poolse-approval__actions">
          {answering ? (
            <button
              type="button"
              className="poolse-approval__btn poolse-approval__btn--approve"
              disabled={!!sending || !text.trim()}
              onClick={() => void send('answer')}
            >
              {sending === 'answer' ? 'Sending…' : 'Send answer'}
            </button>
          ) : (
            <>
              {e.options.includes('approve') ? (
                <button
                  type="button"
                  className="poolse-approval__btn poolse-approval__btn--approve"
                  disabled={!!sending}
                  onClick={() => void send('approve')}
                >
                  {sending === 'approve' ? 'Approving…' : 'Approve'}
                </button>
              ) : null}
              {e.options.includes('decline') ? (
                <button
                  type="button"
                  className="poolse-approval__btn"
                  disabled={!!sending}
                  onClick={() => void send('decline')}
                >
                  {sending === 'decline' ? 'Declining…' : 'Decline'}
                </button>
              ) : null}
            </>
          )}
          {e.options.includes('answer') || answering ? (
            <button
              type="button"
              className="poolse-approval__link"
              disabled={!!sending}
              onClick={() => setAnswering((v) => !v)}
            >
              {answering ? 'Back' : 'Answer'}
            </button>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p className="poolse-approval__error" role="alert">
          {escalationErrorMessage(error)}
        </p>
      ) : null}
    </section>
  );
}

export interface EscalationListProps {
  /** Only this call's. */
  callId?: string | null;
  /** Shown when nothing waits. Defaults to nothing. */
  empty?: string | null;
  className?: string;
}

/** Everything your agents wait for you to answer, live. */
export function EscalationList({ callId, empty = null, className }: EscalationListProps) {
  const { escalations, agentNameOf } = useEscalations({ callId: callId ?? null });
  if (escalations.length === 0)
    return empty ? <p className={cx('poolse-panel__empty', className)}>{empty}</p> : null;
  return (
    <div className={cx('poolse-escalation-list', className)}>
      {escalations.map((e) => (
        <EscalationCard key={e.id} escalation={e} agentName={agentNameOf(e)} />
      ))}
    </div>
  );
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
