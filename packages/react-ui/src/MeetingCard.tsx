// A meeting invite in chat (CA4, CA11): title, when, who is coming, the
// RSVP buttons and Join. The card is a message; the server rewrites it as
// answers come in (`message:updated`), so it stays live by itself.
//
//     const card = meetingCardOf(message);
//     {card && <MeetingCard card={card} selfUserId={me.id} onRsvp={rsvp} onJoin={join} />}
//
// RSVPs are recorded by the Workspace API, so the host passes `onRsvp`.

import type { MeetingCard as MeetingCardData, RsvpResponse } from '@poolse/sdk';
import { meetingJoinable, rsvpOf } from '@poolse/sdk';
import { useEffect, useState } from 'react';

import { PoolseIcon } from './PoolseIcon.js';

export interface MeetingCardProps {
  card: MeetingCardData;
  /** Your poolse user id, to find your answer in the lists. */
  selfUserId?: string | null;
  /** Record an answer; resolve false (or throw) to show it failed. */
  onRsvp?: (response: RsvpResponse, card: MeetingCardData) => Promise<boolean | void> | void;
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
  const [mine, setMine] = useState<RsvpResponse | null>(() => rsvpOf(card, selfUserId));
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => setMine(rsvpOf(card, selfUserId)), [card, selfUserId]);
  useEffect(() => {
    if (card.status !== 'scheduled') return;
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [card.status]);

  const joinable = meetingJoinable(card, now);
  const when = formatMeetingTime(card.startsAt, card.endsAt, locale);
  const accepted = card.rsvps.accepted.length;
  const counts = [
    accepted ? `${accepted} accepted` : null,
    card.rsvps.tentative.length ? `${card.rsvps.tentative.length} maybe` : null,
    card.rsvps.declined.length ? `${card.rsvps.declined.length} declined` : null,
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
      const ok = await onRsvp?.(value, card);
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
          {onRsvp ? (
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
