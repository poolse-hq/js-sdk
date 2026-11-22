# Examples

Small, complete programs against the public APIs. Each file says what it
needs (a user token, a bot token, which packages).

| File                                             | Shows                                                                                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| [`bot-blocks.ts`](./bot-blocks.ts)               | A Workspace app's bot posts an interactive message (buttons, a menu, a form) through the public API, then answers the action by editing it. |
| [`slash-command.ts`](./slash-command.ts)         | An app's slash command endpoint: verify the signature, answer in the channel or only to the member.                                         |
| [`schedule-and-poll.ts`](./schedule-and-poll.ts) | `@poolse/sdk` as a member: schedule a message, start a poll, vote, pin, translate, catch up.                                                |
| [`chat-panel.tsx`](./chat-panel.tsx)             | A web chat panel with the composer toolbar, slash commands, polls, voice messages and the files list.                                       |
| [`encrypted-note.ts`](./encrypted-note.ts)       | `@poolse/crypto`: a personal note sealed on the device, shared, rotated on revoke, searched on the device.                                  |
