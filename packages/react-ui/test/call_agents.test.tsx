// Agents in calls: the badge on tiles and rows, invite menu, whisper, escalations.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';

import type { UseCallAgents, UseStage, UseWhisper } from '@poolse/react';
import type { AgentEscalation, AgentProfile, CallAgent, CallParticipant } from '@poolse/sdk';
import { EscalationCard, InviteAgentMenu, WhisperPanel } from '../src/CallAgents.js';
import { CallVideoGrid } from '../src/CallVideoGrid.js';
import { StagePanel } from '../src/MeetingsLive.js';
import { jsonResponse, renderWithProvider, scriptedFetch } from './_helpers.js';

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

const agent = (over: Partial<CallAgent> = {}): CallAgent => ({
  sessionId: 's1',
  callId: 'call-1',
  agentId: 'a1',
  userId: 'u-agent',
  name: LONG,
  label: LONG,
  avatarUrl: null,
  mode: 'notetaker',
  status: 'live',
  speaking: false,
  onBehalfOfUserId: null,
  onBehalfOfName: null,
  invitedByUserId: 'me',
  auto: false,
  joinedAt: null,
  ...over,
});

const participant = (userId: string, name: string, metadata: Record<string, unknown> = {}) =>
  ({
    userId,
    name,
    isSelf: false,
    micEnabled: false,
    metadata,
    speaking: false,
  }) as CallParticipant;

function agentsHook(over: Partial<UseCallAgents> = {}): UseCallAgents {
  return {
    agents: [agent()],
    available: [
      {
        id: 'a2',
        userId: 'u2',
        externalId: null,
        name: `${LONG} Assistant`,
        description: null,
        avatarUrl: null,
        template: null,
        status: 'active',
        stopped: false,
        assistant: true,
        mayPostUnasked: false,
        voiceEnabled: true,
      } satisfies AgentProfile,
    ],
    loading: false,
    error: null,
    pending: null,
    invite: vi.fn(async () => undefined),
    setMode: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    said: null,
    agentFor: () => null,
    refresh: vi.fn(),
    ...over,
  };
}

describe('agents in calls', () => {
  it('labels an agent tile with the badge and its state, never as a person', () => {
    render(
      <CallVideoGrid
        participants={[
          participant('u1', 'Ana'),
          participant('u-agent', 'ignored', {
            agent: true,
            agent_id: 'a1',
            mode: 'delegate',
            label: `${LONG}’s agent`,
          }),
          participant('u3', 'Ben'),
        ]}
      />,
    );
    expect(screen.getByText(`${LONG}’s agent`)).toBeTruthy();
    expect(screen.getByText('Agent')).toBeTruthy();
    expect(screen.getByText('Listening')).toBeTruthy();
    // Only the people show mute icons.
    expect(screen.getAllByLabelText('muted')).toHaveLength(2);
    expect(document.body.textContent).not.toContain('u-agent');
  });

  it('lists the agent in the stage panel without moderator actions', () => {
    const stage: UseStage = {
      stage: { callId: 'call-1', mode: 'stage', roles: {}, hands: [], myRole: 'moderator' },
      myRole: 'moderator',
      isModerator: true,
      handRaised: false,
      roleOf: () => 'speaker',
      raiseHand: vi.fn(async () => true),
      lowerHand: vi.fn(async () => true),
      setRole: vi.fn(async () => true),
      setMode: vi.fn(async () => true),
      error: null,
      pending: false,
    };
    render(
      <StagePanel
        stage={stage}
        participants={[participant('u-agent', 'x')]}
        agents={[agent({ speaking: true })]}
      />,
    );
    expect(screen.getByText(LONG)).toBeTruthy();
    expect(screen.getByText('Taking notes')).toBeTruthy();
  });

  it('invites, switches and removes agents', async () => {
    const hook = agentsHook();
    const { container } = render(<InviteAgentMenu callAgents={hook} />);
    fireEvent.click(screen.getByRole('button', { name: `Invite ${LONG} Assistant to take notes` }));
    expect(hook.invite).toHaveBeenCalledWith('a2', 'notetaker');
    fireEvent.click(screen.getByRole('button', { name: `Let ${LONG} answer when named` }));
    expect(hook.setMode).toHaveBeenCalledWith('a1', 'assistant');
    fireEvent.click(screen.getByRole('button', { name: `Remove ${LONG} from the call` }));
    expect(hook.remove).toHaveBeenCalledWith('a1');
    expect(await violations(container)).toEqual([]);
  });

  it('says the whisper is private', async () => {
    const whisper: UseWhisper = {
      on: true,
      whisper: null,
      agentName: LONG,
      hints: [
        {
          id: 'h1',
          callId: 'call-1',
          kind: 'promise',
          text: 'You promised the contract by Tuesday.',
          sources: [
            { type: 'summary', id: 's', title: 'Weekly sync', callId: null, conversationId: null },
          ],
          at: null,
        },
      ],
      latest: null,
      loading: false,
      pending: false,
      error: null,
      setOn: vi.fn(async () => undefined),
      toggle: vi.fn(async () => undefined),
    };
    const { container } = render(<WhisperPanel whisper={whisper} />);
    expect(screen.getByText(/Only you see this/)).toBeTruthy();
    expect(screen.getByText('You promised')).toBeTruthy();
    expect(screen.getByText('Weekly sync')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    expect(whisper.toggle).toHaveBeenCalled();
    expect(await violations(container)).toEqual([]);
  });

  it('answers an escalation', async () => {
    const e: AgentEscalation = {
      id: 'e1',
      sessionId: null,
      callId: 'call-1',
      conversationId: 'conv-1',
      agentId: 'a1',
      userId: 'me',
      question: 'They ask for 10% off — accept?',
      options: ['approve', 'decline', 'answer'],
      status: 'pending',
      answer: null,
      decidedAt: null,
      expiresAt: null,
      createdAt: null,
    };
    const fetchFn = scriptedFetch([
      jsonResponse({ escalation: { ...e, status: 'answered', answer: 'Only 5%' } }),
    ]);
    renderWithProvider(<EscalationCard escalation={e} agentName={`${LONG}’s agent`} />, fetchFn);
    expect(screen.getByText(`${LONG}’s agent`)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Answer' }));
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'Only 5%' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }));
    await waitFor(() => expect(fetchFn.calls.length).toBe(1));
    expect(fetchFn.calls[0]?.url).toContain('/v1/agent-escalations/e1/reply');
  });
});
