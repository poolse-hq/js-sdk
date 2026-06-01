// MessageBubble — focused on the rendering invariants we care about
// for v1.0: markdown XSS safety, sender-label gating, group-position
// → corner-class mapping.

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { PoolseProvider } from '@poolse/react';
import type { Message } from '@poolse/sdk';
import { MessageBubble } from '../src/MessageBubble.js';

function withProvider(children: ReactNode) {
  return (
    <PoolseProvider
      config={{
        apiUrl: 'https://chat.test',
        getToken: () => 'jwt',
        fetch: async () => new Response('{}'),
      }}
    >
      {children}
    </PoolseProvider>
  );
}

function msg(partial: Partial<Message> = {}): Message {
  return {
    id: 'm-1',
    tenant_id: 't',
    conversation_id: 'c',
    sender_id: 'u-other',
    type: 'text',
    body: 'hello',
    reply_to_id: null,
    thread_root_id: null,
    mentions: [],
    reactions: {},
    edited_at: null,
    deleted_at: null,
    sequence: 1,
    inserted_at: '2026-06-01T10:00:00Z',
    updated_at: '2026-06-01T10:00:00Z',
    ...partial,
  } as Message;
}

describe('<MessageBubble> markdown XSS safety', () => {
  it('strips <script> tags from message bodies', () => {
    const { container } = render(
      withProvider(
        <MessageBubble
          message={msg({ body: 'before<script>alert(1)</script>after' })}
          currentUserId={null}
          markdown
        />,
      ),
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('before');
  });

  it('removes javascript: URLs from markdown links', () => {
    const { container } = render(
      withProvider(
        <MessageBubble
          message={msg({ body: '[click](javascript:alert(1))' })}
          currentUserId={null}
          markdown
        />,
      ),
    );
    const link = container.querySelector('a');
    if (link) {
      expect(link.getAttribute('href')).not.toMatch(/^javascript:/i);
    }
  });

  it('does not render onclick / onerror attrs from markdown', () => {
    const { container } = render(
      withProvider(
        <MessageBubble
          message={msg({ body: '<img src=x onerror="alert(1)">' })}
          currentUserId={null}
          markdown
        />,
      ),
    );
    // react-markdown strips raw HTML by default — img shouldn't render
    // at all.
    expect(container.querySelector('img')).toBeNull();
  });
});

describe('<MessageBubble> group-position class mapping', () => {
  it('"standalone" adds the standalone modifier', () => {
    const { container } = render(
      withProvider(
        <MessageBubble message={msg()} currentUserId={null} groupPosition="standalone" />,
      ),
    );
    expect(container.querySelector('.poolse-message--standalone')).not.toBeNull();
  });

  it('"first" / "middle" / "last" each get their own modifier', () => {
    for (const pos of ['first', 'middle', 'last'] as const) {
      const { container } = render(
        withProvider(<MessageBubble message={msg()} currentUserId={null} groupPosition={pos} />),
      );
      expect(container.querySelector(`.poolse-message--${pos}`)).not.toBeNull();
    }
  });
});

describe('<MessageBubble> sender label gating', () => {
  it('renders sender name only on first / standalone (other-side)', () => {
    const message = msg({ sender_id: 'u-other' });
    for (const pos of ['first', 'standalone'] as const) {
      const { container } = render(
        withProvider(
          <MessageBubble
            message={message}
            currentUserId="u-me"
            showSenderName
            groupPosition={pos}
          />,
        ),
      );
      expect(container.querySelector('.poolse-message__sender')).not.toBeNull();
    }
    for (const pos of ['middle', 'last'] as const) {
      const { container } = render(
        withProvider(
          <MessageBubble
            message={message}
            currentUserId="u-me"
            showSenderName
            groupPosition={pos}
          />,
        ),
      );
      expect(container.querySelector('.poolse-message__sender')).toBeNull();
    }
  });

  it('never renders sender label on self bubbles', () => {
    const { container } = render(
      withProvider(
        <MessageBubble
          message={msg({ sender_id: 'u-me' })}
          currentUserId="u-me"
          showSenderName
          groupPosition="standalone"
        />,
      ),
    );
    expect(container.querySelector('.poolse-message__sender')).toBeNull();
  });
});

describe('<MessageBubble> trim + Read more', () => {
  it('truncates over maxBodyLength with a Read more button', () => {
    const longBody = 'x'.repeat(500);
    const { container, getByText } = render(
      withProvider(
        <MessageBubble
          message={msg({ body: longBody })}
          currentUserId={null}
          maxBodyLength={100}
        />,
      ),
    );
    expect(container.textContent).toContain('…');
    expect(getByText('Read more')).not.toBeNull();
  });

  it('renders full body when under maxBodyLength + buffer', () => {
    const shortBody = 'short message';
    const { container, queryByText } = render(
      withProvider(
        <MessageBubble
          message={msg({ body: shortBody })}
          currentUserId={null}
          maxBodyLength={100}
        />,
      ),
    );
    expect(container.textContent).toContain(shortBody);
    expect(queryByText('Read more')).toBeNull();
  });
});
