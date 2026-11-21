import { fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationView, type ChatLayout } from '../src/index.js';
import { member, msg, viewRoutes, wirePage } from './_fixtures.js';
import { jsonResponse, noContent, renderWithProvider, routedFetch } from './_helpers.js';

const feed = (from: number, to: number) => {
  const out = [];
  for (let s = from; s <= to; s++) out.push(msg(s));
  return out;
};

const scrollIntoView = vi.fn();
const original = Element.prototype.scrollIntoView;
beforeEach(() => {
  scrollIntoView.mockClear();
  Element.prototype.scrollIntoView = scrollIntoView;
});
afterEach(() => {
  Element.prototype.scrollIntoView = original;
});

const divider = (c: HTMLElement) => c.querySelector('.poolse-unread-divider');
const dividerBefore = (c: HTMLElement) =>
  divider(c)?.nextElementSibling?.getAttribute('data-message-id');

describe('"New messages" divider', () => {
  for (const layout of ['bubbles', 'list', 'compact'] as ChatLayout[]) {
    it(`${layout}: sits above the first unread, stays after reading, goes on send`, async () => {
      const fetchFn = routedFetch(
        viewRoutes(
          feed(1, 6),
          { 'POST /v1/conversations/c-1/messages': () => jsonResponse(msg(7, 'u-me')) },
          [member('u-me', 'me', { id: 'm3', seq: 3 }), member('u-2', 'two')],
        ),
      );
      const { container } = renderWithProvider(
        <ConversationView conversationId="c-1" layout={layout} loadFonts={false} />,
        fetchFn,
      );
      await waitFor(() => expect(divider(container)).not.toBeNull());
      expect(divider(container)?.textContent).toBe('New messages');
      expect(dividerBefore(container)).toBe('m4');
      // The view marked the conversation read; the divider stays.
      await waitFor(() =>
        expect(fetchFn.calls.some((r) => r.url.endsWith('/conversations/c-1/read'))).toBe(true),
      );
      expect(divider(container)).not.toBeNull();

      // "Jump to first unread" scrolls to it.
      fireEvent.click(container.querySelector('.poolse-conversation__jump-unread-btn')!);
      expect(scrollIntoView).toHaveBeenCalled();

      fireEvent.change(container.querySelector('textarea')!, { target: { value: 'hi' } });
      fireEvent.submit(container.querySelector('form.poolse-composer')!);
      await waitFor(() => expect(divider(container)).toBeNull());
      expect(container.querySelector('.poolse-conversation__jump-unread')).toBeNull();
    });
  }

  it('waits for the read position before marking read (slow members)', async () => {
    let releaseMembers: () => void = () => undefined;
    const membersReady = new Promise<void>((r) => (releaseMembers = r));
    const fetchFn = routedFetch(
      viewRoutes(feed(1, 4), {
        'GET /v1/conversations/c-1/members': () =>
          membersReady.then(() =>
            jsonResponse({ data: [member('u-me', 'me', { id: 'm2', seq: 2 })] }),
          ) as unknown as Response,
      }),
    );
    const { container } = renderWithProvider(
      <ConversationView conversationId="c-1" loadFonts={false} />,
      fetchFn,
    );
    await waitFor(() => expect(container.textContent).toContain('message 4'));
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchFn.calls.some((r) => r.url.endsWith('/read'))).toBe(false);
    releaseMembers();
    await waitFor(() => expect(dividerBefore(container)).toBe('m3'));
    await waitFor(() => expect(fetchFn.calls.some((r) => r.url.endsWith('/read'))).toBe(true));
  });

  it('no divider when everything was read', async () => {
    const { container } = renderWithProvider(
      <ConversationView conversationId="c-1" loadFonts={false} />,
      routedFetch(viewRoutes(feed(1, 3), {}, [member('u-me', 'me', { id: 'm3', seq: 3 })])),
    );
    await waitFor(() => expect(container.textContent).toContain('message 3'));
    await new Promise((r) => setTimeout(r, 20));
    expect(divider(container)).toBeNull();
    expect(container.querySelector('.poolse-conversation__jump-unread')).toBeNull();
  });

  it('the pill loads older pages until the first unread is there', async () => {
    const fetchFn = routedFetch(
      viewRoutes(
        [],
        {
          'GET /v1/conversations/c-1/messages': (req) => {
            const before = new URL(req.url).searchParams.get('before');
            return jsonResponse({ data: wirePage(before ? feed(1, 50) : feed(51, 100)) });
          },
        },
        [member('u-me', 'me', { id: 'm20', seq: 20 })],
      ),
    );
    const { container } = renderWithProvider(
      <ConversationView conversationId="c-1" loadFonts={false} />,
      fetchFn,
    );
    await waitFor(() =>
      expect(container.querySelector('.poolse-conversation__jump-unread-btn')).not.toBeNull(),
    );
    expect(divider(container)).toBeNull();
    fireEvent.click(container.querySelector('.poolse-conversation__jump-unread-btn')!);
    await waitFor(() => expect(dividerBefore(container)).toBe('m21'));
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
  });
});

describe('Mark unread', () => {
  it('list: calls markUnread and moves the divider there', async () => {
    const fetchFn = routedFetch(
      viewRoutes(feed(1, 6), { 'POST /v1/conversations/c-1/unread': () => noContent() }, [
        member('u-me', 'me', { id: 'm6', seq: 6 }),
      ]),
    );
    const { container } = renderWithProvider(
      <ConversationView conversationId="c-1" layout="list" loadFonts={false} />,
      fetchFn,
    );
    await waitFor(() => expect(container.textContent).toContain('message 6'));
    const row = container.querySelector('[data-message-id="m4"]')!;
    fireEvent.click(row.querySelector('[aria-label="More actions"]')!);
    const item = Array.from(row.querySelectorAll('[role="menuitem"]')).find(
      (b) => b.textContent === 'Mark unread',
    )!;
    fireEvent.click(item);
    await waitFor(() => expect(dividerBefore(container)).toBe('m4'));
    const req = fetchFn.calls.find((r) => r.url.endsWith('/conversations/c-1/unread'))!;
    expect(req.method).toBe('POST');
    expect(await req.json()).toEqual({ message_id: 'm4' });
  });

  it('bubbles: offered on others’ messages only', async () => {
    const { container } = renderWithProvider(
      <ConversationView conversationId="c-1" loadFonts={false} />,
      routedFetch(viewRoutes([msg(1), msg(2, 'u-me')])),
    );
    await waitFor(() => expect(container.textContent).toContain('message 2'));
    expect(
      container.querySelector('[data-message-id="m1"] [aria-label="Mark unread"]'),
    ).not.toBeNull();
    expect(container.querySelector('[data-message-id="m2"] [aria-label="Mark unread"]')).toBeNull();
  });
});
