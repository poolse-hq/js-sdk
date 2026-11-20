import { fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConversationList, ConversationView } from '../src/index.js';
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

const msg = (seq: number, sender = 'u-2') => ({
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
  inserted_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});

/** Newest-first, as the wire sends it. */
const page = (from: number, to: number) => {
  const out = [];
  for (let s = to; s >= from; s--) out.push(msg(s));
  return out;
};

const conv = (id: string, unread: number) => ({
  id,
  tenant_id: 't-1',
  type: 'group' as const,
  name: `Channel ${id}`,
  avatar_url: null,
  created_by_user_id: 'u-1',
  member_limit: null,
  custom_data: {},
  settings: {},
  last_message_at: null,
  last_message_preview: null,
  last_sequence: 3,
  unread_count: unread,
  inserted_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});

function routes(messages: (req: Request) => Response) {
  return routedFetch({
    'GET /v1/me': () => jsonResponse(me),
    'GET /v1/conversations': () => jsonResponse({ data: [conv('c-1', 2), conv('c-2', 1)] }),
    'GET /v1/conversations/c-1/messages': messages,
    'GET /v1/conversations/c-1/members': () => jsonResponse({ data: [] }),
    'POST /v1/conversations/c-1/read': () => noContent(),
  });
}

describe('<ConversationView> composer', () => {
  it('composer={false} renders no composer', async () => {
    const fetchFn = routes(() => jsonResponse({ data: page(1, 3) }));
    const { container } = renderWithProvider(
      <ConversationView conversationId="c-1" composer={false} loadFonts={false} />,
      fetchFn,
    );
    await waitFor(() => expect(container.textContent).toContain('message 3'));
    expect(container.querySelector('.poolse-composer')).toBeNull();
    expect(container.querySelector('.poolse-conversation__composer-row')).toBeNull();
  });

  it('readOnly does the same', async () => {
    const fetchFn = routes(() => jsonResponse({ data: page(1, 3) }));
    const { container } = renderWithProvider(
      <ConversationView conversationId="c-1" readOnly loadFonts={false} />,
      fetchFn,
    );
    await waitFor(() => expect(container.textContent).toContain('message 3'));
    expect(container.querySelector('.poolse-composer')).toBeNull();
  });
});

describe('<ConversationView> mark read', () => {
  it('clears the list badge once the server accepts the read', async () => {
    const fetchFn = routes(() => jsonResponse({ data: page(1, 3) }));
    const onMarkedRead = vi.fn();
    const { container } = renderWithProvider(
      <>
        <ConversationList />
        <ConversationView conversationId="c-1" onMarkedRead={onMarkedRead} loadFonts={false} />
      </>,
      fetchFn,
    );

    await waitFor(() => expect(onMarkedRead).toHaveBeenCalledWith('c-1'));
    await waitFor(() =>
      expect(container.querySelectorAll('.poolse-list__unread-badge')).toHaveLength(1),
    );
    expect(container.querySelector('.poolse-list__unread-badge')?.textContent).toBe('1');
    expect(fetchFn.calls.some((r) => r.url.endsWith('/v1/conversations/c-1/read'))).toBe(true);
  });
});

describe('<ConversationView> focusMessageId', () => {
  it('loads older pages until the message is there, then highlights it', async () => {
    const fetchFn = routes((req) => {
      const before = new URL(req.url).searchParams.get('before');
      if (before === null) return jsonResponse({ data: page(51, 100) });
      if (before === '51') return jsonResponse({ data: page(1, 50) });
      return jsonResponse({ data: [] });
    });
    const { container } = renderWithProvider(
      <ConversationView conversationId="c-1" focusMessageId="m7" loadFonts={false} />,
      fetchFn,
    );

    await waitFor(() =>
      expect(
        container
          .querySelector('[data-message-id="m7"]')
          ?.classList.contains('poolse-message-row--highlight'),
      ).toBe(true),
    );
  });

  it('reports a message it cannot find', async () => {
    const fetchFn = routes(() => jsonResponse({ data: page(1, 3) }));
    const onNotFound = vi.fn();
    const { container } = renderWithProvider(
      <ConversationView
        conversationId="c-1"
        focusMessageId="gone"
        onFocusMessageNotFound={onNotFound}
        loadFonts={false}
      />,
      fetchFn,
    );

    await waitFor(() => expect(onNotFound).toHaveBeenCalledWith('gone'));
    expect(container.textContent).toContain("That message isn't available.");
  });
});

describe('<ConversationView> sender and avatar presses', () => {
  it('calls onSenderPress / onAvatarPress with the sender', async () => {
    const fetchFn = routes(() => jsonResponse({ data: page(1, 1) }));
    const onSenderPress = vi.fn();
    const onAvatarPress = vi.fn();
    const { container } = renderWithProvider(
      <ConversationView
        conversationId="c-1"
        senderLabels="always"
        avatars="always"
        onSenderPress={onSenderPress}
        onAvatarPress={onAvatarPress}
        loadFonts={false}
      />,
      fetchFn,
    );
    await waitFor(() =>
      expect(container.querySelector('.poolse-message__sender--button')).not.toBeNull(),
    );

    fireEvent.click(container.querySelector('.poolse-message__sender--button')!);
    fireEvent.click(container.querySelector('.poolse-bubble-shell__avatar-button')!);

    const user = { userId: 'u-2', externalId: 'two', displayName: 'two', avatarUrl: null };
    expect(onSenderPress).toHaveBeenCalledWith(user);
    expect(onAvatarPress).toHaveBeenCalledWith(user);
  });

  it('keeps plain labels without the handlers', async () => {
    const fetchFn = routes(() => jsonResponse({ data: page(1, 1) }));
    const { container } = renderWithProvider(
      <ConversationView
        conversationId="c-1"
        senderLabels="always"
        avatars="always"
        loadFonts={false}
      />,
      fetchFn,
    );
    await waitFor(() => expect(container.querySelector('.poolse-message__sender')).not.toBeNull());
    expect(container.querySelector('.poolse-message__sender--button')).toBeNull();
    expect(container.querySelector('.poolse-bubble-shell__avatar-button')).toBeNull();
  });
});
