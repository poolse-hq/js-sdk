import { fireEvent, render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConversationView, LinkPreviewCard, type ChatLayout } from '../src/index.js';
import { msg, viewRoutes } from './_fixtures.js';
import { jsonResponse, renderWithProvider, routedFetch } from './_helpers.js';

const site = {
  url: 'https://example.com/post',
  type: 'website' as const,
  title: 'A post',
  description: 'What it is about',
  site_name: 'Example',
  image_url: 'https://example.com/cover.png',
  favicon_url: 'https://example.com/favicon.ico',
};

const feed = [
  msg(1, 'u-2', { body: 'see https://example.com/post', link_previews: [site] }),
  msg(2, 'u-me', {
    body: 'https://img.example.com/cat.png',
    link_previews: [{ url: 'https://img.example.com/cat.png', type: 'image' }],
  }),
  msg(3, 'u-2', { body: 'no link' }),
];

const row = (container: HTMLElement, id: string) =>
  container.querySelector(`[data-message-id="${id}"]`) as HTMLElement;

describe('<LinkPreviewCard>', () => {
  it('renders site, title, description and image', () => {
    const { container } = render(<LinkPreviewCard preview={site} />);
    expect(container.querySelector('.poolse-link-preview__site')?.textContent).toBe('Example');
    expect(container.querySelector('.poolse-link-preview__title')?.textContent).toBe('A post');
    expect(container.querySelector('.poolse-link-preview__description')).not.toBeNull();
    expect(container.querySelector('.poolse-link-preview__image')?.getAttribute('src')).toBe(
      site.image_url,
    );
    expect(container.querySelector('a')?.getAttribute('rel')).toContain('noopener');
    expect(container.querySelector('.poolse-link-preview__remove')).toBeNull();
  });

  it('refuses non-http urls', () => {
    const { container } = render(
      <LinkPreviewCard preview={{ ...site, url: 'javascript:alert(1)' }} />,
    );
    expect(container.innerHTML).toBe('');
  });
});

describe('link previews in ConversationView', () => {
  for (const layout of ['bubbles', 'list', 'compact'] as ChatLayout[]) {
    it(`${layout}: cards under the text, image links inline, nothing reserved without`, async () => {
      const { container } = renderWithProvider(
        <ConversationView conversationId="c-1" layout={layout} loadFonts={false} />,
        routedFetch(viewRoutes(feed)),
      );
      await waitFor(() => expect(container.textContent).toContain('no link'));
      expect(row(container, 'm1').querySelector('.poolse-link-preview__title')?.textContent).toBe(
        'A post',
      );
      expect(row(container, 'm2').querySelector('.poolse-link-preview--image img')).not.toBeNull();
      expect(row(container, 'm3').querySelector('.poolse-link-previews')).toBeNull();
      // Only the sender gets the ×.
      expect(row(container, 'm1').querySelector('.poolse-link-preview__remove')).toBeNull();
      expect(row(container, 'm2').querySelector('.poolse-link-preview__remove')).not.toBeNull();
    });
  }

  it('linkPreviews={false} hides them', async () => {
    const { container } = renderWithProvider(
      <ConversationView conversationId="c-1" linkPreviews={false} loadFonts={false} />,
      routedFetch(viewRoutes(feed)),
    );
    await waitFor(() => expect(container.textContent).toContain('no link'));
    expect(container.querySelector('.poolse-link-preview')).toBeNull();
  });

  it('the sender’s × removes the preview through messages.update', async () => {
    const fetchFn = routedFetch(
      viewRoutes(feed, { 'PATCH /v1/messages/m2': () => jsonResponse(msg(2, 'u-me')) }),
    );
    const { container } = renderWithProvider(
      <ConversationView conversationId="c-1" loadFonts={false} />,
      fetchFn,
    );
    await waitFor(() => expect(container.textContent).toContain('no link'));
    fireEvent.click(row(container, 'm2').querySelector('.poolse-link-preview__remove')!);
    expect(row(container, 'm2').querySelector('.poolse-link-preview')).toBeNull();
    await waitFor(() => expect(fetchFn.calls.some((r) => r.method === 'PATCH')).toBe(true));
    const patch = fetchFn.calls.find((r) => r.method === 'PATCH')!;
    expect(await patch.json()).toEqual({
      remove_link_previews: ['https://img.example.com/cat.png'],
    });
  });
});
