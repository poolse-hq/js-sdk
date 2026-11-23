import { act, fireEvent, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ConversationView, type MessageComposerHandle } from '../src/index.js';
import { msg, viewRoutes } from './_fixtures.js';
import { jsonResponse, renderWithProvider, routedFetch } from './_helpers.js';

function routes() {
  return routedFetch(
    viewRoutes([msg(1)], {
      'POST /v1/conversations/c-1/messages': () => jsonResponse(msg(2, 'u-me')),
    }),
  );
}

const textarea = (c: HTMLElement) => c.querySelector('textarea') as HTMLTextAreaElement;
const posts = (f: ReturnType<typeof routes>) =>
  f.calls.filter((r) => r.method === 'POST' && r.url.endsWith('/messages'));

describe('ConversationView composer hooks', () => {
  it('composerProps reach the composer; composerAccessory renders above it', async () => {
    const onValueChange = vi.fn();
    const { container } = renderWithProvider(
      <ConversationView
        conversationId="c-1"
        loadFonts={false}
        composerProps={{ placeholder: 'Say hi', onValueChange }}
        composerAccessory={<div className="accessory">Scheduled</div>}
      />,
      routes(),
    );
    await waitFor(() => expect(container.textContent).toContain('message 1'));
    expect(textarea(container).placeholder).toBe('Say hi');
    expect(
      container.querySelector('.poolse-conversation__composer-flex .accessory'),
    ).not.toBeNull();
    fireEvent.change(textarea(container), { target: { value: 'x' } });
    expect(onValueChange).toHaveBeenCalledWith('x');
  });

  it('composerHandle inserts, sets and clears text', async () => {
    const handle = createRef<MessageComposerHandle>();
    const { container } = renderWithProvider(
      <ConversationView conversationId="c-1" loadFonts={false} composerHandle={handle} />,
      routes(),
    );
    await waitFor(() => expect(container.textContent).toContain('message 1'));
    act(() => handle.current!.setText('hello'));
    expect(textarea(container).value).toBe('hello');
    act(() => handle.current!.insertText('!'));
    expect(textarea(container).value).toContain('!');
    act(() => handle.current!.clear());
    expect(textarea(container).value).toBe('');
    expect(handle.current!.getText()).toBe('');
  });

  it('beforeSend can change the message', async () => {
    const fetch = routes();
    const { container } = renderWithProvider(
      <ConversationView
        conversationId="c-1"
        loadFonts={false}
        beforeSend={async (draft) => ({ ...draft, body: `${draft.body} (edited)` })}
      />,
      fetch,
    );
    await waitFor(() => expect(container.textContent).toContain('message 1'));
    fireEvent.change(textarea(container), { target: { value: 'hi' } });
    fireEvent.submit(container.querySelector('form.poolse-composer')!);
    await waitFor(() => expect(posts(fetch)).toHaveLength(1));
    expect(((await posts(fetch)[0]!.clone().json()) as { body: string }).body).toBe('hi (edited)');
  });

  it('beforeSend returning false cancels and keeps the text', async () => {
    const fetch = routes();
    const beforeSend = vi.fn(async () => false as const);
    const { container } = renderWithProvider(
      <ConversationView conversationId="c-1" loadFonts={false} beforeSend={beforeSend} />,
      fetch,
    );
    await waitFor(() => expect(container.textContent).toContain('message 1'));
    fireEvent.change(textarea(container), { target: { value: 'not yet' } });
    fireEvent.submit(container.querySelector('form.poolse-composer')!);
    await waitFor(() => expect(beforeSend).toHaveBeenCalled());
    await waitFor(() => expect(textarea(container).value).toBe('not yet'));
    expect(posts(fetch)).toHaveLength(0);
  });
});
