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
    const { container } = renderWithProvider(
      <AttachmentPreview attachment={imageAtt} />,
      fetchFn,
    );
    await waitFor(() => expect(container.querySelector('img')).not.toBeNull());
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      'https://cdn.test/cat.png?sig=1',
    );
  });

  it('renders a file card for non-image content_type, with filename + size', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse({ url: 'https://cdn.test/spec.pdf?sig=2', method: 'get' }),
    ]);
    const { container } = renderWithProvider(
      <AttachmentPreview attachment={fileAtt} />,
      fetchFn,
    );
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
    const { container } = renderWithProvider(
      <AttachmentPreview attachment={imageAtt} />,
      fetchFn,
    );
    expect(container.textContent).toMatch(/loading/i);
  });
});
