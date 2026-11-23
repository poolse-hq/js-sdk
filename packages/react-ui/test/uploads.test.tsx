import { fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationView, MessageComposer, type ChatLayout } from '../src/index.js';
import { msg, viewRoutes } from './_fixtures.js';
import { renderWithProvider, routedFetch } from './_helpers.js';

const file = (name: string, type: string, size = 4) =>
  new File([new Uint8Array(size)], name, { type });

// Uploads go to POST /v1/attachments/upload-url first; refusing it keeps
// the chip on screen (as an error) without a real upload.
const uploadRoutes = () =>
  routedFetch({
    'POST /v1/attachments/upload-url': () => new Response('nope', { status: 500 }),
  });

const originalCreate = URL.createObjectURL;
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:thumb');
});
afterEach(() => {
  URL.createObjectURL = originalCreate;
});

const chips = (c: HTMLElement) => Array.from(c.querySelectorAll('.poolse-upload-chip'));

describe('composer uploads', () => {
  it('pasting a file queues it with an image thumbnail', async () => {
    // The upload stays in flight: an errored chip drops its thumbnail.
    const pending = vi.fn(
      () => new Promise<Response>(() => undefined),
    ) as unknown as typeof globalThis.fetch;
    const { container } = renderWithProvider(<MessageComposer onSend={vi.fn()} />, pending);
    const input = container.querySelector('textarea')!;
    fireEvent.paste(input, { clipboardData: { files: [file('shot.png', 'image/png')] } });
    await waitFor(() => expect(chips(container)).toHaveLength(1));
    expect(chips(container)[0]?.textContent).toContain('shot.png');
    expect(container.querySelector('.poolse-upload-chip__thumb')?.getAttribute('src')).toBe(
      'blob:thumb',
    );
  });

  it('a paste without files is plain text', () => {
    const { container } = renderWithProvider(<MessageComposer onSend={vi.fn()} />, uploadRoutes());
    const input = container.querySelector('textarea')!;
    fireEvent.paste(input, { clipboardData: { files: [] } });
    expect(chips(container)).toHaveLength(0);
  });

  it('refuses files over maxFileSize or of another type, with an error chip', async () => {
    const fetchFn = uploadRoutes();
    const { container } = renderWithProvider(
      <MessageComposer onSend={vi.fn()} maxFileSize={10} acceptFileTypes={['image/*', '.pdf']} />,
      fetchFn,
    );
    const picker = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(picker.accept).toBe('image/*,.pdf');
    fireEvent.change(picker, {
      target: {
        files: [file('big.png', 'image/png', 50), file('run.exe', 'application/x-msdownload')],
      },
    });
    await waitFor(() => expect(chips(container)).toHaveLength(2));
    expect(chips(container)[0]?.textContent).toContain('Larger than 10 B');
    expect(chips(container)[1]?.textContent).toContain("This file type isn't allowed");
    expect(fetchFn.calls).toHaveLength(0);
    fireEvent.click(chips(container)[0]!.querySelector('button')!);
    expect(chips(container)).toHaveLength(1);
  });
});

describe('dropping files on the conversation', () => {
  for (const layout of ['bubbles', 'list', 'compact'] as ChatLayout[]) {
    it(`${layout}: shows the overlay and queues the files`, async () => {
      const fetchFn = routedFetch(
        viewRoutes([msg(1)], {
          'POST /v1/attachments/upload-url': () => new Response('nope', { status: 500 }),
        }),
      );
      const { container } = renderWithProvider(
        <ConversationView conversationId="c-1" layout={layout} loadFonts={false} />,
        fetchFn,
      );
      await waitFor(() => expect(container.textContent).toContain('message 1'));
      const pane = container.querySelector('.poolse-conversation')!;
      const dataTransfer = { types: ['Files'], files: [file('notes.txt', 'text/plain')] };
      fireEvent.dragEnter(pane, { dataTransfer });
      expect(container.querySelector('.poolse-conversation__drop-overlay')).not.toBeNull();
      fireEvent.drop(pane, { dataTransfer });
      expect(container.querySelector('.poolse-conversation__drop-overlay')).toBeNull();
      await waitFor(() => expect(chips(container)[0]?.textContent).toContain('notes.txt'));
    });
  }
});
