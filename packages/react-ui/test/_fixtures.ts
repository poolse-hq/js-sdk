// Wire fixtures shared by the launch-feature tests: the viewer, a
// message, a membership, a conversation, and the routes a mounted
// ConversationView asks for.

import { jsonResponse, noContent } from './_helpers.js';

export const me = {
  id: 'u-me',
  tenant_id: 't-1',
  external_id: 'me',
  display_name: 'Me',
  custom_data: {},
  is_blocked: false,
  inserted_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

export const at = (min: number) => new Date(Date.UTC(2026, 0, 1, 10, min)).toISOString();

export function msg(seq: number, sender: 'u-me' | 'u-2' = 'u-2', extra: object = {}) {
  return {
    id: `m${seq}`,
    tenant_id: 't-1',
    conversation_id: 'c-1',
    sender_id: sender,
    sender_external_id: sender === 'u-me' ? 'me' : 'two',
    type: 'text',
    body: `message ${seq}`,
    reply_to_id: null,
    thread_root_id: null,
    mentions: [],
    reactions: {},
    edited_at: null,
    deleted_at: null,
    sequence: seq,
    inserted_at: at(seq),
    updated_at: at(seq),
    ...extra,
  };
}

export function member(
  uid: string,
  ext: string,
  lastRead: { id: string; seq: number } | null = null,
) {
  return {
    id: `mem-${ext}`,
    conversation_id: 'c-1',
    user_id: uid,
    external_id: ext,
    role: 'member',
    last_read_message_id: lastRead?.id ?? null,
    last_read_sequence: lastRead?.seq ?? null,
    last_read_at: null,
    inserted_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

export function conversation(id: string, extra: object = {}) {
  return {
    id,
    tenant_id: 't-1',
    type: 'group',
    name: `Channel ${id}`,
    avatar_url: null,
    created_by_user_id: 'u-me',
    member_limit: null,
    custom_data: {},
    settings: {},
    last_message_at: null,
    last_message_preview: null,
    last_sequence: 0,
    inserted_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...extra,
  };
}

/** Newest first, as the wire sends a page. */
export const wirePage = (list: object[]) => [...list].reverse();

export function errorResponse(status: number, code: string): Response {
  return jsonResponse(
    { error: { code, message: code, doc_url: 'https://poolse.dev/errors' } },
    { status },
  );
}

/** Routes for a ConversationView on c-1; override or add any. */
export function viewRoutes(
  messages: object[],
  extra: Record<string, (req: Request) => Response> = {},
  members: object[] = [],
): Record<string, (req: Request) => Response> {
  return {
    'GET /v1/me': () => jsonResponse(me),
    'GET /v1/conversations/c-1/messages': () => jsonResponse({ data: wirePage(messages) }),
    'GET /v1/conversations/c-1/members': () => jsonResponse({ data: members }),
    'POST /v1/conversations/c-1/read': () => noContent(),
    'GET /v1/presence': () => jsonResponse({ data: [] }),
    ...extra,
  };
}

/**
 * The hosts' names for the fixture users. An external id is never shown
 * as a name, so a test that reads a name passes this as `labelFor`.
 */
const NAMES: Record<string, string> = { me: 'Me', two: 'Two', scout: 'Scout', ana: 'Ana' };
export const names = (externalId: string): string => NAMES[externalId] ?? '';
