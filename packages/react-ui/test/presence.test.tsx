import { render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  Avatar,
  ChatHeader,
  ConversationList,
  ConversationView,
  MemberList,
  PresenceBadge,
  presenceText,
} from '../src/index.js';
import { jsonResponse, renderWithProvider, routedFetch } from './_helpers.js';

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

const presence = (external_id: string, state: string, extra: Record<string, unknown> = {}) => ({
  user_id: `uid-${external_id}`,
  external_id,
  state,
  last_seen_at: '2026-01-01T00:00:00Z',
  ...extra,
});

const member = (ext: string) => ({
  id: `m-${ext}`,
  conversation_id: 'c-1',
  user_id: ext === 'me' ? 'u-me' : `uid-${ext}`,
  external_id: ext,
  role: 'member',
  last_read_message_id: null,
  last_read_sequence: null,
  last_read_at: null,
  inserted_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});

const directConv = {
  id: 'c-1',
  tenant_id: 't-1',
  type: 'direct',
  name: null,
  avatar_url: null,
  created_by_user_id: 'u-me',
  member_limit: null,
  custom_data: {},
  settings: {},
  last_message_at: null,
  last_message_preview: null,
  last_sequence: 0,
  member_external_ids: ['me', 'bob'],
  inserted_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

function presenceRoutes(states: Record<string, ReturnType<typeof presence>>) {
  return {
    'GET /v1/me': () => jsonResponse(me),
    'GET /v1/presence': (req: Request) => {
      const ids = new URL(req.url).searchParams.getAll('external_ids');
      const flat = ids.flatMap((v) => v.split(','));
      return jsonResponse({ data: flat.map((id) => states[id]).filter(Boolean) });
    },
  };
}

describe('<PresenceBadge>', () => {
  it('draws online, away and in-call, nothing when offline', () => {
    const { container, rerender } = render(<PresenceBadge state="online" />);
    expect(container.querySelector('.poolse-presence-badge--online')).not.toBeNull();
    rerender(<PresenceBadge state="away" />);
    expect(container.querySelector('.poolse-presence-badge--away')).not.toBeNull();
    rerender(<PresenceBadge state="in_call" />);
    const call = container.querySelector('.poolse-presence-badge--in_call');
    expect(call?.querySelector('svg')).not.toBeNull();
    expect(call?.getAttribute('aria-label')).toBe('In a call');
    rerender(<PresenceBadge state="offline" />);
    expect(container.querySelector('.poolse-presence-badge')).toBeNull();
  });

  it('shows a moon for do not disturb', () => {
    const { container } = render(<PresenceBadge state="online" doNotDisturb />);
    const badge = container.querySelector('.poolse-presence-badge--dnd');
    expect(badge?.getAttribute('aria-label')).toBe('Do not disturb');
  });

  it('presenceText reads state or last seen', () => {
    const now = Date.parse('2026-01-01T02:00:00Z');
    expect(presenceText(presence('a', 'online') as never, now)).toBe('Online');
    expect(presenceText(presence('a', 'in_call') as never, now)).toBe('In a call');
    expect(presenceText(presence('a', 'offline') as never, now)).toBe('Last seen 2h ago');
    expect(presenceText(null)).toBeNull();
  });
});

describe('<Avatar presence>', () => {
  it('takes a state or a Presence', () => {
    const { container, rerender } = render(<Avatar name="x" presence="away" />);
    expect(
      container.querySelector('.poolse-avatar__badge.poolse-presence-badge--away'),
    ).not.toBeNull();
    rerender(
      <Avatar name="x" presence={presence('x', 'online', { do_not_disturb: true }) as never} />,
    );
    expect(container.querySelector('.poolse-presence-badge--dnd')).not.toBeNull();
  });

  it('presence={true} looks the user up', async () => {
    const fetchFn = routedFetch(presenceRoutes({ bob: presence('bob', 'in_call') }));
    const { container } = renderWithProvider(<Avatar name="Bob" presence userId="bob" />, fetchFn);
    await waitFor(() =>
      expect(container.querySelector('.poolse-presence-badge--in_call')).not.toBeNull(),
    );
  });
});

describe('presence in the chat surfaces', () => {
  it('ConversationList badges direct rows; showPresence={false} turns it off', async () => {
    const routes = {
      ...presenceRoutes({ bob: presence('bob', 'online') }),
      'GET /v1/conversations': () => jsonResponse({ data: [directConv] }),
    };
    const { container, unmount } = renderWithProvider(<ConversationList />, routedFetch(routes));
    await waitFor(() =>
      expect(
        container.querySelector('.poolse-list__item .poolse-presence-badge--online'),
      ).not.toBeNull(),
    );
    unmount();
    const off = renderWithProvider(<ConversationList showPresence={false} />, routedFetch(routes));
    await waitFor(() => expect(off.container.querySelector('.poolse-list__item')).not.toBeNull());
    expect(off.container.querySelector('.poolse-presence-badge')).toBeNull();
  });

  it('ChatHeader shows the state text for a direct chat', async () => {
    const fetchFn = routedFetch({
      ...presenceRoutes({ bob: presence('bob', 'away') }),
      'GET /v1/conversations/c-1': () => jsonResponse(directConv),
      'GET /v1/conversations/c-1/members': () =>
        jsonResponse({ data: [member('me'), member('bob')] }),
    });
    const { container } = renderWithProvider(<ChatHeader conversationId="c-1" />, fetchFn);
    await waitFor(() =>
      expect(container.querySelector('.poolse-chat-header__subtitle')?.textContent).toBe('Away'),
    );
    expect(container.querySelector('.poolse-presence-badge--away')).not.toBeNull();
  });

  it('MemberList shows each member’s presence', async () => {
    const fetchFn = routedFetch({
      ...presenceRoutes({ bob: presence('bob', 'in_call'), carol: presence('carol', 'offline') }),
      'GET /v1/conversations/c-1/members': () =>
        jsonResponse({ data: [member('bob'), member('carol')] }),
    });
    const { container } = renderWithProvider(<MemberList conversationId="c-1" />, fetchFn);
    await waitFor(() => expect(container.textContent).toContain('In a call'));
    expect(container.textContent).toMatch(/Last seen/);
    expect(container.querySelectorAll('.poolse-presence-badge')).toHaveLength(1);
  });

  it('ConversationView badges message avatars only with showPresence', async () => {
    const msg = {
      id: 'm1',
      tenant_id: 't-1',
      conversation_id: 'c-1',
      sender_id: 'uid-bob',
      sender_external_id: 'bob',
      type: 'text',
      body: 'hello',
      reply_to_id: null,
      thread_root_id: null,
      mentions: [],
      reactions: {},
      edited_at: null,
      deleted_at: null,
      sequence: 1,
      inserted_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
    const routes = {
      ...presenceRoutes({ bob: presence('bob', 'online') }),
      'GET /v1/conversations/c-1/messages': () => jsonResponse({ data: [msg] }),
      'GET /v1/conversations/c-1/members': () => jsonResponse({ data: [] }),
      'POST /v1/conversations/c-1/read': () => new Response(null, { status: 204 }),
    };
    const plain = renderWithProvider(
      <ConversationView conversationId="c-1" layout="list" loadFonts={false} />,
      routedFetch(routes),
    );
    await waitFor(() => expect(plain.container.textContent).toContain('hello'));
    expect(plain.container.querySelector('.poolse-presence-badge')).toBeNull();
    plain.unmount();

    const withPresence = renderWithProvider(
      <ConversationView conversationId="c-1" layout="list" showPresence loadFonts={false} />,
      routedFetch(routes),
    );
    await waitFor(() =>
      expect(
        withPresence.container.querySelector('.poolse-row .poolse-presence-badge--online'),
      ).not.toBeNull(),
    );
  });
});
