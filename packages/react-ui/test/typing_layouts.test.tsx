import { act, waitFor } from '@testing-library/react';
import { usePoolse } from '@poolse/react';
import { describe, expect, it } from 'vitest';
import { ConversationView, type ChatLayout } from '../src/index.js';
import { msg, names, viewRoutes } from './_fixtures.js';
import { renderWithProvider, routedFetch } from './_helpers.js';

type TypingHandler = (evt: { external_id: string | null }) => void;

// Captures the conversation channel's typing:start listener, so the
// test can play the event the socket would deliver.
function TypingTap({ onHandler }: { onHandler: (fn: TypingHandler) => void }) {
  const chat = usePoolse();
  const conv = chat.realtime.conversation('c-1') as unknown as {
    onTypingStart: (fn: TypingHandler) => () => void;
    __tapped?: boolean;
  };
  if (!conv.__tapped) {
    const original = conv.onTypingStart.bind(conv);
    conv.onTypingStart = (fn) => {
      onHandler(fn);
      return original(fn);
    };
    conv.__tapped = true;
  }
  return null;
}

describe('typing indicator in every layout', () => {
  for (const layout of ['bubbles', 'list', 'compact'] as ChatLayout[]) {
    it(`${layout}: shows who is typing`, async () => {
      let handler: TypingHandler | null = null;
      const { container } = renderWithProvider(
        <>
          <TypingTap onHandler={(fn) => (handler = fn)} />
          <ConversationView
            conversationId="c-1"
            layout={layout}
            labelFor={names}
            loadFonts={false}
          />
        </>,
        routedFetch(viewRoutes([msg(1)])),
      );
      await waitFor(() => expect(container.textContent).toContain('message 1'));
      await waitFor(() => expect(handler).not.toBeNull());
      act(() => handler!({ external_id: 'two' }));
      const typing = container.querySelector('.poolse-conversation .poolse-typing');
      await waitFor(() => expect(typing?.hasAttribute('data-typing')).toBe(true));
      expect(typing?.textContent).toContain('Two is typing');
    });
  }
});
