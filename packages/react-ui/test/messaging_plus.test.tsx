import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Attachment, Block, Message, Poll } from '@poolse/sdk';
import { CustomEmojiProvider } from '@poolse/react';
import {
  BlockRenderer,
  CatchUpCard,
  FilesList,
  ForumPostList,
  ForwardDialog,
  NoteCard,
  PinsList,
  PollCard,
  TranslatedText,
  formatBytes,
  noteIdFromLink,
} from '../src/MessagingPlus.js';
import { VoiceMessagePlayer } from '../src/MediaMessages.js';
import { EmojiGlyph } from '../src/EmojiPicker.js';
import { MessageActions } from '../src/MessageActions.js';

const poll: Poll = {
  options: [
    { id: '1', text: 'Pizza', votes: 3, voter_ids: [] },
    {
      id: '2',
      text: 'A much longer option text that keeps going and going',
      votes: 1,
      voter_ids: [],
    },
  ],
  multiple: false,
  anonymous: true,
  closes_at: null,
  closed_at: null,
  closed: false,
  voters: 4,
};

describe('PollCard', () => {
  it('hides results until you vote, then shows percentages', () => {
    const onToggle = vi.fn();
    const { container, rerender, getAllByRole } = render(
      <PollCard question="Lunch?" poll={poll} myOptionIds={[]} onToggle={onToggle} />,
    );
    expect(container.querySelector('.poolse-poll__count')).toBeNull();
    fireEvent.click(getAllByRole('radio')[0]!);
    expect(onToggle).toHaveBeenCalledWith('1');
    rerender(<PollCard question="Lunch?" poll={poll} myOptionIds={['1']} onToggle={onToggle} />);
    expect(container.textContent).toContain('75% · 3');
    expect(getAllByRole('radio')[0]!.getAttribute('aria-checked')).toBe('true');
  });

  it('disables options once closed and offers Close only while open', () => {
    const onClose = vi.fn();
    const open = render(
      <PollCard
        question="Q"
        poll={{ ...poll, multiple: true }}
        myOptionIds={[]}
        onClose={onClose}
      />,
    );
    expect(open.getAllByRole('checkbox')).toHaveLength(2);
    fireEvent.click(open.getByText('Close poll'));
    expect(onClose).toHaveBeenCalled();
    cleanup();
    const closed = render(
      <PollCard question="Q" poll={{ ...poll, closed: true }} myOptionIds={[]} onClose={onClose} />,
    );
    expect(closed.queryByText('Close poll')).toBeNull();
    expect((closed.getAllByRole('radio')[0] as HTMLButtonElement).disabled).toBe(true);
    expect(closed.container.textContent).toContain('Closed');
  });
});

describe('BlockRenderer', () => {
  const blocks: Block[] = [
    { type: 'section', text: '**Deploy 4.2** is waiting' },
    { type: 'divider' },
    { type: 'input', action_id: 'reason', label: 'Reason', input: 'text', required: true },
    {
      type: 'input',
      action_id: 'tags',
      label: 'Tags',
      input: 'checkboxes',
      options: [{ text: 'Urgent', value: 'u' }],
    },
    {
      type: 'actions',
      elements: [
        { type: 'button', action_id: 'approve', text: 'Approve', style: 'primary', value: '4.2' },
        { type: 'button', action_id: 'docs', text: 'Docs', url: 'https://example.com' },
        {
          type: 'select',
          action_id: 'env',
          placeholder: 'Environment',
          options: [{ text: 'Prod', value: 'prod' }],
        },
        { type: 'button', action_id: 'send', text: 'Submit', submit: true },
      ],
    },
  ];
  it('renders, sends button and select actions, and validates forms', async () => {
    const onAction = vi.fn().mockResolvedValue(undefined);
    const { container, getByText, getByLabelText } = render(
      <BlockRenderer blocks={blocks} onAction={onAction} />,
    );
    expect(container.querySelector('strong')?.textContent).toBe('Deploy 4.2');
    expect(getByText('Docs').getAttribute('href')).toBe('https://example.com');
    await act(async () => {
      fireEvent.click(getByText('Approve'));
    });
    expect(onAction).toHaveBeenLastCalledWith({ action_id: 'approve' });
    await act(async () => {
      fireEvent.change(getByLabelText('Environment'), { target: { value: 'prod' } });
    });
    expect(onAction).toHaveBeenLastCalledWith({ action_id: 'env', value: 'prod' });
    await act(async () => {
      fireEvent.click(getByText('Submit'));
    });
    expect(getByText('Required')).toBeTruthy();
    expect(onAction).toHaveBeenCalledTimes(2);
    fireEvent.change(getByLabelText(/Reason/), { target: { value: 'ship it' } });
    fireEvent.click(getByLabelText('Urgent'));
    await act(async () => {
      fireEvent.click(getByText('Submit'));
    });
    expect(onAction).toHaveBeenLastCalledWith({
      action_id: 'send',
      values: { reason: 'ship it', tags: ['u'], env: 'prod' },
    });
  });
});

const message = (over: Partial<Message> = {}): Message => ({
  id: 'm-1',
  tenant_id: 't',
  conversation_id: 'c',
  sender_id: 'u',
  sender_external_id: 'ana-7f3c',
  type: 'text',
  body: 'Release notes are here',
  reply_to_id: null,
  thread_root_id: null,
  mentions: [],
  reactions: {},
  edited_at: null,
  deleted_at: null,
  sequence: 1,
  inserted_at: '2026-11-20T10:00:00Z',
  updated_at: '2026-11-20T10:00:00Z',
  pinned_at: '2026-11-21T10:00:00Z',
  ...over,
});

describe('lists', () => {
  it('PinsList shows names, never ids', () => {
    const onUnpin = vi.fn();
    const { container, getByLabelText } = render(
      <PinsList
        pins={[message()]}
        labelFor={(id) => (id === 'ana-7f3c' ? 'Ana' : 'Someone')}
        onUnpin={onUnpin}
      />,
    );
    expect(container.textContent).toContain('Ana');
    expect(container.textContent).not.toContain('ana-7f3c');
    fireEvent.click(getByLabelText('Unpin'));
    expect(onUnpin).toHaveBeenCalled();
    expect(render(<PinsList pins={[]} />).container.textContent).toContain('No pinned messages');
  });

  it('FilesList shows name, size and version', () => {
    const f = {
      id: 'a',
      original_filename: 'Quarterly report with a very long file name.pdf',
      byte_size: 3_400_000,
      kind: 'document',
      version: 2,
      inserted_at: '2026-11-20T10:00:00Z',
    } as Attachment;
    const onVersions = vi.fn();
    const { container, getByText } = render(<FilesList files={[f]} onVersions={onVersions} />);
    expect(container.textContent).toContain('3.2 MB · v2');
    fireEvent.click(getByText('Versions'));
    expect(onVersions).toHaveBeenCalledWith(f);
    expect(formatBytes(512)).toBe('512 B');
  });

  it('ForumPostList shows reply counts and tags', () => {
    const { container } = render(
      <ForumPostList
        posts={[
          {
            messageId: 'p',
            title: 'Idea: dark mode',
            authorName: 'Ana',
            replyCount: 1,
            lastActivityAt: '2026-11-20T10:00:00Z',
            tags: [{ name: 'ideas' }],
          },
        ]}
      />,
    );
    expect(container.textContent).toContain('1 reply');
    expect(container.textContent).toContain('ideas');
  });
});

describe('forward, catch-up, translate, note card', () => {
  it('ForwardDialog forwards to the picked targets with a comment', async () => {
    const onForward = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    const { getByLabelText, getByText } = render(
      <ForwardDialog
        targets={[
          { id: 'c1', name: 'general' },
          { id: 'c2', name: 'design' },
        ]}
        onForward={onForward}
        onClose={onClose}
      />,
    );
    fireEvent.click(getByLabelText('general'));
    fireEvent.click(getByLabelText('design'));
    fireEvent.change(getByLabelText('Add a message'), { target: { value: 'fyi' } });
    await act(async () => {
      fireEvent.click(getByText('Forward to 2'));
    });
    expect(onForward).toHaveBeenCalledWith(['c1', 'c2'], 'fyi');
    expect(onClose).toHaveBeenCalled();
  });

  it('CatchUpCard shows the summary and opens highlights', () => {
    const onOpen = vi.fn();
    const { getByText } = render(
      <CatchUpCard
        result={{
          summary: 'Pricing **decided**',
          highlights: [{ message_id: 'm', sequence: 9, why: 'Decision on pricing' }],
          message_count: 143,
          truncated: false,
          since: '',
          until: '',
        }}
        onOpenMessage={onOpen}
      />,
    );
    fireEvent.click(getByText('Decision on pricing'));
    expect(onOpen).toHaveBeenCalledWith('m', 9);
    expect(getByText('143 messages')).toBeTruthy();
    expect(
      render(<CatchUpCard result={null} onRun={() => undefined} />).getByText(
        'Summarise what I missed',
      ),
    ).toBeTruthy();
  });

  it('TranslatedText swaps the body and offers the original', () => {
    const onToggle = vi.fn();
    const { container, getByText } = render(
      <TranslatedText translation="Hallo" languageName="German" onToggle={onToggle}>
        <p>Hello</p>
      </TranslatedText>,
    );
    expect(container.textContent).toContain('Hallo');
    expect(container.textContent).not.toContain('Hello');
    fireEvent.click(getByText('Show original'));
    expect(onToggle).toHaveBeenCalled();
  });

  it('NoteCard and note links', () => {
    expect(
      noteIdFromLink('https://chat.acme.com/workspace/l/note/5b0e8c1e-1d2f-4c5a-9e2d-0a1b2c3d4e5f'),
    ).toBe('5b0e8c1e-1d2f-4c5a-9e2d-0a1b2c3d4e5f');
    expect(noteIdFromLink('https://x/other')).toBeNull();
    const { container } = render(
      <NoteCard title={null} encrypted sharedByName="Ana" updated onOpen={() => undefined} />,
    );
    expect(container.textContent).toContain('Encrypted note');
    expect(container.textContent).toContain('Shared by Ana');
    expect(render(<NoteCard title="x" unavailable />).container.textContent).toContain(
      "don't have access",
    );
  });
});

describe('media, emoji, actions', () => {
  it('VoiceMessagePlayer cycles 1× → 1.5× → 2× and shows the transcript', () => {
    const a = {
      id: 'v',
      duration_ms: 12_400,
      transcript_status: 'ready',
      transcript: 'Hi Ana',
    } as Attachment;
    const { getByLabelText, getByText, container } = render(
      <VoiceMessagePlayer src="blob:x" attachment={a} />,
    );
    expect(container.textContent).toContain('0:12');
    fireEvent.click(getByLabelText('Playback speed 1×'));
    fireEvent.click(getByLabelText('Playback speed 1.5×'));
    expect(getByLabelText('Playback speed 2×')).toBeTruthy();
    expect((container.querySelector('audio') as HTMLAudioElement).playbackRate).toBe(2);
    fireEvent.click(getByText('Show transcript'));
    expect(getByText('Hi Ana')).toBeTruthy();
  });

  it('EmojiGlyph renders a known custom emoji as an image', () => {
    const { container } = render(
      <CustomEmojiProvider emoji={[{ name: 'shipit', url: 'https://w/e/shipit.png' }]}>
        <EmojiGlyph emoji=":shipit:" />
        <EmojiGlyph emoji=":unknown:" />
      </CustomEmojiProvider>,
    );
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://w/e/shipit.png');
    expect(container.textContent).toContain(':unknown:');
  });

  it('MessageActions offers pin, forward and translate', () => {
    const onTogglePin = vi.fn();
    const onForward = vi.fn();
    const { getByLabelText } = render(
      <MessageActions
        onTogglePin={onTogglePin}
        pinned
        onForward={onForward}
        onTranslate={() => undefined}
      />,
    );
    fireEvent.click(getByLabelText('Unpin'));
    fireEvent.click(getByLabelText('Forward'));
    expect(getByLabelText('Translate')).toBeTruthy();
    expect(onTogglePin).toHaveBeenCalled();
    expect(onForward).toHaveBeenCalled();
  });
});
