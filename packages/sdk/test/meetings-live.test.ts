import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import {
  breakoutsFromWire,
  captionsFromWire,
  participantQualityFromWire,
  GuestClient,
  identityKindOf,
  meetingNameOf,
  phoneLabel,
  roomPresenceFromWire,
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
import {
  CallReactions,
  ScreenAnnotations,
  isReactionEmoji,
  type CallDataChannel,
} from '../src/voice/call-data.js';
import { diagnoseCallNetwork, qualityReportBody } from '../src/voice/call-quality.js';
import { disconnectReasonOf } from '../src/voice/call-room.js';
import {
  WhiteboardModel,
  bindYDoc,
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
      type: 'system',
      body: JSON.stringify({
        type: 'meeting_card',
        meeting: {
          id: 'm1',
          title: 'Weekly sync',
          starts_at: '2026-11-21T10:00:00Z',
          rsvps: { accepted: ['u1'], declined: [] },
          my_rsvp: null,
        },
      }),
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
    expect(card.counts.accepted).toBe(1);
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

  it('a long lobby wait does not pile abort listeners on the signal', async () => {
    // A fetch that ignores the signal, so only waitInLobby's own listeners count.
    const answers = [
      jsonResponse({ lobby: { status: 'waiting' } }),
      jsonResponse({ lobby: { status: 'waiting' } }),
      jsonResponse({ lobby: { status: 'denied' } }),
    ];
    const fetchFn = (async () => answers.shift()!) as unknown as typeof fetch;
    const controller = new AbortController();
    let live = 0;
    const add = controller.signal.addEventListener.bind(controller.signal);
    const remove = controller.signal.removeEventListener.bind(controller.signal);
    controller.signal.addEventListener = ((type: string, fn: never, o?: never) => {
      if (type === 'abort') live++;
      add(type, fn, o);
    }) as never;
    controller.signal.removeEventListener = ((type: string, fn: never, o?: never) => {
      if (type === 'abort') live--;
      remove(type, fn, o);
    }) as never;
    await waitInLobby({
      apiUrl: 'https://chat.test',
      entryId: 'e1',
      lobbyToken: 'tok',
      intervalMs: 1,
      fetch: fetchFn,
      signal: controller.signal,
    });
    expect(live).toBe(0);
  });
});

/**
 * A loopback data channel between "peers" — any CallDataChannel, as
 * @poolse/native's `callData` is on phones, not only a CallRoom.
 */
function fakeRooms() {
  type Fn = (m: unknown, from: { userId: string | null; name: string | null }) => void;
  const peers: Array<{ id: string; listeners: Map<string, Set<Fn>> }> = [];
  const make = (id: string) => {
    const me = { id, listeners: new Map<string, Set<Fn>>() };
    peers.push(me);
    const room: CallDataChannel = {
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
    return room;
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
    expect(disconnectReasonOf(14)).toBe('lost'); // CONNECTION_TIMEOUT
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

  it('sends edits made before the join, and again after a failed send', async () => {
    vi.useFakeTimers();
    try {
      const joined: Array<(i: { rights: string }) => void> = [];
      let fail = true;
      const sent: Uint8Array[] = [];
      const channel = {
        onJoined: (fn: (i: { rights: string }) => void) => (joined.push(fn), () => {}),
        onUpdate: () => () => {},
        onSyncReply: () => () => {},
        onSyncRequest: () => () => {},
        requestSync: () => Promise.resolve(),
        sendSyncReply: () => Promise.resolve(),
        sendUpdate: (u: Uint8Array) => {
          if (fail) return Promise.reject(new Error('timeout'));
          sent.push(u);
          return Promise.resolve();
        },
      };
      const doc = newDoc();
      const unbind = bindYDoc(Ymod, doc, channel as never);
      const model = new WhiteboardModel(Ymod, doc, 'ana');
      model.add({ kind: 'stroke', points: [0, 0, 10, 10], color: '#000000', width: 2 });

      joined.forEach((fn) => fn({ rights: 'write' })); // the first send fails
      await vi.advanceTimersByTimeAsync(0);
      expect(sent).toHaveLength(0);
      fail = false;
      await vi.advanceTimersByTimeAsync(2_000); // resent on its own
      expect(sent).toHaveLength(1);
      const peer = newDoc();
      Y.applyUpdate(peer as never, sent[0]!);
      expect(new WhiteboardModel(Ymod, peer, 'ben').getItems()).toHaveLength(1);

      // A refresh that takes write rights away stops sending.
      unbind.setCanWrite(false);
      model.add({ kind: 'stroke', points: [1, 1, 2, 2], color: '#000000', width: 2 });
      expect(sent).toHaveLength(1);
      unbind.setCanWrite(true);
      expect(sent).toHaveLength(2);
      unbind();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps strokes to whole points', () => {
    const item = whiteboardItemOf('x', { kind: 'stroke', points: [1, 2, 3, 4, 5] });
    expect(item && 'points' in item ? item.points : null).toEqual([1, 2, 3, 4]);
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

describe('MEETINGS.md specifics', () => {
  it('names guests and phones without showing ids', () => {
    expect(phoneLabel('sip_+37060012345')).toBe('Phone ···2345');
    expect(phoneLabel('sip_out_3f2a')).toBe('Phone');
    expect(meetingNameOf('guest_abc', 'Ana')).toBe('Ana');
    expect(meetingNameOf('guest_abc')).toBe('Guest');
    expect(meetingNameOf('sip_+37060012345', '+37060012345')).toBe('Phone ···2345');
    expect(meetingNameOf('u-1')).toBeNull();
    expect(identityKindOf('sip_out_1')).toBe('phone');
  });

  it('works out your role from a stage event without my_role', () => {
    const s = stageFromWire(
      { call_id: 'c', stage: { call_id: 'c', mode: 'stage', roles: { me: 'speaker' }, hands: [] } },
      'me',
    )!;
    expect(s.myRole).toBe('speaker');
    expect(stageFromWire({ stage: { call_id: 'c', mode: 'stage' } }, 'me')!.myRole).toBe(
      'audience',
    );
  });

  it('reads breakout rooms as parts of the main call', () => {
    const b = breakoutsFromWire({
      breakouts: {
        id: 'sp1',
        call_id: 'call-1',
        status: 'open',
        rooms: [{ id: 'sp1.1', n: 1, name: 'Room 1', call_id: null, user_ids: ['guest_9'] }],
        my_room_id: 'sp1.1',
      },
    })!;
    expect(b.rooms[0]).toMatchObject({ id: 'sp1.1', n: 1, callId: null });
    expect(breakoutsFromWire({ breakouts: null })).toBeNull();
  });

  it('the lobby lives on the conversation and has no call before one starts', async () => {
    const lobby = { lobby: { call_id: null, conversation_id: 'c-1', enabled: true, waiting: [] } };
    const fetchFn = scriptedFetch([jsonResponse(lobby), jsonResponse(lobby)]);
    const chat = buildPoolse(fetchFn);
    const l = await chat.live.lobby.get({ conversationId: 'c-1' });
    expect(l.callId).toBeNull();
    await chat.live.lobby.admit({ conversationId: 'c-1' }, 'g-1');
    expect(fetchFn.calls[0]?.url).toBe('https://chat.test/v1/conversations/c-1/lobby');
    expect(fetchFn.calls[1]?.url).toBe('https://chat.test/v1/conversations/c-1/lobby/g-1/admit');
  });

  it('RSVPs, captions and quality go to their endpoints', async () => {
    const meeting = { meeting: { id: 'm1', title: 'Sync', my_rsvp: 'accepted' } };
    const fetchFn = scriptedFetch([
      jsonResponse(meeting),
      jsonResponse({ captions: { call_id: 'call-1', user_ids: ['me'], transcript_id: 't1' } }),
      jsonResponse({
        quality: {
          identity: 'me',
          quality: 'poor',
          reason: 'packet_loss',
          explanation: 'Your network…',
        },
      }),
    ]);
    const chat = buildPoolse(fetchFn);
    expect((await chat.live.meetings.rsvp('m1', 'accepted')).myRsvp).toBe('accepted');
    expect(fetchFn.calls[0]?.method).toBe('PUT');
    expect(fetchFn.calls[0]?.url).toBe('https://chat.test/v1/meetings/m1/rsvp');
    expect((await chat.live.captions.set('call-1', true)).userIds).toEqual(['me']);
    expect(await bodyJson(fetchFn.calls[1]!)).toEqual({ on: true });
    const q = await chat.live.quality.report('call-1', { quality: 'poor', packet_loss: 8 });
    expect(q.reason).toBe('packet_loss');
  });

  it('a guest joins with a name, waits, and gets the session', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse({
        data: { conversation_name: 'Acme', lobby: true, publish: 'audio', live: false },
      }),
      jsonResponse(
        {
          guest: { id: 'g1', name: 'Ana' },
          token: 'gt',
          lobby_token: 'gt',
          entry_id: 'g1',
          lobby: true,
        },
        { status: 201 },
      ),
      jsonResponse({
        lobby: { status: 'admitted', session: { call: { id: 'call-1', media: 'video' } } },
      }),
    ]);
    const guest = new GuestClient({ apiUrl: 'https://chat.test', fetch: fetchFn });
    expect((await guest.link('lt')).publish).toBe('audio');
    const joined = await guest.join('lt', '  Ana  ');
    expect(joined.entryId).toBe('g1');
    expect(await bodyJson(fetchFn.calls[1]!)).toEqual({ link: 'lt', name: 'Ana' });
    const st = await guest.waitInLobby({ intervalMs: 1 });
    expect(st.status).toBe('admitted');
    expect(st.status === 'admitted' && st.session?.call?.id).toBe('call-1');
    expect(fetchFn.calls[2]?.headers.get('authorization')).toBe('Bearer gt');
  });

  it('reads who is in a room from room:participants', () => {
    const r = roomPresenceFromWire({
      conversation_id: 'c-1',
      call_id: 'call-1',
      media: 'video',
      participants: [{ user_id: 'u1', display_name: 'Ana' }],
      attendees: [{ identity: 'sip_+37060012345', kind: 'phone', name: null }],
      live: true,
    })!;
    expect(r.attendees[0]?.name).toBe('Phone ···2345');
    expect(
      roomPresenceFromWire({ conversation_id: 'c-1', call_id: 'call-1', live: false })!
        .participants,
    ).toEqual([]);
  });

  it('a quality report counts excellent as good and loss in percent', () => {
    expect(
      qualityReportBody({
        quality: 'excellent',
        reconnecting: false,
        stats: {
          packetLoss: 0.083,
          rttMs: 120.4,
          jitterMs: null,
          videoKbps: null,
          limitedBy: null,
        },
        issues: [],
      }),
    ).toEqual({ quality: 'good', packet_loss: 8.3, rtt_ms: 120 });
  });
});

describe('flat server events', () => {
  it('reads call:quality as the server sends it', () => {
    const q = participantQualityFromWire({
      call_id: 'c1',
      identity: 'u1',
      quality: 'poor',
      reason: 'packet_loss',
      explanation: 'Your network is dropping packets.',
      stats: { packet_loss: 12 },
      at: '2026-11-22T10:00:00Z',
    });
    expect(q).toEqual({
      identity: 'u1',
      quality: 'poor',
      reason: 'packet_loss',
      explanation: 'Your network is dropping packets.',
      at: '2026-11-22T10:00:00Z',
    });
    expect(
      participantQualityFromWire({ quality: { identity: 'u2', quality: 'good' } })?.identity,
    ).toBe('u2');
  });

  it('reads captions:changed as the server sends it', () => {
    expect(captionsFromWire({ call_id: 'c1', user_ids: ['u1'], transcript_id: null })).toEqual({
      callId: 'c1',
      userIds: ['u1'],
      transcriptId: null,
    });
  });
});
