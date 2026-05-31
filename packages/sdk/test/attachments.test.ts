import { describe, expect, it } from 'vitest';
import { bodyJson, buildPoolse, jsonResponse, noContent, scriptedFetch } from './_helpers.js';

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
    url: 'https://storage.test/bucket/a-1?sig=xyz',
    method: 'put' as const,
    headers: {
      'content-type': 'image/png',
      'x-amz-acl': 'private',
    },
  },
};

describe('AttachmentsResource', () => {
  describe('requestUpload', () => {
    it('POSTs /v1/attachments/upload-url with required fields', async () => {
      const fetchFn = scriptedFetch([jsonResponse(baseUploadResponse, { status: 201 })]);
      const chat = buildPoolse(fetchFn);

      const result = await chat.attachments.requestUpload({
        content_type: 'image/png',
        byte_size: 1024,
        original_filename: 'cat.png',
      });

      expect(fetchFn.calls[0]?.url).toBe('https://chat.test/v1/attachments/upload-url');
      expect(fetchFn.calls[0]?.method).toBe('POST');
      expect(await bodyJson(fetchFn.calls[0]!)).toEqual({
        content_type: 'image/png',
        byte_size: 1024,
        original_filename: 'cat.png',
      });
      expect(result.attachment.id).toBe('a-1');
      expect(result.upload.url).toBe('https://storage.test/bucket/a-1?sig=xyz');
    });
  });

  describe('upload (end-to-end)', () => {
    it('does requestUpload + presigned PUT, returns the attachment', async () => {
      // Two fetch calls: (1) POST /v1/attachments/upload-url (auth'd),
      // (2) PUT https://storage.test/... (NO auth header — presigned).
      const fetchFn = scriptedFetch([
        jsonResponse(baseUploadResponse, { status: 201 }),
        new Response(null, { status: 200 }),
      ]);
      const chat = buildPoolse(fetchFn);

      const blob = new Blob(['fake-png-bytes'], { type: 'image/png' });
      const att = await chat.attachments.upload({
        body: blob,
        contentType: 'image/png',
        byteSize: blob.size,
        filename: 'cat.png',
      });

      expect(att.id).toBe('a-1');

      // Call 1: SDK request — has Authorization header.
      expect(fetchFn.calls[0]?.url).toBe('https://chat.test/v1/attachments/upload-url');
      expect(fetchFn.calls[0]?.headers.get('authorization')).toBe('Bearer jwt-abc');

      // Call 2: presigned PUT — MUST NOT include Authorization (would
      // break the presigned signature).
      const put = fetchFn.calls[1]!;
      expect(put.method).toBe('PUT');
      expect(put.url).toBe('https://storage.test/bucket/a-1?sig=xyz');
      expect(put.headers.get('authorization')).toBeNull();
      expect(put.headers.get('content-type')).toBe('image/png');
      expect(put.headers.get('x-amz-acl')).toBe('private');
    });

    it('throws a descriptive error if the presigned PUT fails', async () => {
      const fetchFn = scriptedFetch([
        jsonResponse(baseUploadResponse, { status: 201 }),
        new Response('Access Denied', { status: 403 }),
      ]);
      const chat = buildPoolse(fetchFn);

      await expect(
        chat.attachments.upload({
          body: new Blob(['x'], { type: 'image/png' }),
          contentType: 'image/png',
          byteSize: 1,
        }),
      ).rejects.toThrow(/PUT failed.*403.*a-1/);
    });

    it('omits original_filename from the request when not provided', async () => {
      const fetchFn = scriptedFetch([
        jsonResponse(baseUploadResponse, { status: 201 }),
        new Response(null, { status: 200 }),
      ]);
      const chat = buildPoolse(fetchFn);

      await chat.attachments.upload({
        body: new Blob(['x'], { type: 'image/png' }),
        contentType: 'image/png',
        byteSize: 1,
      });

      const sent = (await bodyJson(fetchFn.calls[0]!)) as Record<string, unknown>;
      expect(sent).toEqual({ content_type: 'image/png', byte_size: 1 });
      expect(sent.original_filename).toBeUndefined();
    });
  });
});

describe('AttachmentHandle', () => {
  it('downloadUrl → GET /v1/attachments/:id/download-url', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse({ url: 'https://storage.test/bucket/a-1?sig=download', method: 'get' }),
    ]);
    const chat = buildPoolse(fetchFn);

    const { url, method } = await chat.attachments.one('a-1').downloadUrl();

    expect(url).toBe('https://storage.test/bucket/a-1?sig=download');
    expect(method).toBe('get');
    expect(fetchFn.calls[0]?.method).toBe('GET');
    expect(fetchFn.calls[0]?.url).toBe('https://chat.test/v1/attachments/a-1/download-url');
  });

  it('delete → DELETE /v1/attachments/:id', async () => {
    const fetchFn = scriptedFetch([noContent()]);
    const chat = buildPoolse(fetchFn);

    await chat.attachments.one('a-1').delete();

    expect(fetchFn.calls[0]?.method).toBe('DELETE');
    expect(fetchFn.calls[0]?.url).toBe('https://chat.test/v1/attachments/a-1');
  });
});
