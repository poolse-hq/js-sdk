# @poolse/react-native-calls

The React Native bridge over poolse's native call core — the Kotlin
(`dev.poolse:call-core`) and, later, Swift engines that ring, answer and
carry audio with the app killed and the phone locked.

This package is thin on purpose: commands go in, one `Snapshot` event
comes out, and every call decision lives in the native core (behaviour
pinned by `contracts/call-core/vectors.json`). On a build without the
native module it degrades to safe no-ops with an idle state, so a host
can render against it unconditionally.

```ts
import * as calls from '@poolse/react-native-calls';

await calls.configure('https://api.poolse.dev', { smallIcon: 'ic_call', ringback: 'ringback' });
const stop = calls.onCallState((s) => render(s)); // s: Snapshot | null
await calls.place(conversationId, { media: 'audio', sessionToken });
calls.answer();
calls.decline();
calls.hangUp();

// Audio output: s.audioOutputs lists the phone, the speaker and every
// connected headset/Bluetooth device by name; s.audioOutputId is the live one.
calls.setAudioOutput(s.audioOutputs[0].id);
calls.setSpeaker(true); // the one-tap toggle, still there
```

### Chat notifications

poolse sends message notifications itself, with the push credentials you
set up for calls. Register the devices (Android: the FCM token; iOS: the
regular APNs token with `kind: 'alert'`, beside the VoIP one), and the
core does the rest — one notification per conversation with every
message a line in it, Reply and Mark as read straight from the
notification (no app, no session), cleared when the chat is read on
another device. Requires `expo-notifications` (a peer dependency).

```ts
calls.setActiveConversation(conversationId); // on screen: don't notify it
calls.setActiveConversation(null); // left it, or app backgrounded

// iOS, in your expo-notifications handler:
Notifications.setNotificationHandler({
  handleNotification: async (n) => {
    const show = calls.shouldPresentMessage(n.request.content.data);
    return {
      shouldShowBanner: show,
      shouldShowList: show,
      shouldPlaySound: show,
      shouldSetBadge: true,
    };
  },
});
// A tap opens the app: calls.conversationOfNotification(data) (iOS), or
// takeCallAction()/onCallAction() with type 'open' (Android).
```

## Layout

- `src/` — the TypeScript API (this is what apps import).
- `android/src/main/java/dev/poolse/callcore/` — the pure state machine
  and ports (contract cv 1).
- `android/src/main/java/dev/poolse/callcore/android/` — the Android
  adapters (HTTP, timers, ring surface, foreground service, FCM intake,
  composition root).
- `android/src/main/java/expo/modules/poolsecalls/` — the Expo bridge
  module (compiled by the app's autolinking).
- `android/src/main/livekit/` — the shipped LiveKit `MediaPort`, opt-in
  via the `poolse.livekit` gradle property; the core is SFU-agnostic.

Stage 3 adds the Swift core under `ios/`.
