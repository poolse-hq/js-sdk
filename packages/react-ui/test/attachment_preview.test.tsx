import { waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AttachmentPreview } from '../src/AttachmentPreview.js';
import { jsonResponse, renderWithProvider, scriptedFetch } from './_helpers.js';

const imageAtt = {
  id: 'a-img',
  tenant_id: 't-1',
  message_id: 'm-1',
  sender_id: 'u-1',
  content_type: 'image/png',
  byte_size: 24000,
  sha256: null,
  original_filename: 'cat.png',
  status: 'ready' as const,
  inserted_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const fileAtt = {
  ...imageAtt,
  id: 'a-doc',
  content_type: 'application/pdf',
  original_filename: 'spec.pdf',
  byte_size: 540 * 1024,
};

describe('<AttachmentPreview>', () => {
  it('renders an <img> for image content_type', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse({ url: 'https://cdn.test/cat.png?sig=1', method: 'get' }),
    ]);
    const { container } = renderWithProvider(<AttachmentPreview attachment={imageAtt} />, fetchFn);
    await waitFor(() => expect(container.querySelector('img')).not.toBeNull());
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      'https://cdn.test/cat.png?sig=1',
    );
  });

  it('renders a file card for non-image content_type, with filename + size', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse({ url: 'https://cdn.test/spec.pdf?sig=2', method: 'get' }),
    ]);
    const { container } = renderWithProvider(<AttachmentPreview attachment={fileAtt} />, fetchFn);
    await waitFor(() =>
      expect(container.querySelector('.poolse-attachment__file-name')).not.toBeNull(),
    );
    expect(container.textContent).toContain('spec.pdf');
    expect(container.textContent).toMatch(/540\.0 KB|KB/);
    // Download anchor points at the presigned URL.
    expect(container.querySelector('a')?.getAttribute('href')).toBe(
      'https://cdn.test/spec.pdf?sig=2',
    );
  });

  it('shows a loading placeholder while the URL fetch is pending', () => {
    const fetchFn = scriptedFetch([]);
    const { container } = renderWithProvider(<AttachmentPreview attachment={imageAtt} />, fetchFn);
    expect(container.textContent).toMatch(/loading/i);
  });
});

describe('<ImageMosaic> viewer', () => {
  it('steps through every image, not just the four with a tile', async () => {
    const { fireEvent } = await import('@testing-library/react');
    const { ImageMosaic } = await import('../src/MessageBubble.js');
    const { routedFetch } = await import('./_helpers.js');
    const images = Array.from({ length: 6 }, (_, i) => ({
      ...imageAtt,
      id: `img-${i + 1}`,
      original_filename: `p${i + 1}.png`,
    }));
    const routes = Object.fromEntries(
      images.map((a) => [
        `GET /v1/attachments/${a.id}/download-url`,
        () => jsonResponse({ url: `https://cdn.test/${a.id}.png`, method: 'get' }),
      ]),
    );
    const { container, findByText, getByLabelText } = renderWithProvider(
      <ImageMosaic images={images} />,
      routedFetch(routes),
    );
    await waitFor(() => expect(container.querySelectorAll('img')).toHaveLength(4));
    // The fourth tile carries "+2"; it opens the viewer there.
    fireEvent.click(container.querySelectorAll('.poolse-attachment__image-button')[3]!);
    expect(await findByText('4 of 6')).toBeTruthy();
    fireEvent.click(getByLabelText('Next image'));
    fireEvent.click(await waitFor(() => getByLabelText('Next image')));
    expect(await findByText('6 of 6')).toBeTruthy();
    expect(container.querySelector('.poolse-lightbox__image')?.getAttribute('src')).toBe(
      'https://cdn.test/img-6.png',
    );
    expect(container.querySelector('[aria-label="Next image"]')).toBeNull();
  });
});
