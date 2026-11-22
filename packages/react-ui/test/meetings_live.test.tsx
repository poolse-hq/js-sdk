// Live meeting pieces: stage, Q&A, lobby, agenda, quality, cards, board.

import { fireEvent, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';

import type { UseAgenda, UseLobby, UseQuestions, UseStage, UseWhiteboard } from '@poolse/react';
import type { CallParticipant, MeetingCard as Card, Question } from '@poolse/sdk';
import { diagnoseCallNetwork } from '@poolse/sdk';
import { MeetingCard } from '../src/MeetingCard.js';
import {
  AgendaPanel,
  ConnectionIndicator,
  LobbyAdmitList,
  NetworkBanner,
  QuestionsPanel,
  RoomPresence,
  StagePanel,
} from '../src/MeetingsLive.js';
import { Whiteboard } from '../src/Whiteboard.js';

const LONG = 'Maximiliana Alexandrina Featherstonehaugh-Montgomery-Smythe';

async function violations(root: Element) {
  const result = await axe.run(root, {
    rules: {
      'color-contrast': { enabled: false },
      region: { enabled: false },
      'landmark-one-main': { enabled: false },
      'page-has-heading-one': { enabled: false },
    },
  });
  return result.violations.map((v) => v.id);
}

const person = (userId: string, name: string, isSelf = false) =>
  ({ userId, name, isSelf }) as CallParticipant;

function stageHook(over: Partial<UseStage> = {}): UseStage {
  return {
    stage: {
      callId: 'call-1',
      mode: 'stage',
      roles: { mod: 'moderator', ana: 'speaker' },
      hands: [{ userId: 'ben', name: null, raisedAt: null }],
      myRole: 'moderator',
    },
    myRole: 'moderator',
    isModerator: true,
    handRaised: false,
    roleOf: (id) => (id === 'mod' ? 'moderator' : id === 'ana' ? 'speaker' : 'audience'),
    raiseHand: vi.fn(async () => true),
    lowerHand: vi.fn(async () => true),
    setRole: vi.fn(async () => true),
    setMode: vi.fn(async () => true),
    error: null,
    pending: false,
    ...over,
  };
}

describe('StagePanel', () => {
  it('lists the stage, the audience and raised hands by name, and brings people up', async () => {
    const stage = stageHook();
    const { container } = render(
      <StagePanel
        stage={stage}
        participants={[person('mod', 'Mo', true), person('ana', 'Ana'), person('ben', LONG)]}
      />,
    );
    expect(screen.getByText('On stage · 2')).toBeTruthy();
    expect(screen.getByText('Audience · 1')).toBeTruthy();
    expect(container.textContent).not.toContain('ben');
    fireEvent.click(screen.getAllByRole('button', { name: 'Bring up' })[0]!);
    expect(stage.setRole).toHaveBeenCalledWith('ben', 'speaker');
    expect(await violations(container)).toEqual([]);
  });

  it('an audience member raises a hand', () => {
    const stage = stageHook({ myRole: 'audience', isModerator: false });
    render(<StagePanel stage={stage} participants={[person('me', 'Me', true)]} />);
    fireEvent.click(screen.getByRole('button', { name: /Raise hand/ }));
    expect(stage.raiseHand).toHaveBeenCalled();
  });
});

describe('QuestionsPanel', () => {
  it('asks and votes', async () => {
    const q: Question = {
      id: 'q1',
      callId: 'call-1',
      author: null,
      text: 'When do we ship?',
      votes: 3,
      votedByMe: false,
      status: 'open',
      createdAt: null,
      answeredAt: null,
    };
    const hook: UseQuestions = {
      questions: [q],
      openCount: 1,
      ask: vi.fn(async () => true),
      toggleVote: vi.fn(async () => {}),
      setStatus: vi.fn(async () => {}),
      error: null,
      pending: false,
    };
    const { container } = render(<QuestionsPanel questions={hook} canModerate />);
    expect(screen.getByText('Anonymous')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Vote · 3 votes/ }));
    expect(hook.toggleVote).toHaveBeenCalledWith('q1');
    fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'Why?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect(hook.ask).toHaveBeenCalledWith('Why?', { anonymous: false });
    expect(await violations(container)).toEqual([]);
  });
});

describe('lobby, agenda, quality, presence', () => {
  it('admits a waiting guest, marked as a guest', () => {
    const hook: UseLobby = {
      lobby: {
        callId: 'c',
        conversationId: 'c-1',
        enabled: true,
        waiting: [{ id: 'e1', name: LONG, guest: true, userId: null, requestedAt: null }],
      },
      waitingCount: 1,
      admit: vi.fn(async () => true),
      deny: vi.fn(async () => true),
      admitAll: vi.fn(async () => true),
      error: null,
      pending: false,
    };
    render(<LobbyAdmitList lobby={hook} />);
    expect(screen.getByText('Guest')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Admit' }));
    expect(hook.admit).toHaveBeenCalledWith('e1');
  });

  it('nudges when an agenda item runs over', () => {
    const hook = {
      agenda: {
        callId: 'c',
        meetingId: null,
        currentItemId: 'i1',
        items: [
          {
            id: 'i1',
            title: 'Budget review',
            owner: null,
            minutes: 5,
            status: 'active',
            startedAt: null,
            doneAt: null,
          },
        ],
      },
      current: null,
      overrunMs: 0,
      overtime: { itemId: 'i1', overByMs: 150_000 },
      start: vi.fn(),
      done: vi.fn(async () => true),
      reopen: vi.fn(),
      error: null,
      pending: false,
    } as unknown as UseAgenda;
    (hook as { current: unknown }).current = hook.agenda!.items[0];
    render(<AgendaPanel agenda={hook} />);
    expect(screen.getByText('Budget review is 3 min over')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(hook.done).toHaveBeenCalledWith('i1');
  });

  it('says what is wrong with the network, and labels the bars', () => {
    render(
      <>
        <NetworkBanner
          issues={diagnoseCallNetwork({
            stats: {
              packetLoss: 0.1,
              rttMs: null,
              jitterMs: null,
              videoKbps: null,
              limitedBy: null,
            },
          })}
        />
        <ConnectionIndicator quality="poor" />
      </>,
    );
    expect(screen.getByText('Your network is dropping packets')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Weak connection' })).toBeTruthy();
  });

  it('shows who is in a room without ids', () => {
    const call = {
      state: 'live',
      participants: [
        { user_id: 'u1', external_id: null, display_name: 'Ana' },
        { user_id: 'u2', external_id: null, display_name: null },
        { user_id: 'u3', external_id: null, display_name: 'Ben' },
        { user_id: 'u4', external_id: null, display_name: 'Cy' },
      ],
    } as never;
    const { container } = render(<RoomPresence call={call} />);
    expect(screen.getByText('+1')).toBeTruthy();
    expect(container.innerHTML).not.toContain('u2');
    expect(screen.getByRole('img', { name: '4 in the room: Ana, Someone, Ben, Cy' })).toBeTruthy();
  });
});

describe('MeetingCard', () => {
  const card: Card = {
    meetingId: 'm1',
    title: LONG,
    startsAt: new Date(Date.now() + 2 * 60_000).toISOString(),
    endsAt: new Date(Date.now() + 32 * 60_000).toISOString(),
    media: 'video',
    status: 'scheduled',
    roomConversationId: 'c-room',
    callId: null,
    organizer: null,
    rsvps: { accepted: ['u1', 'u2'], declined: [], tentative: [] },
    myRsvp: null,
    inviteeCount: 4,
    conversationId: 'c-1',
    counts: { accepted: 2, declined: 0, tentative: 0 },
  };

  it('answers, and rolls back when saving fails', async () => {
    const onRsvp = vi.fn(async () => false);
    const onJoin = vi.fn();
    const { container } = render(
      <MeetingCard card={card} selfUserId="u1" onRsvp={onRsvp} onJoin={onJoin} />,
    );
    expect(screen.getByText('2 accepted')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Accept' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: 'Decline' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('radio', { name: 'Accept' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect(onJoin).toHaveBeenCalled();
    expect(await violations(container)).toEqual([]);
  });
});

describe('Whiteboard', () => {
  it('renders items view-only without a model', () => {
    const board: UseWhiteboard = {
      items: [
        {
          id: 'a',
          kind: 'text',
          x: 10,
          y: 10,
          text: 'Hello',
          size: 20,
          z: 1,
          color: '#000',
          by: null,
        },
      ],
      model: null,
      readOnly: true,
      error: null,
    };
    render(<Whiteboard board={board} />);
    expect(screen.getByText('Hello')).toBeTruthy();
    expect(screen.queryByRole('toolbar')).toBeNull();
    expect(screen.getByRole('img', { name: 'Whiteboard, 1 item' })).toBeTruthy();
  });
});

describe('guests and phones', () => {
  it('names a phone hand without its number and marks guests', () => {
    const stage = stageHook({
      stage: {
        callId: 'call-1',
        mode: 'meeting',
        roles: {},
        hands: [
          { userId: 'sip_+37060012345', name: 'Phone ···2345', raisedAt: null },
          { userId: 'guest_g1', name: 'Ana', raisedAt: null },
        ],
        myRole: 'speaker',
      },
    });
    const { container } = render(<StagePanel stage={stage} participants={[]} />);
    expect(screen.getByText('Phone ···2345')).toBeTruthy();
    expect(screen.getByText('Guest')).toBeTruthy();
    expect(container.textContent).not.toContain('37060012345');
  });

  it('counts guests and phones in a room', () => {
    render(
      <RoomPresence
        call={{
          conversationId: 'c',
          callId: 'call-1',
          media: 'audio',
          live: true,
          participants: [{ user_id: 'u1', external_id: null, display_name: 'Ana' }],
          attendees: [
            { identity: 'sip_+3706001', kind: 'phone', name: 'Phone ···6001', role: null },
          ],
        }}
      />,
    );
    expect(screen.getByRole('img', { name: '2 in the room: Ana, Phone ···6001' })).toBeTruthy();
  });
});
