import { act, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useCaptions, useLobby, useQuestions, useStage } from '../src/use-meetings-live.js';
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

describe('useLobby', () => {
  it('reads the conversation lobby before a call is live and admits', async () => {
    const lobby = (waiting: unknown[]) =>
      jsonResponse({ lobby: { call_id: null, conversation_id: 'c-1', enabled: true, waiting } });
    const fetchFn = scriptedFetch([
      lobby([{ id: 'g1', name: 'Ana', guest: true, user_id: null, requested_at: null }]),
      lobby([]),
    ]);
    const { result } = renderHookWithProvider(() => useLobby('c-1', null), fetchFn);
    await waitFor(() => expect(result.current.waitingCount).toBe(1));
    await act(async () => {
      await result.current.admit('g1');
    });
    expect(fetchFn.calls[1]?.url).toBe('https://chat.test/v1/conversations/c-1/lobby/g1/admit');
    expect(result.current.waitingCount).toBe(0);
  });
});

describe('useCaptions', () => {
  it('turns your captions on', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse({ meeting: { stage: false, captions_user_ids: [] } }),
      jsonResponse({ captions: { call_id: 'call-1', user_ids: ['me'], transcript_id: 't' } }),
    ]);
    const { result } = renderHookWithProvider(() => useCaptions('c-1', 'call-1', 'me'), fetchFn);
    await waitFor(() => expect(fetchFn.calls).toHaveLength(1));
    await act(async () => {
      await result.current.toggle();
    });
    expect(fetchFn.calls[1]?.method).toBe('PUT');
    expect(result.current.on).toBe(true);
  });
});
