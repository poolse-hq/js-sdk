import { act, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@poolse/sdk';
import { MessageComposer } from '../src/MessageComposer.js';
import { MentionInput } from '../src/MentionInput.js';
import { jsonResponse, renderWithProvider, routedFetch, scriptedFetch } from './_helpers.js';

const input = (c: HTMLElement) => c.querySelector('.poolse-composer__input') as HTMLTextAreaElement;
const tick = () => new Promise((r) => setTimeout(r, 20));

describe('composer extras', () => {
  it('formats the selection from the toolbar and by shortcut', async () => {
    const { container, getByLabelText } = renderWithProvider(
      <MessageComposer onSend={vi.fn()} formattingToolbar />,
      scriptedFetch([]),
    );
    const ta = input(container);
    fireEvent.change(ta, { target: { value: 'say hi' } });
    ta.setSelectionRange(4, 6);
    fireEvent.click(getByLabelText('Bold'));
    expect(ta.value).toBe('say **hi**');
    ta.setSelectionRange(0, 3);
    fireEvent.keyDown(ta, { key: 'i', metaKey: true });
    expect(ta.value).toBe('_say_ **hi**');
    expect(container.querySelectorAll('.poolse-format-toolbar__btn')).toHaveLength(11);
  });

  it('shows only the chosen toolbar buttons, and none by default', () => {
    const a = renderWithProvider(<MessageComposer onSend={vi.fn()} />, scriptedFetch([]));
    expect(a.container.querySelector('.poolse-format-toolbar')).toBeNull();
    const b = renderWithProvider(
      <MessageComposer onSend={vi.fn()} formattingToolbar={['bold', 'link']} />,
      scriptedFetch([]),
    );
    expect(b.container.querySelectorAll('.poolse-format-toolbar__btn')).toHaveLength(2);
  });

  it('suggests slash commands and inserts the picked one', () => {
    const { container } = renderWithProvider(
      <MessageComposer
        onSend={vi.fn()}
        commands={[
          { name: 'jira', description: 'Create an issue', source: 'Jira Cloud' },
          { name: 'poll', description: 'Start a poll' },
        ]}
      />,
      scriptedFetch([]),
    );
    const ta = input(container);
    fireEvent.change(ta, { target: { value: '/ji', selectionStart: 3 } });
    const items = container.querySelectorAll('.poolse-command-menu .poolse-mention-menu__item');
    expect(items).toHaveLength(1);
    expect(items[0]!.textContent).toContain('Jira Cloud');
    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(ta.value).toBe('/jira ');
    expect(container.querySelector('.poolse-command-menu')).toBeNull();
  });

  it('shows the DLP warning, keeps the text, and sends again when acknowledged', async () => {
    const onSend = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiError(422, {
          code: 'dlp_warning',
          message: 'warn',
          doc_url: '',
          details: { rules: [{ id: 'cards', name: 'Card number' }] },
        }),
      )
      .mockResolvedValueOnce(undefined);
    const { container, getByRole, getByText } = renderWithProvider(
      <MessageComposer onSend={onSend} />,
      scriptedFetch([]),
    );
    const ta = input(container);
    fireEvent.change(ta, { target: { value: 'card 4111111111111111' } });
    fireEvent.keyDown(ta, { key: 'Enter' });
    await tick();
    expect(getByRole('alertdialog')).toBeTruthy();
    expect(getByText('Card number')).toBeTruthy();
    expect(ta.value).toBe('card 4111111111111111');
    await act(async () => {
      fireEvent.click(getByText('Send anyway'));
      await tick();
    });
    expect(onSend).toHaveBeenLastCalledWith('card 4111111111111111', { dlp_acknowledged: true });
    expect(container.querySelector('.poolse-dlp-dialog')).toBeNull();
    expect(ta.value).toBe('');
  });

  // A ready upload: the presign route answers, the PUT goes through fetch.
  const uploadOk = () =>
    routedFetch({
      'POST /v1/attachments/upload-url': () =>
        jsonResponse({
          attachment: {
            id: 'att-1',
            tenant_id: 't-1',
            message_id: null,
            sender_id: 'u-me',
            content_type: 'text/plain',
            byte_size: 4,
            sha256: null,
            original_filename: 'a.txt',
            status: 'pending',
          },
          upload: { url: 'https://store.test/put', method: 'put', headers: {} },
        }),
      'PUT /put': () => new Response(null, { status: 200 }),
      'GET /v1/conversations/c-1/members': () => jsonResponse({ data: [] }),
    });
  const dlpWarning = () =>
    new ApiError(422, {
      code: 'dlp_warning',
      message: 'warn',
      doc_url: '',
      details: { rules: [{ id: 'cards', name: 'Card number' }] },
    });

  for (const kind of ['MessageComposer', 'MentionInput'] as const) {
    it(`${kind}: "Send anyway" sweeps the files it sent`, async () => {
      const xhr = globalThis.XMLHttpRequest;
      // @ts-expect-error -- the SDK PUTs through fetch without XHR.
      delete globalThis.XMLHttpRequest;
      try {
        const onSend = vi.fn().mockRejectedValueOnce(dlpWarning()).mockResolvedValue(undefined);
        const { container, getByText } = renderWithProvider(
          kind === 'MessageComposer' ? (
            <MessageComposer onSend={onSend} />
          ) : (
            <MentionInput conversationId="c-1" onSend={onSend} />
          ),
          uploadOk(),
        );
        const picker = container.querySelector('input[type="file"]') as HTMLInputElement;
        fireEvent.change(picker, {
          target: { files: [new File([new Uint8Array(4)], 'a.txt', { type: 'text/plain' })] },
        });
        await waitFor(() =>
          expect(container.querySelector('.poolse-upload-chip')?.textContent).not.toMatch(
            /upload/i,
          ),
        );
        const ta = input(container);
        fireEvent.change(ta, { target: { value: 'card 4111111111111111' } });
        await act(async () => {
          fireEvent.keyDown(ta, { key: 'Enter' });
          await tick();
        });
        await act(async () => {
          fireEvent.click(getByText('Send anyway'));
          await tick();
        });
        expect(JSON.stringify(onSend.mock.calls.at(-1))).toContain('att-1');
        expect(container.querySelector('.poolse-upload-chip')).toBeNull();
      } finally {
        globalThis.XMLHttpRequest = xhr;
      }
    });
  }

  it('offers no "Send anyway" on a block', async () => {
    const onSend = vi
      .fn()
      .mockRejectedValue(
        new ApiError(422, { code: 'dlp_blocked', message: 'no', doc_url: '', details: {} }),
      );
    const { container, queryByText, getByText } = renderWithProvider(
      <MessageComposer onSend={onSend} />,
      scriptedFetch([]),
    );
    fireEvent.change(input(container), { target: { value: 'secret' } });
    fireEvent.keyDown(input(container), { key: 'Enter' });
    await tick();
    expect(getByText("This message can't be sent")).toBeTruthy();
    expect(queryByText('Send anyway')).toBeNull();
    fireEvent.click(getByText('Edit message'));
    expect(container.querySelector('.poolse-dlp-dialog')).toBeNull();
    expect(input(container).value).toBe('secret');
  });

  it('MentionInput offers groups after members', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse({
        data: [
          {
            id: 'm-1',
            conversation_id: 'c-1',
            user_id: 'u-1',
            external_id: 'dana',
            role: 'member',
            last_read_message_id: null,
            last_read_at: null,
            inserted_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
      }),
    ]);
    const onSend = vi.fn();
    const { container } = renderWithProvider(
      <MentionInput
        conversationId="c-1"
        onSend={onSend}
        labelFor={(id) => (id === 'dana' ? 'Dana' : id)}
        groups={[
          { handle: 'design', name: 'Design team', memberCount: 12 },
          { handle: 'oncall', name: 'On call', description: 'On call: Ana' },
        ]}
      />,
      fetchFn,
    );
    await waitFor(() => expect(fetchFn.calls.length).toBeGreaterThan(0));
    const ta = input(container);
    act(() => {
      fireEvent.change(ta, { target: { value: '@d', selectionStart: 2 } });
    });
    await waitFor(() =>
      expect(container.querySelectorAll('.poolse-mention-menu__item')).toHaveLength(2),
    );
    const items = container.querySelectorAll('.poolse-mention-menu__item');
    expect(items[0]!.textContent).toContain('Dana');
    expect(items[1]!.textContent).toContain('Design team');
    expect(items[1]!.textContent).toContain('12 people');
    fireEvent.mouseDown(items[1]!);
    expect(ta.value).toBe('@design ');
  });
});
