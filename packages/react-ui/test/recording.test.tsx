import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Message } from '@poolse/sdk';
import {
  ConsentPrompt,
  RecordingBanner,
  RecordingIndicator,
  TranscriptViewer,
} from '../src/index.js';
import { MessageRow } from '../src/MessageRow.js';
import { jsonResponse, renderWithProvider, scriptedFetch } from './_helpers.js';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

function sys(body: string): Message {
  return {
    id: 'm1',
    conversation_id: 'c',
    sender_id: null,
    sender_external_id: null,
    type: 'system',
    body,
    reactions: {},
    deleted_at: null,
    sequence: 1,
    inserted_at: '2026-06-01T10:00:00Z',
    updated_at: '2026-06-01T10:00:00Z',
  } as unknown as Message;
}

const notice = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    kind: 'recording',
    v: 1,
    event: 'started',
    call_id: 'call-1',
    recording_id: 'r-1',
    mode: 'video',
    auto: false,
    consent_required: false,
    started_by_user_id: OTHER,
    stopped_by_user_id: null,
    ...over,
  });

describe('recording notice in the message list', () => {
  it('renders a line, not raw JSON, and never the user id', () => {
    const { container } = render(<MessageRow msg={sys(notice())} meId={ME} />);
    expect(container.querySelector('.poolse-rec-notice')).not.toBeNull();
    expect(container.textContent).toContain('Recording started');
    expect(container.textContent).not.toContain('{');
    expect(container.textContent).not.toContain(OTHER);
  });

  it('names people when the list can', () => {
    const { container } = render(
      <MessageRow
        msg={sys(notice({ event: 'stopped', stopped_by_user_id: OTHER }))}
        meId={ME}
        nameForUserId={(id) => (id === OTHER ? 'Elena' : null)}
      />,
    );
    expect(container.textContent).toContain('Recording stopped');
    expect(container.textContent).toContain('by Elena');
  });
});

describe('<RecordingBanner>', () => {
  it('renders nothing while nothing is captured', () => {
    const { container } = render(<RecordingBanner recording={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('says what is captured and offers Stop', () => {
    const onStop = vi.fn();
    render(<RecordingBanner recording transcribing onStop={onStop} />);
    expect(screen.getByText('Recording and transcribing')).toBeTruthy();
    fireEvent.click(screen.getByText('Stop'));
    expect(onStop).toHaveBeenCalled();
  });

  it('a decliner is told they are listen-only and may change it', () => {
    const onChange = vi.fn();
    render(
      <RecordingBanner recording consentRequired myConsent="declined" onChangeConsent={onChange} />,
    );
    expect(screen.getByText(/listen-only/)).toBeTruthy();
    fireEvent.click(screen.getByText('Change'));
    expect(onChange).toHaveBeenCalled();
  });

  it('the indicator is a small pill', () => {
    const { container } = render(<RecordingIndicator recording={false} transcribing />);
    expect(container.textContent).toBe('Transcript');
  });
});

describe('<ConsentPrompt>', () => {
  it('accepting calls onAnswer, then onAccepted (to republish)', async () => {
    const onAnswer = vi.fn(async () => true);
    const onAccepted = vi.fn();
    render(<ConsentPrompt recording onAnswer={onAnswer} onAccepted={onAccepted} />);
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    fireEvent.click(screen.getByText('Agree'));
    await waitFor(() => expect(onAccepted).toHaveBeenCalled());
    expect(onAnswer).toHaveBeenCalledWith('accepted');
  });

  it('a failed answer keeps it open with an error', async () => {
    const onAccepted = vi.fn();
    render(<ConsentPrompt recording onAnswer={async () => false} onAccepted={onAccepted} />);
    fireEvent.click(screen.getByText('Agree'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(onAccepted).not.toHaveBeenCalled();
  });
});

describe('<TranscriptViewer>', () => {
  const transcript = {
    id: 't-1',
    call_id: 'call-1',
    conversation_id: 'c-1',
    status: 'ready',
    source: 'live',
    language: 'en',
    started_at: '2026-11-21T10:00:00Z',
    ended_at: '2026-11-21T10:05:00Z',
    segment_count: 3,
    storage: 'server',
    speakers: [
      { key: ME, user_id: ME, external_id: 'me', name: 'Jasir', corrected: false },
      {
        key: OTHER,
        user_id: OTHER,
        external_id: 'el',
        name: 'Elena Konstantinovna Vasilyeva-Petrovskaya',
        corrected: false,
      },
    ],
    segments: [
      {
        speaker: ME,
        speaker_user_id: ME,
        speaker_name: 'Jasir',
        text: 'Morning all.',
        start_ms: 0,
        end_ms: 900,
        language: 'en',
      },
      {
        speaker: OTHER,
        speaker_user_id: OTHER,
        speaker_name: 'Elena Konstantinovna Vasilyeva-Petrovskaya',
        text: 'The boiler is fixed.',
        start_ms: 2000,
        end_ms: 3500,
        language: 'en',
      },
      {
        speaker: OTHER,
        speaker_user_id: OTHER,
        speaker_name: 'Elena Konstantinovna Vasilyeva-Petrovskaya',
        text: 'Boiler invoice next.',
        start_ms: 64_000,
        end_ms: 66_000,
        language: 'en',
      },
    ],
  };

  it('shows speakers and times, searches, and renames', async () => {
    const renamed = {
      ...transcript,
      speakers: [
        transcript.speakers[0],
        { ...transcript.speakers[1], name: 'Elena', corrected: true },
      ],
      segments: transcript.segments.map((s) =>
        s.speaker === OTHER ? { ...s, speaker_name: 'Elena' } : s,
      ),
    };
    const fetchFn = scriptedFetch([
      jsonResponse({ data: transcript }),
      jsonResponse({ data: renamed }),
    ]);
    const { container } = renderWithProvider(<TranscriptViewer callId="call-1" />, fetchFn);

    await waitFor(() => expect(container.textContent).toContain('The boiler is fixed.'));
    expect(container.textContent).toContain('1:04');
    expect(container.textContent).not.toContain(OTHER);

    fireEvent.change(screen.getByLabelText('Search the transcript'), {
      target: { value: 'boiler' },
    });
    expect(screen.getByText('1 of 2')).toBeTruthy();
    expect(container.querySelectorAll('mark')).toHaveLength(2);

    fireEvent.click(screen.getByLabelText('Rename Elena Konstantinovna Vasilyeva-Petrovskaya'));
    const input = screen.getByLabelText('Speaker name');
    fireEvent.change(input, { target: { value: 'Elena' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(container.textContent).not.toContain('Vasilyeva'));
    expect(fetchFn.calls[1]?.method).toBe('PATCH');
    expect(await fetchFn.calls[1]?.json()).toEqual({ speakers: { [OTHER]: 'Elena' } });
  });
});
