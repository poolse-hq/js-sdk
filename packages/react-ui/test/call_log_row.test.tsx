import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Message } from '@poolse/sdk';
import { CallLogRow } from '../src/index.js';
import { MessageRow } from '../src/MessageRow.js';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

function sys(body: string): Message {
  return {
    id: 'm1',
    tenant_id: 't',
    conversation_id: 'c',
    sender_id: null,
    sender_external_id: null,
    type: 'system',
    body,
    reply_to_id: null,
    thread_root_id: null,
    mentions: [],
    reactions: {},
    edited_at: null,
    deleted_at: null,
    sequence: 1,
    inserted_at: '2026-06-01T10:00:00Z',
    updated_at: '2026-06-01T10:00:00Z',
  } as unknown as Message;
}

const call = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    kind: 'call',
    call_id: 'c1',
    media: 'audio',
    duration_ms: 192_000,
    joined_user_ids: [ME, OTHER],
    ...over,
  });

describe('<CallLogRow>', () => {
  it('renders an answered voice call with duration', () => {
    const { container } = render(<CallLogRow msg={sys(call())} meId={ME} />);
    expect(container.querySelector('.poolse-call-log')).not.toBeNull();
    expect(container.textContent).toContain('Voice call');
    expect(container.textContent).toContain('3:12');
    expect(container.textContent).not.toContain('{');
  });

  it('renders "No answer" for an unanswered video call', () => {
    const { container } = render(
      <CallLogRow msg={sys(call({ media: 'video', duration_ms: null }))} meId={ME} />,
    );
    expect(container.textContent).toContain('Video call');
    expect(container.textContent).toContain('No answer');
  });

  it('shows missed markers only to their target', () => {
    const body = JSON.stringify({ kind: 'call_missed', call_id: 'c1', user_id: ME });
    const mine = render(<CallLogRow msg={sys(body)} meId={ME} />);
    expect(mine.container.querySelector('.poolse-call-log--missed')).not.toBeNull();
    expect(mine.container.textContent).toContain('Missed call');
    const theirs = render(<CallLogRow msg={sys(body)} meId={OTHER} />);
    expect(theirs.container.innerHTML).toBe('');
  });
});

describe('<MessageRow> with call logs', () => {
  it('renders the call-log line without bubble or actions', () => {
    const { container } = render(<MessageRow msg={sys(call())} meId={ME} />);
    expect(container.querySelector('.poolse-call-log')).not.toBeNull();
    expect(container.querySelector('.poolse-bubble')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
  });

  it('renders nothing for a foreign missed marker', () => {
    const body = JSON.stringify({ kind: 'call_missed', call_id: 'c1', user_id: OTHER });
    const { container } = render(<MessageRow msg={sys(body)} meId={ME} />);
    expect(container.innerHTML).toBe('');
  });
});
