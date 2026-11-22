import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import {
  agendaFromWire,
  agendaOverrunMs,
  inCallElsewhere,
  meetingCardOf,
  meetingJoinable,
  planBreakouts,
  rsvpOf,
  sortQuestions,
  stageFromWire,
  stageRoleOf,
  waitInLobby,
  type Question,
} from '../src/meetings-live.js';
import { CallReactions, ScreenAnnotations, isReactionEmoji } from '../src/voice/call-data.js';
import { diagnoseCallNetwork } from '../src/voice/call-quality.js';
import { disconnectReasonOf, type CallRoom } from '../src/voice/call-room.js';
import {
  WhiteboardModel,
  whiteboardItemOf,
  type YjsModule,
  type YDocLike,
} from '../src/whiteboard.js';
import { bodyJson, buildPoolse, jsonResponse, scriptedFetch } from './_helpers.js';

afterEach(() => vi.useRealTimers());

describe('live meetings mapping', () => {
  it('reads the stage, sorting hands oldest first and defaulting roles by mode', () => {
    const stage = stageFromWire({
      stage: {
        call_id: 'call-1',
        mode: 'stage',
        roles: { a: 'moderator', b: 'speaker', c: 'nonsense' },
        hands: [
          { user_id: 'd', raised_at: '2026-11-21T10:02:00Z' },
          { user_id: 'e', raised_at: '2026-11-21T10:01:00Z' },
        ],
      },
    })!;
    expect(stage.hands.map((h) => h.userId)).toEqual(['e', 'd']);
    expect(stage.myRole).toBe('audience');
    expect(stageRoleOf(stage, 'c')).toBe('audience');
    expect(stageRoleOf(stage, 'a')).toBe('moderator');
    expect(stageFromWire({ nope: true })).toBeNull();
  });

  it('orders open questions by votes, then answered ones newest first', () => {
    const q = (id: string, votes: number, status: Question['status'], at = ''): Question => ({
      id,
      callId: 'c',
      author: null,
      text: id,
      votes,
      votedByMe: false,
      status,
      createdAt: at,
      answeredAt: at,
    });
    const sorted = sortQuestions([
      q('low', 1, 'open', '1'),
      q('done-old', 9, 'answered', '1'),
      q('high', 5, 'open', '2'),
      q('gone', 9, 'dismissed'),
      q('done-new', 0, 'answered', '2'),
    ]);
    expect(sorted.map((x) => x.id)).toEqual(['high', 'low', 'done-new', 'done-old']);
  });

  it('plans breakouts round robin and caps the room count', () => {
    expect(planBreakouts(['a', 'b', 'c', 'd', 'e'], 2)).toEqual([
      { name: 'Room 1', userIds: ['a', 'c', 'e'] },
      { name: 'Room 2', userIds: ['b', 'd'] },
    ]);
    expect(planBreakouts([], 500)).toHaveLength(50);
  });

  it('works out agenda overruns', () => {
    const agenda = agendaFromWire({
      agenda: {
        call_id: 'c',
        items: [
          {
            id: 'i1',
            title: 'Budget',
            minutes: 5,
            status: 'active',
            started_at: '2026-11-21T10:00:00Z',
          },
          { id: 'i2', title: 'AOB', status: 'pending' },
        ],
      },
    })!;
    expect(agenda.currentItemId).toBe('i1');
    const now = Date.parse('2026-11-21T10:08:00Z');
    expect(agendaOverrunMs(agenda.items[0]!, now)).toBe(3 * 60_000);
    expect(agendaOverrunMs(agenda.items[1]!, now)).toBe(0);
  });

  it('reads meeting cards from metadata or a JSON body, and knows when Join is live', () => {
    const card = meetingCardOf({
      metadata: {
        meeting: {
          id: 'm1',
          title: 'Weekly sync',
          starts_at: '2026-11-21T10:00:00Z',
          rsvps: { accepted: ['u1'], declined: [] },
        },
      },
    })!;
    expect(card.title).toBe('Weekly sync');
    expect(rsvpOf(card, 'u1')).toBe('accepted');
    expect(rsvpOf(card, 'u2')).toBeNull();
    expect(meetingJoinable(card, Date.parse('2026-11-21T09:55:00Z'))).toBe(true);
    expect(meetingJoinable(card, Date.parse('2026-11-21T09:00:00Z'))).toBe(false);
    expect(meetingJoinable(card, Date.parse('2026-11-21T11:30:00Z'))).toBe(false);

    const fromBody = meetingCardOf({
      body: JSON.stringify({ type: 'meeting_card', meeting: { id: 'm2', status: 'live' } }),
    })!;
    expect(fromBody.status).toBe('live');
    expect(meetingCardOf({ body: 'hello' })).toBeNull();
  });

  it('offers "move here" only when you are in the call elsewhere', () => {
    const live = {
      state: 'live' as const,
      participants: [{ user_id: 'me', external_id: null, display_name: null }],
    };
    expect(inCallElsewhere(live, 'me', false)).toBe(true);
    expect(inCallElsewhere(live, 'me', true)).toBe(false);
    expect(inCallElsewhere(live, 'you', false)).toBe(false);
  });
});

describe('poolse.live REST', () => {
  it('raises a hand and asks a question on the assumed paths', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse({ stage: { call_id: 'call-1', mode: 'meeting', hands: ['me'] } }),
      jsonResponse({ question: { id: 'q1', call_id: 'call-1', text: 'Why?', votes: 0 } }),
    ]);
    const chat = buildPoolse(fetchFn);

    const stage = await chat.live.stage.raiseHand('call-1');
    expect(stage.hands[0]?.userId).toBe('me');
    expect(fetchFn.calls[0]?.url).toBe('https://chat.test/v1/calls/call-1/hand');
    expect(await bodyJson(fetchFn.calls[0]!)).toEqual({ raised: true });

    const q = await chat.live.questions.ask('call-1', '  Why?  ', { anonymous: true });
    expect(q.id).toBe('q1');
    expect(await bodyJson(fetchFn.calls[1]!)).toEqual({ text: 'Why?', anonymous: true });
  });

  it('a missing agenda is null, not an error', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse({ error: { code: 'not_found', message: 'none' } }, { status: 404 }),
    ]);
    const chat = buildPoolse(fetchFn);
    await expect(chat.live.agenda.get('call-1')).resolves.toBeNull();
  });

  it('a guest waits in the lobby until admitted', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse({ lobby: { status: 'waiting' } }),
      jsonResponse({
        lobby: { status: 'admitted', session: { livekit: { url: 'wss://x', token: 't' } } },
      }),
    ]);
    const seen: string[] = [];
    const result = await waitInLobby({
      apiUrl: 'https://chat.test/',
      entryId: 'e1',
      lobbyToken: 'lobby-tok',
      intervalMs: 1,
      fetch: fetchFn,
      onStatus: (s) => seen.push(s.status),
    });
    expect(result.status).toBe('admitted');
    expect(seen).toEqual(['waiting', 'admitted']);
    expect(fetchFn.calls[0]?.url).toBe('https://chat.test/v1/guest/lobby/e1');
    expect(fetchFn.calls[0]?.headers.get('authorization')).toBe('Bearer lobby-tok');
  });
});

/** A CallRoom stand-in with a loopback data channel between two "peers". */
function fakeRooms() {
  type Fn = (m: unknown, from: { userId: string | null; name: string | null }) => void;
  const peers: Array<{ id: string; listeners: Map<string, Set<Fn>> }> = [];
  const make = (id: string) => {
    const me = { id, listeners: new Map<string, Set<Fn>>() };
    peers.push(me);
    const room = {
      getSelfId: () => id,
      onData: (topic: string, fn: Fn) => {
        const set = me.listeners.get(topic) ?? new Set<Fn>();
        me.listeners.set(topic, set);
        set.add(fn);
        return () => set.delete(fn);
      },
      sendData: async (topic: string, message: unknown) => {
        for (const p of peers) {
          if (p === me) continue;
          p.listeners
            .get(topic)
            ?.forEach((fn) => fn(JSON.parse(JSON.stringify(message)), { userId: id, name: id }));
        }
        return true;
      },
    };
    return room as unknown as CallRoom;
  };
  return make;
}

describe('data channel features', () => {
  it('reactions reach the others and echo locally; text is refused', async () => {
    const make = fakeRooms();
    const a = new CallReactions(make('a'));
    const b = new CallReactions(make('b'));
    const gotA: string[] = [];
    const gotB: string[] = [];
    a.subscribe((r) => gotA.push(`${r.emoji}:${r.isSelf}`));
    b.subscribe((r) => gotB.push(`${r.emoji}:${r.userId}`));
    await a.send('👏');
    expect(await a.send('hello')).toBe(false);
    expect(gotA).toEqual(['👏:true']);
    expect(gotB).toEqual(['👏:a']);
    expect(isReactionEmoji('❤️')).toBe(true);
    expect(isReactionEmoji('<b>')).toBe(false);
  });

  it('annotations draw on the same share and clear for everyone', () => {
    vi.useFakeTimers();
    const make = fakeRooms();
    const a = new ScreenAnnotations(make('a'), 'sharer');
    const b = new ScreenAnnotations(make('b'), 'sharer');
    const other = new ScreenAnnotations(make('c'), 'someone-else');
    const id = a.begin({ color: '#ff0000' });
    a.extend(id, 0.1, 0.2);
    a.extend(id, 2, -1); // clamped into the picture
    a.end(id);
    const stroke = b.getState().strokes[0]!;
    expect(stroke.points).toEqual([0.1, 0.2, 1, 0]);
    expect(stroke.done).toBe(true);
    expect(stroke.color).toBe('#ff0000');
    expect(other.getState().strokes).toHaveLength(0);
    b.clear();
    expect(a.getState().strokes).toHaveLength(0);
    [a, b, other].forEach((x) => x.destroy());
  });
});

describe('call quality', () => {
  it('words the worst problem first', () => {
    expect(diagnoseCallNetwork({ reconnecting: true })[0]?.kind).toBe('reconnecting');
    const issues = diagnoseCallNetwork({
      quality: 'poor',
      stats: { packetLoss: 0.2, rttMs: 500, jitterMs: 10, videoKbps: null, limitedBy: null },
    });
    expect(issues.map((i) => i.kind)).toEqual(['packet_loss', 'high_latency']);
    expect(issues[0]?.title).toBe('Your network is dropping packets');
    expect(diagnoseCallNetwork({ quality: 'good' })).toEqual([]);
  });

  it('maps LiveKit disconnect reasons', () => {
    expect(disconnectReasonOf(2)).toBe('moved');
    expect(disconnectReasonOf(1)).toBe('left');
    expect(disconnectReasonOf(undefined)).toBe('unknown');
  });
});

describe('whiteboard', () => {
  const Ymod = Y as unknown as YjsModule;
  const newDoc = () => new Y.Doc() as unknown as YDocLike;

  it('syncs two boards, erases what is hit and undoes only your own', () => {
    const d1 = newDoc();
    const d2 = newDoc();
    d1.on('update', (u, origin) => origin !== 'remote' && Y.applyUpdate(d2 as never, u, 'remote'));
    d2.on('update', (u, origin) => origin !== 'remote' && Y.applyUpdate(d1 as never, u, 'remote'));
    const a = new WhiteboardModel(Ymod, d1, 'ana');
    const b = new WhiteboardModel(Ymod, d2, 'ben');

    a.add({ kind: 'stroke', points: [0, 0, 100, 0], color: '#000000', width: 4 });
    b.add({ kind: 'rect', x: 200, y: 200, w: 50, h: 50, color: '#1f6feb', width: 2 });
    b.add({ kind: 'text', x: 400, y: 400, text: 'Hi', color: '#000', size: 20 });
    expect(a.getItems().map((i) => i.kind)).toEqual(['stroke', 'rect', 'text']);
    expect(b.getItems()[0]?.by).toBe('ana');

    expect(b.eraseAt(50, 2)).toHaveLength(1);
    expect(a.getItems().map((i) => i.kind)).toEqual(['rect', 'text']);

    a.undo(); // ana did nothing undoable after her stroke was erased by ben
    b.undo(); // ben's erase comes back
    expect(a.getItems().map((i) => i.kind)).toContain('stroke');
    a.destroy();
    b.destroy();
  });

  it('never trusts stored values', () => {
    expect(whiteboardItemOf('x', { kind: 'stroke', points: [1] })).toBeNull();
    expect(whiteboardItemOf('x', { kind: 'script' })).toBeNull();
    expect(
      whiteboardItemOf('x', { kind: 'text', x: 1, y: 1, text: 'a'.repeat(900) }),
    ).toMatchObject({
      text: 'a'.repeat(500),
    });
  });
});
