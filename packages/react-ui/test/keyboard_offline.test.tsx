// Keyboard shortcuts (scoped to the focused view), unsent messages from
// the outbox, empty states, and two workspaces side by side.

import { Poolse } from '@poolse/sdk';
import { PoolseProvider } from '@poolse/react';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';
import {
  ConversationList,
  ConversationView,
  DEFAULT_KEYMAP,
  matchesKey,
  resolveKeymap,
} from '../src/index.js';
import { conversation, errorResponse, me, msg, viewRoutes } from './_fixtures.js';
import { jsonResponse, renderWithProvider, routedFetch } from './_helpers.js';

const key = (k: string, mods: Partial<KeyboardEventInit> = {}) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe('keymap', () => {
  it('matches bindings with Mod as Cmd or Ctrl, and letters without modifiers', () => {
    expect(matchesKey(key('Enter', { metaKey: true }), 'Mod+Enter')).toBe(true);
    expect(matchesKey(key('Enter', { ctrlKey: true }), 'Mod+Enter')).toBe(true);
    expect(matchesKey(key('Enter', { metaKey: true }), 'Enter')).toBe(false);
    expect(matchesKey(key('Enter', { shiftKey: true }), 'Enter')).toBe(false);
    expect(matchesKey(key('J', { shiftKey: true }), 'j')).toBe(true);
    expect(matchesKey(key('j', { metaKey: true }), 'j')).toBe(false);
  });

  it('mod+enter mode makes Enter a new line', () => {
    const km = resolveKeymap(undefined, 'mod+enter');
    expect(km.composer.send).toEqual(['Mod+Enter']);
    expect(km.composer.newline).toContain('Enter');
    expect(resolveKeymap({ messageList: { reply: [] } }).messageList.reply).toEqual([]);
    expect(DEFAULT_KEYMAP.messageList.next).toEqual(['j', 'ArrowDown']);
  });
});

const rows = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLElement>('[data-message-id]'));

describe('message list shortcuts', () => {
  it('j / k move focus, r quotes, e edits your own, Esc goes to the composer', async () => {
    const { container } = renderWithProvider(
      <ConversationView conversationId="c-1" loadFonts={false} />,
      routedFetch(viewRoutes([msg(1), msg(2, 'u-me'), msg(3)])),
    );
    await waitFor(() => expect(rows(container)).toHaveLength(3));
    const list = container.querySelector<HTMLElement>('[role="log"]')!;
    expect(list.tabIndex).toBe(0);

    list.focus();
    fireEvent.keyDown(list, { key: 'k' });
    expect(document.activeElement?.getAttribute('data-message-id')).toBe('m3');
    fireEvent.keyDown(document.activeElement!, { key: 'k' });
    expect(document.activeElement?.getAttribute('data-message-id')).toBe('m2');
    fireEvent.keyDown(document.activeElement!, { key: 'j' });
    expect(document.activeElement?.getAttribute('data-message-id')).toBe('m3');

    fireEvent.keyDown(document.activeElement!, { key: 'r' });
    expect(container.querySelector('.poolse-composer__reply')?.textContent).toContain('message 3');

    const m2 = container.querySelector<HTMLElement>('[data-message-id="m2"]')!;
    m2.focus();
    fireEvent.keyDown(m2, { key: 'e' });
    await waitFor(() => expect(container.querySelector('.poolse-message--editing')).not.toBeNull());

    // Someone else's message: e does nothing.
    const m1 = container.querySelector<HTMLElement>('[data-message-id="m1"]')!;
    m1.focus();
    fireEvent.keyDown(m1, { key: 'Escape' });
    expect(document.activeElement?.tagName).toBe('TEXTAREA');
  });

  it('↑ in an empty composer edits your last message', async () => {
    const { container } = renderWithProvider(
      <ConversationView conversationId="c-1" loadFonts={false} />,
      routedFetch(viewRoutes([msg(1, 'u-me'), msg(2)])),
    );
    await waitFor(() => expect(rows(container)).toHaveLength(2));
    const ta = container.querySelector('textarea')!;
    fireEvent.keyDown(ta, { key: 'ArrowUp' });
    await waitFor(() =>
      expect(
        container.querySelector('[data-message-id="m1"] .poolse-message--editing'),
      ).not.toBeNull(),
    );
  });

  it('Delete asks first, and only deletes your own', async () => {
    const del = vi.fn(() => new Response(null, { status: 204 }));
    const confirmDelete = vi.fn(() => true);
    const { container } = renderWithProvider(
      <ConversationView conversationId="c-1" loadFonts={false} confirmDelete={confirmDelete} />,
      routedFetch(viewRoutes([msg(1), msg(2, 'u-me')], { 'DELETE /v1/messages/m2': del })),
    );
    await waitFor(() => expect(rows(container)).toHaveLength(2));
    const m1 = container.querySelector<HTMLElement>('[data-message-id="m1"]')!;
    m1.focus();
    fireEvent.keyDown(m1, { key: 'Delete' });
    expect(confirmDelete).not.toHaveBeenCalled();
    const m2 = container.querySelector<HTMLElement>('[data-message-id="m2"]')!;
    m2.focus();
    fireEvent.keyDown(m2, { key: 'Delete' });
    expect(confirmDelete).toHaveBeenCalledOnce();
    await waitFor(() => expect(del).toHaveBeenCalledOnce());
  });

  it('sendOn="mod+enter": Enter is a new line, Cmd+Enter sends', async () => {
    const post = vi.fn(() => jsonResponse(msg(9, 'u-me')));
    const { container } = renderWithProvider(
      <ConversationView conversationId="c-1" loadFonts={false} sendOn="mod+enter" />,
      routedFetch(viewRoutes([msg(1)], { 'POST /v1/conversations/c-1/messages': post })),
    );
    await waitFor(() => expect(rows(container)).toHaveLength(1));
    const ta = container.querySelector('textarea')!;
    fireEvent.change(ta, { target: { value: 'two lines' } });
    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(post).not.toHaveBeenCalled();
    fireEvent.keyDown(ta, { key: 'Enter', metaKey: true });
    await waitFor(() => expect(post).toHaveBeenCalledOnce());
  });
});

describe('side by side', () => {
  it('Esc closes only the thread that has focus', async () => {
    const root = msg(1, 'u-2', { reply_count: 1 });
    const routes = viewRoutes([root], {
      'GET /v1/messages/m1/replies': () => jsonResponse({ data: [] }),
    });
    const { container } = renderWithProvider(
      <>
        <div data-pane="a">
          <ConversationView conversationId="c-1" loadFonts={false} />
        </div>
        <div data-pane="b">
          <ConversationView conversationId="c-1" loadFonts={false} />
        </div>
      </>,
      routedFetch(routes),
    );
    await waitFor(() => expect(rows(container)).toHaveLength(2));
    for (const pane of ['a', 'b']) {
      const pill = container.querySelector<HTMLElement>(
        `[data-pane="${pane}"] .poolse-thread-pill button, [data-pane="${pane}"] .poolse-thread-pill`,
      )!;
      fireEvent.click(pill);
    }
    await waitFor(() => expect(container.querySelectorAll('.poolse-thread')).toHaveLength(2));
    const threadA = container.querySelector<HTMLElement>('[data-pane="a"] .poolse-thread')!;
    fireEvent.keyDown(threadA.querySelector('button')!, { key: 'Escape' });
    await waitFor(() => expect(container.querySelectorAll('.poolse-thread')).toHaveLength(1));
    expect(container.querySelector('[data-pane="b"] .poolse-thread')).not.toBeNull();
  });

  it('two workspaces keep their own drafts for the same conversation id', async () => {
    const make = (apiUrl: string) =>
      new Poolse({ apiUrl, getToken: () => 'jwt', fetch: routedFetch(viewRoutes([msg(1)])) });
    const a = make('https://a.test');
    const b = make('https://b.test');
    const { container } = render(
      <>
        <div data-pane="a">
          <PoolseProvider client={a} trackActivity={false}>
            <ConversationView conversationId="c-1" loadFonts={false} />
          </PoolseProvider>
        </div>
        <div data-pane="b">
          <PoolseProvider client={b} trackActivity={false}>
            <ConversationView conversationId="c-1" loadFonts={false} />
          </PoolseProvider>
        </div>
      </>,
    );
    await waitFor(() => expect(rows(container)).toHaveLength(2));
    const taA = container.querySelector<HTMLTextAreaElement>('[data-pane="a"] textarea')!;
    fireEvent.change(taA, { target: { value: 'for acme' } });
    await waitFor(() =>
      expect(localStorage.getItem('poolse:v1:https://a.test#u-me:draft:c-1')).toContain('for acme'),
    );
    expect(localStorage.getItem('poolse:v1:https://b.test#u-me:draft:c-1')).toBeNull();

    // Signing out of one removes its drafts and leaves the other's.
    const taB = container.querySelector<HTMLTextAreaElement>('[data-pane="b"] textarea')!;
    fireEvent.change(taB, { target: { value: 'for beta' } });
    await waitFor(() =>
      expect(localStorage.getItem('poolse:v1:https://b.test#u-me:draft:c-1')).toContain('for beta'),
    );
    await act(async () => {
      await a.destroy({ clearStorage: true });
    });
    expect(localStorage.getItem('poolse:v1:https://a.test#u-me:draft:c-1')).toBeNull();
    expect(localStorage.getItem('poolse:v1:https://b.test#u-me:draft:c-1')).toContain('for beta');
    await b.destroy({ clearStorage: true });
  });
});

describe('unsent messages', () => {
  it('a DLP warning in the default view asks first, then sends with the acknowledgement', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const { container, findByRole, getByText } = renderWithProvider(
      <ConversationView conversationId="c-1" loadFonts={false} />,
      routedFetch(
        viewRoutes([msg(1)], {
          'POST /v1/conversations/c-1/messages': (req) => {
            const n = bodies.length;
            void req
              .clone()
              .json()
              .then((b) => bodies.push(b as Record<string, unknown>));
            return n === 0
              ? jsonResponse(
                  {
                    error: {
                      code: 'dlp_warning',
                      message: 'warn',
                      doc_url: '',
                      details: { rules: [{ id: 'cards', name: 'Card number' }] },
                    },
                  },
                  { status: 422 },
                )
              : jsonResponse({ data: msg(2) }, { status: 201 });
          },
        }),
      ),
    );
    await waitFor(() => expect(rows(container)).toHaveLength(1));
    const ta = container.querySelector('textarea')!;
    fireEvent.change(ta, { target: { value: 'card 4111111111111111' } });
    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(await findByRole('alertdialog')).toBeTruthy();
    // No failed row with a Retry that would be refused forever.
    expect(container.querySelector('.poolse-send-status--failed')).toBeNull();
    await act(async () => {
      fireEvent.click(getByText('Send anyway'));
    });
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]).toMatchObject({ body: 'card 4111111111111111', dlp_acknowledged: true });
  });

  it('a refused send stays with Retry and Delete, and passes axe', async () => {
    const { container } = renderWithProvider(
      <ConversationView conversationId="c-1" loadFonts={false} />,
      routedFetch(
        viewRoutes([msg(1)], {
          'POST /v1/conversations/c-1/messages': () => errorResponse(403, 'forbidden'),
        }),
      ),
    );
    await waitFor(() => expect(rows(container)).toHaveLength(1));
    const ta = container.querySelector('textarea')!;
    fireEvent.change(ta, { target: { value: 'not allowed' } });
    fireEvent.keyDown(ta, { key: 'Enter' });
    await waitFor(() =>
      expect(container.querySelector('.poolse-send-status--failed')).not.toBeNull(),
    );
    expect(container.textContent).toContain('not allowed');
    expect(container.querySelector('.poolse-send-status__text')?.textContent).toBe(
      'Not sent: forbidden',
    );
    expect(ta.value).toBe('');
    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.poolse-send-status__button'),
    ).map((b) => b.textContent);
    expect(buttons).toEqual(['Retry', 'Delete']);

    const result = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
    });
    expect(result.violations.map((v) => v.id)).toEqual([]);

    fireEvent.click(
      Array.from(container.querySelectorAll('.poolse-send-status__button')).find(
        (b) => b.textContent === 'Delete',
      )!,
    );
    await waitFor(() => expect(container.querySelector('.poolse-send-status')).toBeNull());
    expect(rows(container)).toHaveLength(1);
  });
});

describe('empty states', () => {
  it('an empty channel says what to do next; read-only says less', async () => {
    const { container, rerender } = renderWithProvider(
      <ConversationView conversationId="c-1" loadFonts={false} />,
      routedFetch(viewRoutes([])),
    );
    await waitFor(() => expect(container.querySelector('.poolse-empty-state')).not.toBeNull());
    expect(container.querySelector('.poolse-empty-state__hint')?.textContent).toContain(
      'first message',
    );
    rerender(<ConversationView conversationId="c-1" loadFonts={false} readOnly />);
    expect(container.querySelector('.poolse-empty-state__hint')).toBeNull();
    rerender(
      <ConversationView
        conversationId="c-1"
        loadFonts={false}
        emptyState={({ readOnly }) => <p data-custom>{readOnly ? 'ro' : 'rw'}</p>}
      />,
    );
    expect(container.querySelector('[data-custom]')?.textContent).toBe('rw');
  });

  it('a conversation search with no results says so, with the query', async () => {
    const routes = {
      'GET /v1/me': () => jsonResponse(me),
      'GET /v1/conversations': () =>
        jsonResponse({ data: [conversation('c-1'), conversation('c-2')], next_cursor: null }),
    };
    const { container, rerender } = renderWithProvider(
      <ConversationList query="c-2" />,
      routedFetch(routes),
    );
    await waitFor(() => expect(container.querySelectorAll('[role="option"]')).toHaveLength(1));
    rerender(<ConversationList query="zzzz-a-very-long-query-that-matches-nothing-at-all" />);
    expect(container.querySelector('.poolse-empty-state__title')?.textContent).toContain(
      'zzzz-a-very-long-query',
    );
  });
});
