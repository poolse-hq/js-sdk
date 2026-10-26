# Migrating to 2.0

`@poolse/sdk@2.0.0`, `@poolse/react@2.0.0`, `@poolse/react-ui@2.0.0`
ship together. Upgrade all three.

```bash
npm install @poolse/sdk@2 @poolse/react@2 @poolse/react-ui@2
```

## The whole story in one paragraph

The SDK no longer surfaces poolse-internal user uuids in any identity-
shaped API. Everywhere you used to deal with a `user_id`, you now deal
with the tenant's own `external_id` — the same string you pass when
you mint JWTs and add members to conversations. If you were storing
a `poolse_user_id` column in your DB to satisfy `userResolver`, you
can drop it: the resolver now receives YOUR id.

The wire format adds `sender_external_id` to every message, `external_id`
to every membership, and includes it on typing + presence + member
events. The backend lazy-provisions users referenced by an unknown
`external_id` on conversation create / add-member, so you also no
longer need to `POST /v1/users` ahead of time.

## Changes by surface

### `userResolver` (config)

```diff
- userResolver: async (userId) => {
-   const u = await db.users.findOne({ poolse_user_id: userId });
+ userResolver: async (externalId) => {
+   const u = await db.users.findOne({ id: externalId });
    if (!u) return null;
    return { displayName: u.full_name, avatarUrl: u.avatar_url };
  }
```

Behavior unchanged: cached, deduped, errors cache as null. Only the
argument's meaning changed — it's your id now.

### `useUser` (hook)

```diff
- const { profile } = useUser(message.sender_id);
+ const { profile } = useUser(message.sender_external_id);
```

### `useTyping` / `usePresence`

```diff
- const { typing } = useTyping(conversationId);   // Set<uuid>
+ const { typing } = useTyping(conversationId);   // Set<external_id>

- const { online } = usePresence(conversationId); // Set<uuid>
+ const { online } = usePresence(conversationId); // Set<external_id>
```

If you were doing `typing.has(member.user_id)`, switch to
`typing.has(member.external_id)`. Both are present on `Membership`
now, but external_id is the load-bearing one.

### `useMembers().removeMember`

```diff
- await removeMember(member.user_id);
+ await removeMember(member.external_id);
```

The SDK translates external_id → internal user_id under the hood and
hits the same `DELETE /v1/conversations/:id/members/:user_id` endpoint.

### `<MemberList>`

```diff
  <MemberList
    conversationId={id}
-   labelFor={(uuid) => directory[uuid]?.name ?? uuid.slice(0, 6)}
-   avatarFor={(uuid) => directory[uuid]?.avatar ?? null}
-   onlineUserIds={typingSet}
+   labelFor={(ext) => directory[ext]?.name ?? ext}
+   avatarFor={(ext) => directory[ext]?.avatar ?? null}
+   onlineExternalIds={typingSet}
  />
```

### `<TypingIndicator>` / `<MessageBubble>` / `<MessageComposer>` / `<MentionInput>` / `<ConversationView>`

Every `labelFor` prop on these components is now
`(externalId: string) => string`. If you were already passing a
function that took a string, the signature is compatible — but the
argument's meaning changed (it's now external_id, not uuid). Adjust
the function body accordingly.

### `<UserName>` / `useDisplayName`

```diff
- <UserName userId={message.sender_id} />
+ <UserName externalId={message.sender_external_id} />

- const name = useDisplayName(message.sender_id);
+ const name = useDisplayName(message.sender_external_id);
```

### Lazy provisioning (no code change — just take advantage of it)

You can now reference any `external_id` in `POST /v1/conversations`
(`member_external_ids`) or `POST /v1/conversations/:id/members`
(`external_ids`) — the user gets created automatically if it doesn't
exist. If you have a "provision user at signup" step calling
`POST /v1/users`, you can keep it (it's still idempotent) or remove
it.

Abuse cap: 50 lazy-provisioned users per hour per JWT. Exceeding
returns `429 lazy_provision_rate_limited`.

## Things that did NOT change

- `Message.sender_id` is still on the wire (the internal uuid). You
  just don't need it. `Message.sender_external_id` is the one you'll
  use day-to-day.
- `Membership.user_id` is still on the wire too.
- `MessageCreateRequest.mentions: Uuid[]` is still uuid-keyed
  (backend storage hasn't changed there). The mention picker handles
  the translation internally.
- The REST and WebSocket endpoints. No URL changes.
- Auth model. API key on the backend, JWT on the browser.
- Retry behavior, idempotency, the typed error hierarchy.

## Backwards compatibility

None — this is a breaking change on purpose. If you can't upgrade
all three packages at once, stay on 1.x; 1.x has long-tail security
support and matches the pre-lazy-provision backend behavior.
