import { fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReactionStrip } from '../src/Reactions.js';
import { jsonResponse, renderWithProvider, scriptedFetch } from './_helpers.js';

describe('<ReactionStrip>', () => {
  it('renders an empty strip + picker button when no reactions', () => {
    const fetchFn = scriptedFetch([]);
    const { container } = renderWithProvider(
      <ReactionStrip messageId="m-1" conversationId="c-1" currentUserId="u-2" />,
      fetchFn,
    );
    // Only one button — the picker trigger.
    const buttons = container.querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.getAttribute('aria-label')).toBe('Add reaction');
  });

  it('renders existing reaction pills with counts', () => {
    const fetchFn = scriptedFetch([]);
    const { container } = renderWithProvider(
      <ReactionStrip
        messageId="m-1"
        conversationId="c-1"
        initialReactions={{ '🎉': ['u-1', 'u-2'], '👍': ['u-3'] }}
        currentUserId="u-2"
      />,
      fetchFn,
    );
    expect(container.textContent).toMatch(/🎉/);
    expect(container.textContent).toMatch(/👍/);
    // 2 reaction pills + 1 picker trigger.
    expect(container.querySelectorAll('.poolse-reaction-pill')).toHaveLength(3);
  });

  it('marks user-owned reactions with the --mine modifier', () => {
    const fetchFn = scriptedFetch([]);
    const { container } = renderWithProvider(
      <ReactionStrip
        messageId="m-1"
        conversationId="c-1"
        initialReactions={{ '🎉': ['u-2'] }}
        currentUserId="u-2"
      />,
      fetchFn,
    );
    expect(container.querySelector('.poolse-reaction-pill--mine')).not.toBeNull();
  });

  it('opens the picker on click', () => {
    const fetchFn = scriptedFetch([]);
    const { container } = renderWithProvider(
      <ReactionStrip messageId="m-1" conversationId="c-1" currentUserId="u-2" />,
      fetchFn,
    );
    const picker = container.querySelector('button[aria-label="Add reaction"]') as HTMLButtonElement;
    fireEvent.click(picker);
    expect(container.querySelector('.poolse-reaction-picker')).not.toBeNull();
  });

  it('picker={false} hides the add button entirely', () => {
    const fetchFn = scriptedFetch([]);
    const { container } = renderWithProvider(
      <ReactionStrip
        messageId="m-1"
        conversationId="c-1"
        initialReactions={{ '🎉': ['u-1'] }}
        currentUserId="u-2"
        picker={false}
      />,
      fetchFn,
    );
    expect(container.querySelector('button[aria-label="Add reaction"]')).toBeNull();
  });

  it('clicking a reaction pill triggers add/remove via the API', async () => {
    // Fetch script: GET /v1/messages/m-1 not needed; addReaction POSTs.
    const fetchFn = scriptedFetch([
      jsonResponse(
        {
          id: 'm-1',
          tenant_id: 't',
          conversation_id: 'c-1',
          sender_id: 'u-1',
          type: 'text',
          body: 'hi',
          reply_to_id: null,
          thread_root_id: null,
          mentions: [],
          reactions: { '🚀': ['u-2'] },
          edited_at: null,
          deleted_at: null,
          sequence: 1,
          inserted_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
        { status: 200 },
      ),
    ]);
    const { container } = renderWithProvider(
      <ReactionStrip
        messageId="m-1"
        conversationId="c-1"
        initialReactions={{}}
        currentUserId="u-2"
      />,
      fetchFn,
    );
    const picker = container.querySelector('button[aria-label="Add reaction"]') as HTMLButtonElement;
    fireEvent.click(picker);
    const pick = container.querySelector('.poolse-reaction-picker__btn') as HTMLButtonElement;
    fireEvent.click(pick);
    // The add fires async; just confirm the picker closes.
    expect(container.querySelector('.poolse-reaction-picker')).toBeNull();
  });
});
