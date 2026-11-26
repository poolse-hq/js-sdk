// Automated accessibility check: axe-core over the main components as
// they render in happy-dom. Colour contrast is left to the theme's own
// contrast tests (happy-dom doesn't compute styles); everything else —
// names, roles, ARIA validity, labels — is checked here.

import { waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import { ConversationList, ConversationView, MemberList, ThreadView } from '../src/index.js';
import { conversation, me, member, msg, names, viewRoutes } from './_fixtures.js';
import { jsonResponse, renderWithProvider, routedFetch } from './_helpers.js';

async function violations(root: Element) {
  const result = await axe.run(root, {
    rules: {
      // happy-dom has no layout or computed colours.
      'color-contrast': { enabled: false },
      // Components render inside a test page, not a full document.
      region: { enabled: false },
      'landmark-one-main': { enabled: false },
      'page-has-heading-one': { enabled: false },
    },
  });
  return result.violations.map((v) => ({
    id: v.id,
    help: v.help,
    nodes: v.nodes.map((n) => n.html.slice(0, 160)),
  }));
}

describe('accessibility (axe)', () => {
  it('ConversationView with messages, reactions and a composer', async () => {
    const messages = [
      msg(1),
      msg(2, 'u-me', { reactions: { '👍': ['u-2'] } }),
      msg(3, 'u-2', { reply_count: 2, last_reply_at: '2026-01-01T10:05:00Z' }),
    ];
    const members = [member('u-me', 'me'), member('u-2', 'two'), member('u-3', 'three')];
    const { container } = renderWithProvider(
      <ConversationView conversationId="c-1" />,
      routedFetch(viewRoutes(messages, {}, members)),
    );
    await waitFor(() => expect(container.querySelectorAll('[data-message-id]').length).toBe(3));
    const v = await violations(container);
    if (v.length) console.log('AXE', JSON.stringify(v, null, 1));
    expect(v).toEqual([]);
  });

  it('ConversationView empty', async () => {
    const { container } = renderWithProvider(
      <ConversationView conversationId="c-1" />,
      routedFetch(viewRoutes([])),
    );
    await waitFor(() => expect(container.querySelector('.poolse-empty-state')).not.toBeNull());
    const v = await violations(container);
    if (v.length) console.log('AXE', JSON.stringify(v, null, 1));
    expect(v).toEqual([]);
  });

  it('ConversationList with rows and sections', async () => {
    const { container } = renderWithProvider(
      <ConversationList groupBy="type" selectedId="c-1" />,
      routedFetch({
        'GET /v1/me': () => jsonResponse(me),
        'GET /v1/conversations': () =>
          jsonResponse({
            data: [
              conversation('c-1', { unread_count: 2 }),
              conversation('c-2', { type: 'direct', member_external_ids: ['me', 'two'] }),
            ],
            next_cursor: null,
          }),
        'GET /v1/presence': () => jsonResponse({ data: [] }),
      }),
    );
    await waitFor(() => expect(container.querySelectorAll('[role="option"]').length).toBe(2));
    const v = await violations(container);
    if (v.length) console.log('AXE', JSON.stringify(v, null, 1));
    expect(v).toEqual([]);
  });

  it('ConversationList empty', async () => {
    const { container } = renderWithProvider(
      <ConversationList />,
      routedFetch({
        'GET /v1/me': () => jsonResponse(me),
        'GET /v1/conversations': () => jsonResponse({ data: [], next_cursor: null }),
      }),
    );
    await waitFor(() => expect(container.querySelector('.poolse-empty-state')).not.toBeNull());
    const v = await violations(container);
    if (v.length) console.log('AXE', JSON.stringify(v, null, 1));
    expect(v).toEqual([]);
  });

  it('ThreadView', async () => {
    const root = msg(3, 'u-2', { reply_count: 1 });
    const { container } = renderWithProvider(
      <ThreadView conversationId="c-1" rootMessage={root as never} onClose={() => {}} />,
      routedFetch(
        viewRoutes([], {
          'GET /v1/messages/m3/replies': () =>
            jsonResponse({ data: [msg(4, 'u-me', { thread_root_id: 'm3' })] }),
        }),
      ),
    );
    await waitFor(() => expect(container.querySelector('[data-message-id="m4"]')).not.toBeNull());
    const v = await violations(container);
    if (v.length) console.log('AXE', JSON.stringify(v, null, 1));
    expect(v).toEqual([]);
  });

  it('MemberList', async () => {
    const { container } = renderWithProvider(
      <MemberList conversationId="c-1" labelFor={names} />,
      routedFetch(viewRoutes([], {}, [member('u-me', 'me'), member('u-2', 'two')])),
    );
    await waitFor(() => expect(container.textContent).toContain('Two'));
    const v = await violations(container);
    if (v.length) console.log('AXE', JSON.stringify(v, null, 1));
    expect(v).toEqual([]);
  });
});
