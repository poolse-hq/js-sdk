// Model-backed endpoints wait on an LLM (the server gives it 60 s), so
// they pass AI_REQUEST_TIMEOUT_MS instead of the 30 s default.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AI_REQUEST_TIMEOUT_MS } from '../src/index.js';
import { RestClient, type RequestOptions } from '../src/rest-client.js';
import { buildPoolse, jsonResponse, scriptedFetch } from './_helpers.js';

const summary = {
  data: { id: 'sum-1', call_id: 'call-1', status: 'queued', style: 'general' },
};

function spyRequests(): RequestOptions[] {
  const seen: RequestOptions[] = [];
  const original = RestClient.prototype.request;
  vi.spyOn(RestClient.prototype, 'request').mockImplementation(function (
    this: RestClient,
    opts: RequestOptions,
  ) {
    seen.push(opts);
    return original.call(this, opts);
  } as typeof original);
  return seen;
}

const timeoutOf = (seen: RequestOptions[], method: string, path: string) =>
  seen.find((o) => o.method === method && o.path === path)?.minTimeoutMs;

describe('per-endpoint request timeouts', () => {
  afterEach(() => vi.restoreAllMocks());

  it('is 90 s', () => {
    expect(AI_REQUEST_TIMEOUT_MS).toBe(90_000);
  });

  it('model-backed endpoints pass AI_REQUEST_TIMEOUT_MS', async () => {
    const seen = spyRequests();
    const chat = buildPoolse(
      scriptedFetch([
        jsonResponse({ data: { answer: 'Friday', sources: [] } }),
        jsonResponse(summary),
        jsonResponse({ data: { channel: 'message', text: 'Hi all', subject: null } }),
        jsonResponse({ summary: 'x', highlights: [], message_count: 1, truncated: false }),
        jsonResponse({ text: 'Hallo', language: 'de' }),
      ]),
    );
    await chat.meetings.ask({ question: 'When do we ship?' }).catch(() => {});
    await chat.meetings.regenerateSummary('call-1').catch(() => {});
    await chat.meetings.followUp('call-1').catch(() => {});
    await chat.conversations.one('c-1').messages.catchUp();
    await chat.messages.one('m-1').translate('de');

    expect(timeoutOf(seen, 'POST', '/v1/meetings/ask')).toBe(AI_REQUEST_TIMEOUT_MS);
    expect(timeoutOf(seen, 'POST', '/v1/calls/call-1/summary')).toBe(AI_REQUEST_TIMEOUT_MS);
    expect(timeoutOf(seen, 'POST', '/v1/calls/call-1/summary/follow-up')).toBe(
      AI_REQUEST_TIMEOUT_MS,
    );
    expect(timeoutOf(seen, 'POST', '/v1/conversations/c-1/catch-up')).toBe(AI_REQUEST_TIMEOUT_MS);
    expect(timeoutOf(seen, 'POST', '/v1/messages/m-1/translate')).toBe(AI_REQUEST_TIMEOUT_MS);
  });

  it('other endpoints keep the default', async () => {
    const seen = spyRequests();
    const chat = buildPoolse(
      scriptedFetch([
        jsonResponse(summary),
        jsonResponse({ data: [] }),
        jsonResponse({ id: 'msg-1' }, { status: 201 }),
      ]),
    );
    await chat.meetings.summary('call-1').catch(() => {});
    await chat.conversations.one('c-1').messages.pins();
    await chat.conversations
      .one('c-1')
      .messages.send({ text: 'hi' } as never)
      .catch(() => {});

    expect(seen.length).toBeGreaterThanOrEqual(3);
    for (const o of seen) expect(o.timeoutMs ?? o.minTimeoutMs).toBeUndefined();
  });
});
