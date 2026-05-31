import { describe, expect, it } from 'vitest';
import { bodyJson, buildPoolse, jsonResponse, noContent, scriptedFetch } from './_helpers.js';

const baseConv = {
  id: 'c-1',
  tenant_id: 't-1',
  type: 'group' as const,
  name: 'general',
  avatar_url: null,
  created_by_user_id: 'u-1',
  member_limit: null,
  custom_data: {},
  settings: {},
  last_message_at: null,
  last_sequence: 0,
  inserted_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

describe('ConversationsResource', () => {
  it('list → GET /v1/conversations', async () => {
    const fetchFn = scriptedFetch([jsonResponse({ data: [baseConv] })]);
    const chat = buildPoolse(fetchFn);

    const result = await chat.conversations.list();

    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.id).toBe('c-1');
    expect(fetchFn.calls[0]?.url).toBe('https://chat.test/v1/conversations');
    expect(fetchFn.calls[0]?.method).toBe('GET');
  });

  it('create → POST /v1/conversations with the full create-request shape', async () => {
    const fetchFn = scriptedFetch([jsonResponse(baseConv, { status: 201 })]);
    const chat = buildPoolse(fetchFn);

    await chat.conversations.create({
      type: 'group',
      name: 'general',
      avatar_url: 'https://cdn.test/avatar.png',
      member_limit: 50,
      member_external_ids: ['alice', 'bob'],
      custom_data: { topic: 'engineering' },
      settings: { mute: false },
    });

    expect(fetchFn.calls[0]?.url).toBe('https://chat.test/v1/conversations');
    expect(fetchFn.calls[0]?.method).toBe('POST');
    expect(await bodyJson(fetchFn.calls[0]!)).toEqual({
      type: 'group',
      name: 'general',
      avatar_url: 'https://cdn.test/avatar.png',
      member_limit: 50,
      member_external_ids: ['alice', 'bob'],
      custom_data: { topic: 'engineering' },
      settings: { mute: false },
    });
  });
});

describe('ConversationHandle', () => {
  it('show → GET /v1/conversations/:id', async () => {
    const fetchFn = scriptedFetch([jsonResponse(baseConv)]);
    const chat = buildPoolse(fetchFn);

    await chat.conversations.one('c-1').show();

    expect(fetchFn.calls[0]?.url).toBe('https://chat.test/v1/conversations/c-1');
    expect(fetchFn.calls[0]?.method).toBe('GET');
  });

  it('update → PATCH /v1/conversations/:id with the update payload', async () => {
    const fetchFn = scriptedFetch([jsonResponse({ ...baseConv, name: 'renamed' })]);
    const chat = buildPoolse(fetchFn);

    await chat.conversations.one('c-1').update({ name: 'renamed', settings: { mute: true } });

    expect(fetchFn.calls[0]?.method).toBe('PATCH');
    expect(await bodyJson(fetchFn.calls[0]!)).toEqual({
      name: 'renamed',
      settings: { mute: true },
    });
  });

  it('listMembers → GET /v1/conversations/:id/members', async () => {
    const fetchFn = scriptedFetch([jsonResponse({ data: [] })]);
    const chat = buildPoolse(fetchFn);

    await chat.conversations.one('c-1').listMembers();

    expect(fetchFn.calls[0]?.url).toBe('https://chat.test/v1/conversations/c-1/members');
    expect(fetchFn.calls[0]?.method).toBe('GET');
  });

  describe('addMembers / addMember', () => {
    const membershipRow = (uid: string) => ({
      id: `m-${uid}`,
      conversation_id: 'c-1',
      user_id: uid,
      role: 'member' as const,
      last_read_message_id: null,
      last_read_at: null,
      inserted_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    });

    it('addMembers POSTs {external_ids: [...], role} — NOT the old {user_id, role} shape', async () => {
      const fetchFn = scriptedFetch([
        jsonResponse({ data: [membershipRow('u-1'), membershipRow('u-2')] }, { status: 201 }),
      ]);
      const chat = buildPoolse(fetchFn);

      await chat.conversations.one('c-1').addMembers(['alice', 'bob'], { role: 'admin' });

      expect(fetchFn.calls[0]?.method).toBe('POST');
      expect(fetchFn.calls[0]?.url).toBe('https://chat.test/v1/conversations/c-1/members');
      expect(await bodyJson(fetchFn.calls[0]!)).toEqual({
        external_ids: ['alice', 'bob'],
        role: 'admin',
      });
    });

    it('addMembers omits role when not provided (server default applies)', async () => {
      const fetchFn = scriptedFetch([
        jsonResponse({ data: [membershipRow('u-1')] }, { status: 201 }),
      ]);
      const chat = buildPoolse(fetchFn);

      await chat.conversations.one('c-1').addMembers(['alice']);

      expect(await bodyJson(fetchFn.calls[0]!)).toEqual({ external_ids: ['alice'] });
    });

    it('addMember (singular) wraps addMembers and unwraps to the single row', async () => {
      const fetchFn = scriptedFetch([
        jsonResponse({ data: [membershipRow('u-1')] }, { status: 201 }),
      ]);
      const chat = buildPoolse(fetchFn);

      const m = await chat.conversations.one('c-1').addMember('alice');

      expect(m.user_id).toBe('u-1');
      expect(await bodyJson(fetchFn.calls[0]!)).toEqual({ external_ids: ['alice'] });
    });

    it('addMember throws if the server returns an empty data array (contract violation)', async () => {
      const fetchFn = scriptedFetch([jsonResponse({ data: [] }, { status: 201 })]);
      const chat = buildPoolse(fetchFn);

      await expect(chat.conversations.one('c-1').addMember('alice')).rejects.toThrow(
        /no membership row/i,
      );
    });
  });

  it('removeMember → DELETE /v1/conversations/:id/members/:userId', async () => {
    const fetchFn = scriptedFetch([noContent()]);
    const chat = buildPoolse(fetchFn);

    await chat.conversations.one('c-1').removeMember('u-2');

    expect(fetchFn.calls[0]?.method).toBe('DELETE');
    expect(fetchFn.calls[0]?.url).toBe('https://chat.test/v1/conversations/c-1/members/u-2');
  });
});
