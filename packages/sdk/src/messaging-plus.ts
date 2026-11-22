// Wire types and small helpers for poolse's messaging plus
// (docs/MESSAGING_PLUS.md) and the attachment additions of
// docs/PLATFORM_PLUS.md §1: scheduled send, polls, pins and forward,
// thread follow, catch-up, translate, interactive blocks, the files list.

import type { Attachment, IsoDateTime, Message, Uuid } from './types.js';

// ── Scheduled send (MS1) ─────────────────────────────────────────────────

export type ScheduledMessageStatus = 'scheduled' | 'sent' | 'failed';

export interface ScheduledMessage {
  /** Also the id of the message it becomes. */
  id: Uuid;
  conversation_id: Uuid;
  body: string;
  mentions: Uuid[];
  reply_to_id: Uuid | null;
  quoted_message_id: Uuid | null;
  also_send_to_channel: boolean;
  send_at: IsoDateTime;
  status: ScheduledMessageStatus;
  /** Set once sent. */
  message_id: Uuid | null;
  /** On `failed`: `timed_out`, `not_allowed`, `blocked_words`, `dlp_blocked`, `dlp_warning`, `send_failed`. */
  error: string | null;
  inserted_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface ScheduleMessageRequest {
  body: string;
  /** ISO 8601, 10 s to 365 days ahead. */
  send_at: IsoDateTime;
  mentions?: Uuid[];
  reply_to_id?: Uuid;
  quoted_message_id?: Uuid;
  also_send_to_channel?: boolean;
  dlp_acknowledged?: boolean;
}

export interface ScheduledMessageUpdate {
  body?: string;
  send_at?: IsoDateTime;
  mentions?: Uuid[];
  dlp_acknowledged?: boolean;
}

/** `scheduled_message:sent` / `scheduled_message:failed` on the sender's user topic. */
export interface ScheduledMessageEvent {
  id: Uuid;
  conversation_id: Uuid;
  message_id?: Uuid;
  error?: string;
}

// ── Polls (MS3) ──────────────────────────────────────────────────────────

export interface PollOption {
  id: string;
  text: string;
  votes: number;
  /** `[]` on an anonymous poll; at most 100 per option. */
  voter_ids: Uuid[];
}

export interface Poll {
  options: PollOption[];
  multiple: boolean;
  anonymous: boolean;
  closes_at: IsoDateTime | null;
  closed_at: IsoDateTime | null;
  /** `closed_at` set, or `closes_at` passed (when the server answered). */
  closed: boolean;
  /** People who voted. */
  voters: number;
}

/** What `messages.send` takes for `type: "poll"` (the question is `body`). */
export interface PollCreate {
  /** 2–10 unique options, 1–200 characters each. */
  options: string[];
  multiple?: boolean;
  anonymous?: boolean;
  /** Optional, in the future, ≤ 365 days. */
  closes_at?: IsoDateTime;
}

export interface PollState {
  poll: Poll;
  my_option_ids: string[];
}

/** `poll:updated` on the conversation. */
export interface PollUpdatedEvent {
  message_id: Uuid;
  conversation_id: Uuid;
  poll: Poll;
}

/** Closed now: `closed`, or `closes_at` already passed by `now` (no event fires at that time). */
export function isPollClosed(poll: Poll, now = Date.now()): boolean {
  if (poll.closed || poll.closed_at) return true;
  if (!poll.closes_at) return false;
  const t = Date.parse(poll.closes_at);
  return Number.isFinite(t) && t <= now;
}

/** Each option's share of all votes, 0–100, rounded (sums can be 99–101). */
export function pollPercentages(poll: Poll): Record<string, number> {
  const total = poll.options.reduce((n, o) => n + o.votes, 0);
  const out: Record<string, number> = {};
  for (const o of poll.options) out[o.id] = total === 0 ? 0 : Math.round((o.votes / total) * 100);
  return out;
}

/**
 * The vote set after tapping `optionId`: on a single-choice poll it
 * replaces the vote (tapping the same option again takes it back); on a
 * multiple-choice poll it toggles that option.
 */
export function toggleVote(poll: Poll, mine: readonly string[], optionId: string): string[] {
  const has = mine.includes(optionId);
  if (!poll.multiple) return has ? [] : [optionId];
  return has ? mine.filter((id) => id !== optionId) : [...mine, optionId];
}

/** A poll with the caller's votes applied locally (optimistic UI before the server answers). */
export function applyLocalVote(
  poll: Poll,
  before: readonly string[],
  after: readonly string[],
  me?: Uuid,
): Poll {
  const wasVoter = before.length > 0;
  const isVoter = after.length > 0;
  return {
    ...poll,
    voters: poll.voters + (isVoter === wasVoter ? 0 : isVoter ? 1 : -1),
    options: poll.options.map((o) => {
      const had = before.includes(o.id);
      const has = after.includes(o.id);
      if (had === has) return o;
      const voter_ids =
        poll.anonymous || !me
          ? o.voter_ids
          : has
            ? [...o.voter_ids, me]
            : o.voter_ids.filter((id) => id !== me);
      return { ...o, votes: Math.max(0, o.votes + (has ? 1 : -1)), voter_ids };
    }),
  };
}

// ── Pins and forward (MS13) ──────────────────────────────────────────────

export interface ForwardedFrom {
  message_id: Uuid;
  conversation_id: Uuid;
  sender_id: Uuid | null;
  sender_external_id: string | null;
  sent_at: IsoDateTime;
}

/** `pin:added` / `pin:removed` on the conversation. */
export interface PinEvent {
  message_id: Uuid;
  conversation_id: Uuid;
  pinned_by_id: Uuid | null;
  pinned_at: IsoDateTime | null;
}

export interface ForwardRequest {
  /** 1–10 targets. */
  conversation_ids: Uuid[];
  /** Sent first, as an ordinary message from you, in each target. */
  comment?: string;
  dlp_acknowledged?: boolean;
}

// ── Thread follow (MS19) ─────────────────────────────────────────────────

export interface ThreadFollowState {
  /** The thread's root. */
  message_id: Uuid;
  following: boolean;
  /** `false` while following is the default (root sender, repliers, mentioned). */
  explicit: boolean;
}

// ── What did I miss (MS20) ───────────────────────────────────────────────

export interface CatchUpHighlight {
  message_id: Uuid;
  sequence: number;
  why: string;
}

export interface CatchUp {
  /** `null` when there was nothing to summarise. */
  summary: string | null;
  highlights: CatchUpHighlight[];
  message_count: number;
  /** More than 300 messages: the newest 300 were read. */
  truncated: boolean;
  since: IsoDateTime;
  until: IsoDateTime;
}

export interface CatchUpRequest {
  /** Default: the caller's read position. At most 7 days back. */
  since?: IsoDateTime;
  /** BCP 47; default the conversation's language. */
  language?: string;
}

// ── Translate (MS21) ─────────────────────────────────────────────────────

export interface MessageTranslation {
  message_id: Uuid;
  language: string;
  text: string;
  cached: boolean;
}

// ── Interactive blocks (IN4) ─────────────────────────────────────────────

export interface BlockOption {
  text: string;
  value: string;
}

export interface ButtonElement {
  type: 'button';
  action_id: string;
  text: string;
  value?: string;
  style?: 'primary' | 'danger';
  /** A link button: opens the url, sends no action. */
  url?: string;
  /** Sends every `input` block's value with the action. */
  submit?: boolean;
}

export interface SelectElement {
  type: 'select';
  action_id: string;
  placeholder?: string;
  options: BlockOption[];
  initial_value?: string;
}

export type BlockElement = ButtonElement | SelectElement;

export type Block =
  | { type: 'section'; text: string; block_id?: string }
  | { type: 'context'; text: string; block_id?: string }
  | { type: 'divider'; block_id?: string }
  | { type: 'image'; url: string; alt?: string; block_id?: string }
  | { type: 'actions'; elements: BlockElement[]; block_id?: string }
  | {
      type: 'input';
      action_id: string;
      label: string;
      input: 'text' | 'textarea' | 'select' | 'checkboxes' | 'date';
      options?: BlockOption[];
      placeholder?: string;
      required?: boolean;
      block_id?: string;
    };

export type InputBlock = Extract<Block, { type: 'input' }>;

/** Values of a form's inputs, by `action_id` (checkboxes: a list). */
export type BlockValues = Record<string, string | string[]>;

export interface BlockActionRequest {
  action_id: string;
  /** A select's chosen value (buttons send their own). */
  value?: string;
  /** With a `submit` button: every input's value. */
  values?: BlockValues;
}

/** The inputs of a block message that are required and still empty. */
export function missingInputs(blocks: readonly Block[], values: BlockValues): InputBlock[] {
  return blocks.filter((b): b is InputBlock => {
    if (b.type !== 'input' || !b.required) return false;
    const v = values[b.action_id];
    return v === undefined || (Array.isArray(v) ? v.length === 0 : v.trim() === '');
  });
}

/** Starting values for a form: each select's first option is not preselected; checkboxes start empty. */
export function initialBlockValues(blocks: readonly Block[]): BlockValues {
  const out: BlockValues = {};
  for (const b of blocks) {
    if (b.type === 'input') out[b.action_id] = b.input === 'checkboxes' ? [] : '';
    if (b.type === 'actions') {
      for (const e of b.elements) {
        if (e.type === 'select' && e.initial_value !== undefined)
          out[e.action_id] = e.initial_value;
      }
    }
  }
  return out;
}

// ── Files (MS18) and media (MS15, MS16) ──────────────────────────────────

export type AttachmentKind = 'image' | 'video' | 'audio' | 'document' | 'other';
export type AttachmentPurpose = 'voice' | 'video_message';
export type ProcessingStatus = 'pending' | 'done' | 'failed' | 'skipped';
export type AttachmentTranscriptStatus = 'pending' | 'ready' | 'failed' | 'unavailable';

export interface AttachmentPage {
  data: Attachment[];
  /** Pass as `before` for the next page; null on the last. */
  next_cursor: string | null;
}

export interface AttachmentListOptions {
  kind?: AttachmentKind;
  /** 1–100, default 50. */
  limit?: number;
  before?: string;
}

/** A presigned URL for a thumbnail or a preview (PDF of an Office file). */
export interface AttachmentAssetUrl {
  url: string;
  expires_at: IsoDateTime;
  content_type: string;
}

/** `attachment:processed` on the conversation. */
export interface AttachmentProcessedEvent {
  cv: number;
  conversation_id: Uuid;
  message_id: Uuid;
  attachment: Attachment;
}

/** The kind of an attachment: the server's, or guessed from the type on older servers. */
export function attachmentKind(a: Pick<Attachment, 'content_type' | 'kind'>): AttachmentKind {
  if (a.kind) return a.kind;
  const t = a.content_type.toLowerCase();
  if (t.startsWith('image/')) return 'image';
  if (t.startsWith('video/')) return 'video';
  if (t.startsWith('audio/')) return 'audio';
  if (
    t === 'application/pdf' ||
    t.startsWith('text/') ||
    /officedocument|msword|ms-excel|ms-powerpoint|opendocument|rtf/.test(t)
  )
    return 'document';
  return 'other';
}

/** A voice message (MS15) or a video message (MS16) among a message's attachments. */
export function mediaMessageOf(message: Pick<Message, 'attachments'>): Attachment | null {
  return (
    message.attachments?.find((a) => a.purpose === 'voice' || a.purpose === 'video_message') ?? null
  );
}

/** Longest video message the server takes (ms). */
export const VIDEO_MESSAGE_MAX_MS = 300_000;
