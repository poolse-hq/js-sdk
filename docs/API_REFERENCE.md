# poolse SDK — API reference

Generated from the sources with [TypeDoc](https://typedoc.org): every
exported class, function, hook, component and type of the seven packages,
with the doc comments written next to the code.

```bash
pnpm install
pnpm build
pnpm docs:api        # → docs/api/index.html
```

Publish `docs/api/` as static files (any web server, or the poolse server's
docs site). It isn't committed: it is rebuilt from the code of the release.

| Package                | Start with                                                                                                                             |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `@poolse/sdk`          | `Poolse` (the client), `chat.conversations`, `chat.messages`, `chat.scheduledMessages`, `chat.attachments`, `chat.realtime`            |
| `@poolse/react`        | `PoolseProvider`, `useMessages`, `useThread`, `usePoll`, `usePins`, `useCatchUp`, `useTranslation`, `useScheduledMessages`, `useFiles` |
| `@poolse/react-ui`     | `PoolseInbox`, `ConversationView`, `MessageComposer`, `PollCard`, `BlockRenderer`, `VoiceRecorder`, `FilesList`                        |
| `@poolse/react-native` | the same components for React Native                                                                                                   |
| `@poolse/crypto`       | `DeviceKeys`, `AccountKey`, `sealNote`, `shareWrapsFor`, `NoteSearchIndex`, `NoteOutbox`                                               |
| `@poolse/theme`        | `BUILT_IN_THEMES`, `createTheme`, `themeFromBrand`                                                                                     |

Guides: [EMBEDDING.md](../EMBEDDING.md) (Workspace chat and calls in your own
product), [examples/](../examples/README.md), [QUICKSTART.md](../QUICKSTART.md),
[INTEGRATION.md](../INTEGRATION.md). The Workspace's own HTTP API (apps, bots,
slash commands) is described by its OpenAPI document at
`GET /workspace/v1/openapi.json`.
