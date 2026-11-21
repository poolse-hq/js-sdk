import { waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationList } from '../src/index.js';
import { conversation, me } from './_fixtures.js';
import { jsonResponse, renderWithProvider, routedFetch } from './_helpers.js';

// happy-dom never reports intersections: this one says "visible" as
// soon as something is observed.
class VisibleObserver {
  constructor(private readonly cb: IntersectionObserverCallback) {}
  observe(target: Element) {
    queueMicrotask(() =>
      this.cb(
        [{ isIntersecting: true, target } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      ),
    );
  }
  disconnect() {}
  unobserve() {}
  takeRecords() {
    return [];
  }
}

const OriginalIO = globalThis.IntersectionObserver;
beforeEach(() => {
  globalThis.IntersectionObserver = VisibleObserver as unknown as typeof IntersectionObserver;
});
afterEach(() => {
  globalThis.IntersectionObserver = OriginalIO;
});

const titles = (c: HTMLElement) =>
  Array.from(c.querySelectorAll('.poolse-list__item .poolse-list__title')).map(
    (e) => e.textContent,
  );

describe('<ConversationList> S6', () => {
  it('loads the next page when scrolled to the end', async () => {
    const fetchFn = routedFetch({
      'GET /v1/me': () => jsonResponse(me),
      'GET /v1/presence': () => jsonResponse({ data: [] }),
      'GET /v1/conversations': (req) =>
        new URL(req.url).searchParams.get('cursor') === 'p2'
          ? jsonResponse({ data: [conversation('c-3')], next_cursor: null })
          : jsonResponse({ data: [conversation('c-1'), conversation('c-2')], next_cursor: 'p2' }),
    });
    const { container } = renderWithProvider(<ConversationList />, fetchFn);
    await waitFor(() =>
      expect(titles(container)).toEqual(['Channel c-1', 'Channel c-2', 'Channel c-3']),
    );
    // Last page: no sentinel left.
    await waitFor(() => expect(container.querySelector('.poolse-list__sentinel')).toBeNull());
  });

  it('controlled paging calls onLoadMore and shows loadingMore', async () => {
    const onLoadMore = vi.fn();
    const { container, rerender } = renderWithProvider(
      <ConversationList
        conversations={[conversation('c-1')] as never}
        hasMore
        onLoadMore={onLoadMore}
      />,
      routedFetch({
        'GET /v1/me': () => jsonResponse(me),
        'GET /v1/conversations': () => jsonResponse({ data: [] }),
      }),
    );
    await waitFor(() => expect(onLoadMore).toHaveBeenCalled());
    rerender(
      <ConversationList
        conversations={[conversation('c-1')] as never}
        hasMore
        loadingMore
        onLoadMore={onLoadMore}
      />,
    );
    expect(container.querySelector('.poolse-list__loading-more')?.textContent).toBe('Loading…');
  });

  it('groupBy="type" splits Channels and Direct messages; header and density', async () => {
    const list = [
      conversation('c-1'),
      conversation('d-1', { type: 'direct', name: 'Dee', member_external_ids: ['me', 'dee'] }),
      conversation('c-2'),
    ];
    const { container } = renderWithProvider(
      <ConversationList
        conversations={list as never}
        groupBy="type"
        density="compact"
        header={<h2>Chats</h2>}
        showPresence={false}
      />,
      routedFetch({
        'GET /v1/me': () => jsonResponse(me),
        'GET /v1/conversations': () => jsonResponse({ data: [] }),
      }),
    );
    await waitFor(() =>
      expect(container.querySelectorAll('.poolse-list__section')).toHaveLength(2),
    );
    const sections = Array.from(container.querySelectorAll('.poolse-list__section'));
    expect(sections.map((s) => s.getAttribute('aria-label'))).toEqual([
      'Channels',
      'Direct messages',
    ]);
    expect(sections[0]!.querySelectorAll('[role="option"]')).toHaveLength(2);
    expect(sections[1]!.querySelectorAll('[role="option"]')).toHaveLength(1);
    expect(container.querySelector('.poolse-conversation-list__header')?.textContent).toBe('Chats');
    expect(container.querySelector('.poolse-conversation-list--density-compact')).not.toBeNull();
    expect(container.querySelector('.poolse-list__preview')).toBeNull();
  });

  it('custom sections take each conversation once and hide empty ones', async () => {
    const list = [conversation('a'), conversation('b'), conversation('c')];
    const { container } = renderWithProvider(
      <ConversationList
        conversations={list as never}
        sections={[
          { title: 'Starred', filter: (c) => c.id === 'b' },
          { title: 'Nothing', filter: () => false },
          { title: 'All', filter: () => true },
        ]}
      />,
      routedFetch({
        'GET /v1/me': () => jsonResponse(me),
        'GET /v1/conversations': () => jsonResponse({ data: [] }),
      }),
    );
    await waitFor(() =>
      expect(container.querySelectorAll('.poolse-list__section')).toHaveLength(2),
    );
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(3);
    expect(container.querySelector('[aria-label="Starred"]')?.textContent).toContain('Channel b');
  });
});
