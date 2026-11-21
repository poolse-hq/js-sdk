// Chat layout vocabulary shared by ConversationView, MessageRow and
// the row pieces. Same names and semantics as @poolse/react-native's.

import type { Message } from '@poolse/sdk';
import type { ReactNode } from 'react';
import type { GroupPosition } from './grouping.js';
import type { MessageUser } from './MessageRow.js';

/**
 * - `bubbles` — chat bubbles, own messages on the right (the default).
 * - `list` — Slack-style full-width rows: avatar, name and time once
 *   per run of messages, a hover toolbar.
 * - `compact` — Discord/IRC-style dense lines: time, coloured name and
 *   text on one line.
 */
export type ChatLayout = 'bubbles' | 'list' | 'compact';

export type ChatDensity = 'comfortable' | 'compact';

/** `'12h'`, `'24h'`, or your own formatter. Omitted: the locale's default. */
export type TimeFormat = '12h' | '24h' | ((date: Date) => string);

/** The gutter's form of a time: no space before AM/PM, so it fits. */
export function gutterTime(time: string): string {
  return time.replace(/\s+(?=[AaPp]\.?[Mm]\.?$)/, '').replace(/\u202f/g, '');
}

/** A message's time of day, as every layout shows it. */
export function formatMessageTime(iso: string | null | undefined, format?: TimeFormat): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  if (typeof format === 'function') return format(date);
  if (format === '12h') {
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
  }
  if (format === '24h') {
    return date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  }
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** Someone else's message that @-mentions the viewer. */
export function mentionsViewer(msg: Message, meId: string | null): boolean {
  return meId !== null && msg.sender_id !== meId && (msg.mentions ?? []).includes(meId);
}

/** What each slot function receives. */
export interface MessageSlotProps {
  message: Message;
  /** The viewer sent it. */
  isSelf: boolean;
  sender: MessageUser;
  layout: ChatLayout;
  /** First message of a same-sender run (always true in `compact`). */
  isRunStart: boolean;
  /**
   * What the slot renders by default (may be `null` — e.g. no header on
   * a continuation message). Return it to keep the default, wrap it,
   * or return something else.
   */
  children: ReactNode;
}

export type MessageSlot = (props: MessageSlotProps) => ReactNode;

/**
 * Replace or wrap one part of every message, in any layout:
 *
 * - `header` — sender name and time (the name label in `bubbles`)
 * - `body` — the text (or "This message was deleted")
 * - `attachments` — images and files
 * - `reactions` — the reaction pills
 * - `thread` — the "N replies" link
 * - `actions` — the hover toolbar / actions popover
 */
export interface MessageSlots {
  header?: MessageSlot;
  body?: MessageSlot;
  attachments?: MessageSlot;
  reactions?: MessageSlot;
  thread?: MessageSlot;
  actions?: MessageSlot;
}

export type MessageSlotContext = Omit<MessageSlotProps, 'children'>;

export function renderSlot(
  slot: MessageSlot | undefined,
  ctx: MessageSlotContext | undefined,
  children: ReactNode,
): ReactNode {
  return slot && ctx ? slot({ ...ctx, children }) : children;
}

/** Third argument to `renderMessage`. */
export interface RenderMessageContext {
  layout: ChatLayout;
  groupPosition: GroupPosition;
  isRunStart: boolean;
  /** The row ConversationView would have rendered for this message. */
  renderDefault: () => ReactNode;
}
