import { fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConversationView, type ConversationViewProps } from '../src/index.js';
import { names } from './_fixtures.js';
import { jsonResponse, noContent, renderWithProvider, routedFetch } from './_helpers.js';

const me = {
  id: 'u-me',
  tenant_id: 't-1',
  external_id: 'me',
  display_name: 'Me',
  custom_data: {},
  is_blocked: false,
  inserted_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const member = (uid: string, ext: string, lastRead: string | null = null) => ({
  id: `mem-${ext}`,
  conversation_id: 'c-1',
  user_id: uid,
  external_id: ext,
  role: 'member',
  last_read_message_id: lastRead,
  last_read_at: null,
  inserted_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});

const at = (min: number) => new Date(Date.UTC(2026, 0, 1, 10, min)).toISOString();

const msg = (seq: number, sender: 'u-me' | 'u-2', min: number, extra: object = {}) => ({
  id: `m${seq}`,
  tenant_id: 't-1',
  conversation_id: 'c-1',
  sender_id: sender,
  sender_external_id: sender === 'u-me' ? 'me' : 'two',
  type: 'text',
  body: `message ${seq}`,
  reply_to_id: null,
  thread_root_id: null,
  mentions: [],
  reactions: {},
  edited_at: null,
  deleted_at: null,
  sequence: seq,
  inserted_at: at(min),
  updated_at: at(min),
  ...extra,
});

// m1+m2: one run from "two"; m3 from me (read by two); m4 mentions me;
// m5 has a thread; m6 edited; m7 deleted; m8 quotes m1.
const feed = [
  msg(1, 'u-2', 0),
  msg(2, 'u-2', 1),
  msg(3, 'u-me', 2),
  msg(4, 'u-2', 10, { mentions: ['u-me'], reactions: { '👍': ['u-me'] } }),
  msg(5, 'u-2', 20, { reply_count: 2 }),
  msg(6, 'u-me', 30, { edited_at: at(31) }),
  msg(7, 'u-2', 40, { deleted_at: at(41), body: null }),
  msg(8, 'u-me', 50, {
    quoted_message_id: 'm1',
    quoted_message: {
      id: 'm1',
      sender_id: 'u-2',
      sender_external_id: 'two',
      body: 'message 1',
      deleted_at: null,
      inserted_at: at(0),
    },
  }),
];

function fetchFor() {
  return routedFetch({
    'GET /v1/me': () => jsonResponse(me),
    'GET /v1/conversations/c-1/messages': () => jsonResponse({ data: [...feed].reverse() }),
    'GET /v1/conversations/c-1/members': () =>
      jsonResponse({ data: [member('u-me', 'me'), member('u-2', 'two', 'm3')] }),
    'POST /v1/conversations/c-1/read': () => noContent(),
  });
}

async function mount(props: Partial<ConversationViewProps> = {}) {
  const utils = renderWithProvider(
    <ConversationView conversationId="c-1" loadFonts={false} labelFor={names} {...props} />,
    fetchFor(),
  );
  await waitFor(() => expect(utils.container.textContent).toContain('message 8'));
  // Members (read receipts) land after the first page.
  await waitFor(() => expect(utils.container.querySelector('[aria-label="Read"]')).not.toBeNull());
  return utils;
}

const row = (container: HTMLElement, id: string) => {
  const el = container.querySelector(`[data-message-id="${id}"]`);
  if (!(el instanceof HTMLElement)) throw new Error(`no row ${id}`);
  return el;
};

describe('<ConversationView layout>', () => {
  it('defaults to bubbles — today’s rendering', async () => {
    const { container } = await mount();
    const root = container.querySelector('.poolse-conversation')!;
    expect(root.classList.contains('poolse-conversation--layout-bubbles')).toBe(true);
    expect(root.classList.contains('poolse-conversation--density-comfortable')).toBe(true);
    expect(container.querySelectorAll('.poolse-message').length).toBeGreaterThanOrEqual(8);
    expect(container.querySelector('.poolse-row')).toBeNull();
    expect(row(container, 'm3').classList.contains('poolse-message-row--right')).toBe(true);
  });

  describe('list', () => {
    it('heads each run with avatar, name and time; later messages show time in the gutter', async () => {
      const { container } = await mount({ layout: 'list' });
      const first = row(container, 'm1');
      const second = row(container, 'm2');
      expect(first.className).toContain('poolse-row--list');
      expect(first.className).toContain('poolse-row--run-start');
      expect(first.querySelector('.poolse-row__header .poolse-row__name')?.textContent).toBe('Two');
      expect(first.querySelector('.poolse-row__header time')).not.toBeNull();
      expect(first.querySelector('.poolse-row__gutter .poolse-avatar')).not.toBeNull();

      expect(second.className).toContain('poolse-row--continued');
      expect(second.querySelector('.poolse-row__header')).toBeNull();
      expect(second.querySelector('.poolse-row__gutter-time')).not.toBeNull();
      expect(second.querySelector('.poolse-avatar')).toBeNull();

      // Own messages are left-aligned rows too, with a name.
      expect(row(container, 'm3').querySelector('.poolse-row__name')?.textContent).toBe('Me');
    });

    it('has a hover toolbar: React, Reply, Thread, More (Copy / Edit / Delete)', async () => {
      const { container } = await mount({ layout: 'list' });
      const own = row(container, 'm6');
      const labels = Array.from(own.querySelectorAll('.poolse-row__toolbar > * > button')).map(
        (b) => b.getAttribute('aria-label'),
      );
      expect(labels).toEqual(['React', 'Reply', 'Reply in thread', 'More actions']);
      fireEvent.click(own.querySelector('[aria-label="More actions"]')!);
      const items = Array.from(own.querySelectorAll('[role="menuitem"]')).map((b) => b.textContent);
      expect(items).toEqual(['Copy', 'Edit', 'Delete']);
      // Someone else's message: no Edit / Delete, but Mark unread.
      fireEvent.click(row(container, 'm5').querySelector('[aria-label="More actions"]')!);
      expect(
        Array.from(row(container, 'm5').querySelectorAll('[role="menuitem"]')).map(
          (b) => b.textContent,
        ),
      ).toEqual(['Copy', 'Mark unread']);
    });

    it('shows N replies, receipts, edits, deletes, quotes, reactions and mentions', async () => {
      const { container } = await mount({ layout: 'list' });
      expect(row(container, 'm5').querySelector('.poolse-row__thread')?.textContent).toBe(
        '2 replies',
      );
      expect(row(container, 'm3').querySelector('[aria-label="Read"]')).not.toBeNull();
      expect(row(container, 'm8').querySelector('[aria-label="Sent"]')).not.toBeNull();
      expect(row(container, 'm6').textContent).toContain('(edited)');
      expect(row(container, 'm7').textContent).toContain('This message was deleted');
      expect(row(container, 'm7').querySelector('.poolse-row__toolbar')).toBeNull();
      expect(row(container, 'm8').querySelector('.poolse-quote')?.textContent).toContain(
        'message 1',
      );
      expect(row(container, 'm4').querySelector('.poolse-reaction-pill')).not.toBeNull();
      expect(row(container, 'm4').className).toContain('poolse-row--mention');
      expect(row(container, 'm5').className).not.toContain('poolse-row--mention');
    });

    it('opens the editor in place', async () => {
      const { container } = await mount({ layout: 'list' });
      fireEvent.click(row(container, 'm6').querySelector('[aria-label="More actions"]')!);
      fireEvent.click(row(container, 'm6').querySelector('[role="menuitem"]:nth-child(2)')!);
      await waitFor(() => expect(row(container, 'm6').querySelector('textarea')).not.toBeNull());
    });

    it('makes name and avatar buttons for other people only', async () => {
      const onSenderPress = vi.fn();
      const onAvatarPress = vi.fn();
      const { container } = await mount({ layout: 'list', onSenderPress, onAvatarPress });
      fireEvent.click(row(container, 'm1').querySelector('.poolse-row__name--button')!);
      expect(onSenderPress).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u-2', externalId: 'two', displayName: 'Two' }),
      );
      fireEvent.click(row(container, 'm1').querySelector('.poolse-row__avatar-button')!);
      expect(onAvatarPress).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u-2' }));
      expect(row(container, 'm3').querySelector('.poolse-row__name--button')).toBeNull();
    });

    it('groupWindowMinutes sets the run window', async () => {
      const { container } = await mount({ layout: 'list', groupWindowMinutes: 0 });
      expect(row(container, 'm2').className).toContain('poolse-row--run-start');
    });

    it('draws day dividers as a rule', async () => {
      const { container } = await mount({ layout: 'list' });
      expect(
        container.querySelector('.poolse-conversation--layout-list .poolse-day-separator'),
      ).not.toBeNull();
    });
  });

  describe('compact', () => {
    it('puts time, coloured name and text on every line; no avatars by default', async () => {
      const { container } = await mount({ layout: 'compact' });
      for (const id of ['m1', 'm2', 'm3']) {
        const r = row(container, id);
        expect(r.className).toContain('poolse-row--compact');
        expect(r.firstElementChild?.tagName).toBe('TIME');
        expect(r.querySelector('.poolse-row__name')).not.toBeNull();
      }
      const name = row(container, 'm2').querySelector<HTMLElement>('.poolse-row__name')!;
      expect(name.style.color).not.toBe('');
      expect(container.querySelector('.poolse-row .poolse-avatar')).toBeNull();
      expect(row(container, 'm4').className).toContain('poolse-row--mention');
      expect(row(container, 'm5').querySelector('.poolse-row__thread')).not.toBeNull();
    });

    it('showAvatars adds small avatars', async () => {
      const { container } = await mount({ layout: 'compact', showAvatars: true });
      expect(
        row(container, 'm1').querySelector('.poolse-row__avatar .poolse-avatar'),
      ).not.toBeNull();
    });
  });

  it('density and timeFormat apply to every layout', async () => {
    const { container } = await mount({
      layout: 'compact',
      density: 'compact',
      timeFormat: (d) => `T${d.getUTCMinutes()}`,
    });
    expect(
      container
        .querySelector('.poolse-conversation')!
        .classList.contains('poolse-conversation--density-compact'),
    ).toBe(true);
    expect(row(container, 'm2').querySelector('time')?.textContent).toBe('T1');
  });

  it('timeFormat reaches the bubbles too', async () => {
    const { container } = await mount({ timeFormat: () => 'NOON' });
    expect(row(container, 'm1').querySelector('.poolse-message__meta')?.textContent).toContain(
      'NOON',
    );
  });

  it('slots wrap parts of every message, in every layout', async () => {
    for (const layout of ['bubbles', 'list', 'compact'] as const) {
      const { container, unmount } = await mount({
        layout,
        slots: {
          body: ({ children, message, layout: l }) => (
            <div data-testid={`body-${message.id}`} data-layout={l}>
              {children}
            </div>
          ),
          reactions: () => <span className="custom-reactions" />,
        },
      });
      const body = container.querySelector('[data-testid="body-m1"]')!;
      expect(body.getAttribute('data-layout')).toBe(layout);
      expect(body.textContent).toContain('message 1');
      expect(container.querySelector('.poolse-reaction-pill')).toBeNull();
      expect(container.querySelectorAll('.custom-reactions').length).toBeGreaterThanOrEqual(8);
      unmount();
    }
  });

  it('renderMessage gets the layout and the default row', async () => {
    const { container } = await mount({
      layout: 'list',
      renderMessage: (m, _me, ctx) =>
        m.id === 'm2' ? <div data-testid="custom">{ctx.layout}</div> : ctx.renderDefault(),
    });
    expect(container.querySelector('[data-testid="custom"]')?.textContent).toBe('list');
    expect(row(container, 'm1').className).toContain('poolse-row--list');
  });

  it('focusMessageId finds a row in the list layout', async () => {
    const { container } = await mount({ layout: 'list', focusMessageId: 'm5' });
    await waitFor(() =>
      expect(row(container, 'm5').classList.contains('poolse-message-row--highlight')).toBe(true),
    );
  });
});
