// A meeting invite in chat (CA4, CA11): title, when, who is coming, the
// RSVP buttons and Join. The card is a message; the server rewrites it as
// answers come in (`message:updated`), so it stays live by itself.
//
//     const card = meetingCardOf(message);
//     {card && <MeetingCard card={card} selfUserId={me.id} onRsvp={rsvp} onJoin={join} />}
//
// Answers go to `PUT /meetings/:id/rsvp` through the provider's client;
// pass `onRsvp` to record them elsewhere instead. The card's body has no
// `my_rsvp`: yours is found in `rsvps` by `selfUserId` (default: the
// signed-in user).

import type { MeetingCard as MeetingCardData, RsvpResponse } from '@poolse/sdk';
import { useOptionalPoolse } from '@poolse/react';
import { meetingJoinable, rsvpOf } from '@poolse/sdk';
import { useEffect, useState } from 'react';

import { PoolseIcon } from './PoolseIcon.js';

export interface MeetingCardProps {
  card: MeetingCardData;
  /** Your poolse user id, to find your answer in the lists. */
  selfUserId?: string | null;
  /**
   * Record an answer yourself; resolve false (or throw) to show it
   * failed. Default: `poolse.live.meetings.rsvp` when inside a
   * `PoolseProvider`. `false` hides the buttons.
   */
  onRsvp?:
    | ((response: RsvpResponse, card: MeetingCardData) => Promise<boolean | void> | void)
    | false;
  /** Join the meeting (its room or live call). */
  onJoin?: (card: MeetingCardData) => void;
  /** Locale for the date and time. Defaults to the browser's. */
  locale?: string;
  className?: string;
}

const RSVP: Array<{ value: RsvpResponse; label: string }> = [
  { value: 'accepted', label: 'Accept' },
  { value: 'tentative', label: 'Maybe' },
  { value: 'declined', label: 'Decline' },
];

/** "Tue 25 Nov · 10:00–10:30" — same day shown once. */
export function formatMeetingTime(
  startsAt: string | null,
  endsAt: string | null,
  locale?: string,
): string | null {
  if (!startsAt) return null;
  const start = new Date(startsAt);
  if (Number.isNaN(start.getTime())) return null;
  const day = start.toLocaleDateString(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const time = (d: Date) => d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const end = endsAt ? new Date(endsAt) : null;
  if (!end || Number.isNaN(end.getTime())) return `${day} · ${time(start)}`;
  const sameDay = end.toDateString() === start.toDateString();
  return sameDay
    ? `${day} · ${time(start)}–${time(end)}`
    : `${day} · ${time(start)} – ${end.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })} ${time(end)}`;
}

/** The invite card with Accept / Maybe / Decline and Join. */
export function MeetingCard({
  card,
  selfUserId,
  onRsvp,
  onJoin,
  locale,
  className,
}: MeetingCardProps) {
  const poolse = useOptionalPoolse();
  const self = selfUserId ?? poolse?.me.peek()?.id ?? null;
  const record =
    onRsvp === false
      ? null
      : (onRsvp ??
        (poolse
          ? async (r: RsvpResponse) => {
              await poolse.live.meetings.rsvp(card.meetingId, r);
            }
          : null));
  const [mine, setMine] = useState<RsvpResponse | null>(() => rsvpOf(card, self));
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => setMine(rsvpOf(card, self)), [card, self]);
  useEffect(() => {
    if (card.status !== 'scheduled') return;
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [card.status]);

  const joinable = meetingJoinable(card, now);
  const when = formatMeetingTime(card.startsAt, card.endsAt, locale);
  const accepted = card.counts.accepted;
  const counts = [
    accepted ? `${accepted} accepted` : null,
    card.counts.tentative ? `${card.counts.tentative} maybe` : null,
    card.counts.declined ? `${card.counts.declined} declined` : null,
  ].filter(Boolean);
  const status =
    card.status === 'live'
      ? 'Happening now'
      : card.status === 'cancelled'
        ? 'Cancelled'
        : card.status === 'ended'
          ? 'Ended'
          : null;

  const answer = async (value: RsvpResponse) => {
    const before = mine;
    setMine(value);
    setFailed(false);
    try {
      const ok = await record?.(value, card);
      if (ok === false) throw new Error('rsvp failed');
    } catch {
      setMine(before);
      setFailed(true);
    }
  };

  return (
    <article
      className={[
        'poolse-meetcard',
        card.status === 'cancelled' && 'poolse-meetcard--cancelled',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label={`Meeting: ${card.title}`}
    >
      <header className="poolse-meetcard__head">
        <PoolseIcon name={card.media === 'video' ? 'video' : 'phone'} size={16} label={null} />
        <h4 className="poolse-meetcard__title" title={card.title}>
          {card.title}
        </h4>
        {status ? (
          <span className={`poolse-meetcard__status poolse-meetcard__status--${card.status}`}>
            {status}
          </span>
        ) : null}
      </header>
      {when ? <p className="poolse-meetcard__when">{when}</p> : null}
      {card.organizer?.displayName ? (
        <p className="poolse-meetcard__meta" title={card.organizer.displayName}>
          Organized by {card.organizer.displayName}
        </p>
      ) : null}
      {counts.length ? <p className="poolse-meetcard__meta">{counts.join(' · ')}</p> : null}
      {card.status !== 'cancelled' && card.status !== 'ended' ? (
        <div className="poolse-meetcard__actions">
          {record ? (
            <div role="radiogroup" aria-label="Your answer" className="poolse-meetcard__rsvp">
              {RSVP.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  role="radio"
                  aria-checked={mine === r.value}
                  className={`poolse-meetcard__rsvpbtn${mine === r.value ? ' poolse-meetcard__rsvpbtn--on' : ''}`}
                  onClick={() => void answer(r.value)}
                >
                  {r.label}
                </button>
              ))}
            </div>
          ) : null}
          {onJoin ? (
            <button
              type="button"
              className="poolse-btn poolse-btn--brand"
              disabled={!joinable}
              title={joinable ? undefined : 'Join opens 10 minutes before the start'}
              onClick={() => onJoin(card)}
            >
              Join
            </button>
          ) : null}
        </div>
      ) : null}
      {failed ? (
        <p className="poolse-panel__error" role="alert">
          Your answer wasn’t saved. Try again.
        </p>
      ) : null}
    </article>
  );
}
