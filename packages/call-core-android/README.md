# call-core (Android) — Stage 2

The pure Kotlin half of `dev.poolse:call-core`: the contract's state
machine (`CallMachine`) and the ports its adapters implement. No
Android, React Native, or network imports — the conformance vectors
run as plain JVM tests.

```
# from poolse-native/android (borrows its gradle wrapper):
JAVA_HOME=/opt/homebrew/opt/openjdk@17 \
  ./gradlew -p ../../poolse-js-sdk/packages/call-core-android test
```

The vectors (`contracts/call-core/vectors.json`) are a tracked input
of the test task: editing the contract re-runs the suite.

Layering (see contracts/call-core/CONTRACT.md and the plan artifact):

- `CallMachine` — events in, (state, effects) out. Never does I/O,
  never counts participants: lifecycle authority is the server's.
- `Ports.kt` — the seams: HttpPort (three token doors), MediaPort
  (LiveKit), RingSurfacePort (CallStyle + full-screen activity),
  CallSessionPort (foreground service), SnapshotSink (bridge events).

Next increments: the runtime that executes effects through the ports,
the Android adapters (moving the ring surface out of the Loop app's
local module), the FirebaseMessagingService intake, and the
`@poolse/react-native-calls` bridge. Maven extraction happens in
Stage 5.
