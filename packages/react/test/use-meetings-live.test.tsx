import { act, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useQuestions, useStage } from '../src/use-meetings-live.js';
import { jsonResponse, renderHookWithProvider, scriptedFetch } from './_helpers.js';

const q = (id: string, votes: number, extra: Record<string, unknown> = {}) => ({
  id,
  call_id: 'call-1',
  text: `Question ${id}`,
  votes,
  status: 'open',
  created_at: '2026-11-21T10:00:00Z',
  ...extra,
});

describe('useQuestions', () => {
  it('lists by votes and toggles your vote', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse({ questions: [q('a', 1), q('b', 3)] }),
      jsonResponse({ question: q('a', 2) }),
      jsonResponse({ question: q('a', 1) }),
    ]);
    const { result } = renderHookWithProvider(() => useQuestions('c-1', 'call-1'), fetchFn);
    await waitFor(() => expect(result.current.questions).toHaveLength(2));
    expect(result.current.questions.map((x) => x.id)).toEqual(['b', 'a']);

    await act(() => result.current.toggleVote('a'));
    expect(fetchFn.calls[1]?.url).toBe('https://chat.test/v1/questions/a/vote');
    expect(fetchFn.calls[1]?.method).toBe('POST');
    expect(result.current.questions.find((x) => x.id === 'a')?.votedByMe).toBe(true);

    await act(() => result.current.toggleVote('a'));
    expect(fetchFn.calls[2]?.method).toBe('DELETE');
    expect(result.current.questions.find((x) => x.id === 'a')?.votedByMe).toBe(false);
  });
});

describe('useStage', () => {
  it('knows when your hand is up', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse({ stage: { call_id: 'call-1', mode: 'stage', my_role: 'audience', hands: [] } }),
      jsonResponse({
        stage: { call_id: 'call-1', mode: 'stage', my_role: 'audience', hands: ['me'] },
      }),
    ]);
    const { result } = renderHookWithProvider(() => useStage('c-1', 'call-1', 'me'), fetchFn);
    await waitFor(() => expect(result.current.stage).not.toBeNull());
    expect(result.current.handRaised).toBe(false);
    await act(async () => {
      await result.current.raiseHand();
    });
    expect(result.current.handRaised).toBe(true);
    expect(result.current.myRole).toBe('audience');
  });
});
