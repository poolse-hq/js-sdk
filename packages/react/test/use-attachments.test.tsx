import { act, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useAttachmentUpload } from '../src/use-attachment-upload.js';
import { useAttachmentUrl } from '../src/use-attachment-url.js';
import { jsonResponse, noContent, renderHookWithProvider, scriptedFetch } from './_helpers.js';

const baseAttachment = {
  id: 'a-1',
  tenant_id: 't-1',
  message_id: null,
  sender_id: 'u-1',
  content_type: 'image/png',
  byte_size: 1024,
  sha256: null,
  original_filename: 'cat.png',
  status: 'pending' as const,
  inserted_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const baseUploadResponse = {
  attachment: baseAttachment,
  upload: {
    url: 'https://storage.test/a-1?sig=x',
    method: 'put' as const,
    headers: { 'content-type': 'image/png' },
  },
};

describe('useAttachmentUpload', () => {
  it('runs the full upload pipeline + tracks uploading/attachment state', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse(baseUploadResponse, { status: 201 }),
      new Response(null, { status: 200 }), // presigned PUT
    ]);
    const { result } = renderHookWithProvider(() => useAttachmentUpload(), fetchFn);

    expect(result.current.uploading).toBe(false);
    expect(result.current.attachment).toBeNull();

    await act(async () => {
      await result.current.upload({
        body: new Blob(['x'], { type: 'image/png' }),
        contentType: 'image/png',
        byteSize: 1,
        filename: 'cat.png',
      });
    });

    expect(result.current.uploading).toBe(false);
    expect(result.current.attachment?.id).toBe('a-1');
    expect(result.current.error).toBeNull();
  });

  it('surfaces a failed presigned PUT as error state and rethrows', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse(baseUploadResponse, { status: 201 }),
      new Response('forbidden', { status: 403 }),
    ]);
    const { result } = renderHookWithProvider(() => useAttachmentUpload(), fetchFn);

    let caught: unknown = null;
    await act(async () => {
      try {
        await result.current.upload({
          body: new Blob(['x'], { type: 'image/png' }),
          contentType: 'image/png',
          byteSize: 1,
        });
      } catch (err) {
        caught = err;
      }
    });
    expect(caught).not.toBeNull();
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.uploading).toBe(false);
  });

  it('tracks the queue + uploadAll resolves attachments in input order', async () => {
    const att2 = { ...baseAttachment, id: 'a-2', original_filename: 'dog.png' };
    const fetchFn = scriptedFetch([
      jsonResponse(baseUploadResponse, { status: 201 }),
      jsonResponse(
        { ...baseUploadResponse, attachment: att2, upload: baseUploadResponse.upload },
        { status: 201 },
      ),
      new Response(null, { status: 200 }),
      new Response(null, { status: 200 }),
    ]);
    const { result } = renderHookWithProvider(() => useAttachmentUpload(), fetchFn);

    let attachments: Awaited<ReturnType<typeof result.current.uploadAll>> = [];
    await act(async () => {
      attachments = await result.current.uploadAll([
        {
          body: new Blob(['x'], { type: 'image/png' }),
          contentType: 'image/png',
          byteSize: 1,
          filename: 'cat.png',
        },
        {
          body: new Blob(['y'], { type: 'image/png' }),
          contentType: 'image/png',
          byteSize: 1,
          filename: 'dog.png',
        },
      ]);
    });
    expect(attachments.map((a) => a.id)).toEqual(['a-1', 'a-2']);
    expect(result.current.queue.map((q) => q.status)).toEqual(['ready', 'ready']);
    expect(result.current.queue.map((q) => q.filename)).toEqual(['cat.png', 'dog.png']);
    expect(result.current.uploading).toBe(false);
  });

  it('remove() drops an item from the queue', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse(baseUploadResponse, { status: 201 }),
      new Response(null, { status: 200 }),
    ]);
    const { result } = renderHookWithProvider(() => useAttachmentUpload(), fetchFn);

    await act(async () => {
      await result.current.upload({
        body: new Blob(['x'], { type: 'image/png' }),
        contentType: 'image/png',
        byteSize: 1,
      });
    });
    expect(result.current.queue).toHaveLength(1);
    const id = result.current.queue[0]!.localId;
    act(() => result.current.remove(id));
    expect(result.current.queue).toHaveLength(0);
  });

  it('reset() clears state', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse(baseUploadResponse, { status: 201 }),
      new Response(null, { status: 200 }),
    ]);
    const { result } = renderHookWithProvider(() => useAttachmentUpload(), fetchFn);

    await act(async () => {
      await result.current.upload({
        body: new Blob(['x'], { type: 'image/png' }),
        contentType: 'image/png',
        byteSize: 1,
      });
    });
    expect(result.current.attachment).not.toBeNull();

    act(() => result.current.reset());
    expect(result.current.attachment).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.uploading).toBe(false);
  });
});

describe('useAttachmentUrl', () => {
  it('fetches presigned download URL on mount', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse({ url: 'https://storage.test/a-1?sig=dl', method: 'get' }),
    ]);
    const { result } = renderHookWithProvider(() => useAttachmentUrl('a-1'), fetchFn);

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.url).toBe('https://storage.test/a-1?sig=dl');
    expect(fetchFn.calls[0]?.url).toBe('https://chat.test/v1/attachments/a-1/download-url');
  });

  it('skips the fetch when id is null', () => {
    const fetchFn = scriptedFetch([]);
    const { result } = renderHookWithProvider(() => useAttachmentUrl(null), fetchFn);
    expect(result.current.url).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(fetchFn.calls).toHaveLength(0);
  });

  it('re-fetches when id changes', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse({ url: 'https://storage.test/a-1', method: 'get' }),
      jsonResponse({ url: 'https://storage.test/a-2', method: 'get' }),
    ]);
    const { result, rerender } = renderHookWithProvider(
      ({ id }: { id: string }) => useAttachmentUrl(id),
      fetchFn,
      { initialProps: { id: 'a-1' } },
    );

    await waitFor(() => expect(result.current.url).toBe('https://storage.test/a-1'));

    rerender({ id: 'a-2' });
    await waitFor(() => expect(result.current.url).toBe('https://storage.test/a-2'));
    // The second call goes to a-2's download URL.
    expect(fetchFn.calls[1]?.url).toBe('https://chat.test/v1/attachments/a-2/download-url');
  });
});

// `noContent` is imported for consistency with other test files even
// though no test here needs a 204 body.
void noContent;
