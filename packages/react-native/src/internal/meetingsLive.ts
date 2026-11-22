// Pure helpers behind the live meeting components — no React Native
// imports, so vitest runs them under node.

import type {
  CallConnectionQuality,
  LiveTranscriptSegment,
  MeetingCard,
  WhiteboardShape,
} from '@poolse/sdk';

/** 45 → "0:45", 3725 → "1:02:05". */
export function formatCountdown(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.floor(seconds ?? 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** Show at most `max` avatars; the rest become "+N". */
export function avatarOverflow<T>(list: readonly T[], max: number): { shown: T[]; more: number } {
  const n = Math.max(0, Math.floor(max));
  return list.length <= n
    ? { shown: [...list], more: 0 }
    : { shown: list.slice(0, Math.max(0, n - 1)), more: list.length - Math.max(0, n - 1) };
}

/** One caption line: a speaker's run of text, interim when still talking. */
export interface CaptionLine {
  key: string;
  speaker: string;
  text: string;
  interim: boolean;
}

/**
 * The last `lines` caption lines: consecutive segments of one speaker are
 * joined, an interim segment after them shown as still being spoken.
 * Each line keeps only its last `maxChars` characters.
 */
export function captionLines(
  segments: readonly LiveTranscriptSegment[],
  lines = 2,
  maxChars = 160,
): CaptionLine[] {
  const out: CaptionLine[] = [];
  for (const seg of segments) {
    const text = seg.text.trim();
    if (!text) continue;
    const speaker = seg.speaker_name?.trim() || 'Someone';
    const last = out[out.length - 1];
    if (last && last.speaker === speaker && last.key.startsWith(seg.speaker + ':')) {
      last.text = `${last.text} ${text}`;
      last.interim = !seg.final;
    } else {
      out.push({ key: `${seg.speaker}:${seg.start_ms}`, speaker, text, interim: !seg.final });
    }
  }
  return out.slice(-lines).map((l) => ({
    ...l,
    text: l.text.length > maxChars ? `…${l.text.slice(-(maxChars - 1)).trimStart()}` : l.text,
  }));
}

/** "Budget review is 3 min over" — null when not over by a whole minute. */
export function overrunText(title: string, overrunMs: number): string | null {
  const min = Math.floor(overrunMs / 60_000);
  if (min < 1) return null;
  return `${title} is ${min} min over`;
}

/** "Tue 21 Nov · 10:00–10:30" in the device's locale. */
export function meetingTimeText(card: Pick<MeetingCard, 'startsAt' | 'endsAt'>): string | null {
  if (!card.startsAt) return null;
  const start = new Date(card.startsAt);
  if (Number.isNaN(start.getTime())) return null;
  const day = start.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const time = (d: Date) => d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const end = card.endsAt ? new Date(card.endsAt) : null;
  return end && !Number.isNaN(end.getTime())
    ? `${day} · ${time(start)}–${time(end)}`
    : `${day} · ${time(start)}`;
}

/** "4 accepted · 1 maybe · 2 declined" (empty parts left out), or null. */
export function rsvpSummary(
  card: Pick<MeetingCard, 'rsvps'> & Partial<Pick<MeetingCard, 'counts'>>,
): string | null {
  const n = (k: 'accepted' | 'tentative' | 'declined') => card.counts?.[k] ?? card.rsvps[k].length;
  const parts: string[] = [];
  if (n('accepted')) parts.push(`${n('accepted')} accepted`);
  if (n('tentative')) parts.push(`${n('tentative')} maybe`);
  if (n('declined')) parts.push(`${n('declined')} declined`);
  return parts.length ? parts.join(' · ') : null;
}

/** How many of 3 bars a link fills: a web `CallConnectionQuality` or the native core's. */
export function qualityBars(
  quality: CallConnectionQuality | 'good' | 'poor' | 'lost' | 'unknown' | null | undefined,
): number {
  switch (quality) {
    case 'excellent':
      return 3;
    case 'good':
      return 2;
    case 'poor':
      return 1;
    default:
      return 0;
  }
}

/** A flat `[x0, y0, x1, y1, …]` list as an SVG path, scaled by `sx` / `sy`. */
export function pointsToPath(points: readonly number[], sx = 1, sy = 1): string {
  if (points.length < 2) return '';
  let d = `M${(points[0]! * sx).toFixed(1)} ${(points[1]! * sy).toFixed(1)}`;
  if (points.length === 2) return `${d} l0.1 0`;
  for (let i = 2; i + 1 < points.length; i += 2) {
    d += ` L${(points[i]! * sx).toFixed(1)} ${(points[i + 1]! * sy).toFixed(1)}`;
  }
  return d;
}

/** An arrow's head as a path: two short strokes back from (x + w, y + h). */
export function arrowHeadPath(
  item: Pick<WhiteboardShape, 'x' | 'y' | 'w' | 'h' | 'width'>,
): string {
  const x2 = item.x + item.w;
  const y2 = item.y + item.h;
  const angle = Math.atan2(item.h, item.w);
  const len = Math.max(10, item.width * 4);
  const a1 = angle + Math.PI - Math.PI / 7;
  const a2 = angle + Math.PI + Math.PI / 7;
  const p = (a: number) =>
    `${(x2 + len * Math.cos(a)).toFixed(1)} ${(y2 + len * Math.sin(a)).toFixed(1)}`;
  return `M${p(a1)} L${x2.toFixed(1)} ${y2.toFixed(1)} L${p(a2)}`;
}
