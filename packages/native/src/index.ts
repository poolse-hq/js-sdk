// @poolse/native — the React Native face of the native
// call core (CALL_CONTRACT.md §8). A thin, typed surface over the native
// module: commands in, one snapshot event out. All call logic lives in
// the native cores; nothing here decides anything about a call.
//
// On a platform or build without the native module (Expo Go, web,
// unlinked), every command is a safe no-op and the state stays idle —
// so a host can render against this unconditionally.
import { createElement, type ComponentType, type ReactElement } from 'react';
import { View, type ViewProps } from 'react-native';
import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';

/**
 * A call's complete state. `null` means idle — no call. After a call
 * ends the snapshot stays `phase: 'ended'` (with `reason`) for ~2.5 s,
 * then becomes `null`.
 */
export interface Snapshot {
  cv: 1;
  callId: string;
  conversationId: string;
  conversationName: string | null;
  direction: 'incoming' | 'outgoing' | 'joined';
  /**
   * `room` — rings nobody, joined and left at will (`startRoom`); `call`
   * otherwise. Known once the server answered: a room being joined reads
   * `call` while `connecting`. Absent before 0.9.0: treat as `call`.
   */
  kind?: 'call' | 'room';
  media: 'audio' | 'video';
  phase: 'ringing_in' | 'ringing_out' | 'connecting' | 'active' | 'reconnecting' | 'ended';
  reason?:
    | 'left'
    | 'finished'
    | 'declined_all'
    | 'busy_all'
    | 'no_answer'
    | 'cancelled'
    | 'connection_lost'
    | 'failed'
    /**
     * You took this call on another of your devices (`moveCallHere`
     * there): it goes on without this one. Say "Moved to your other
     * device", not "Call ended". Absent before 3.10.
     */
    | 'moved';
  /**
   * REMOTE people only; `userId` is the LiveKit identity. poolse's
   * transcript assistant (`poolse:…`, kind agent) and the recorder
   * (LiveKit Egress, `EG_…`) are never listed — nor counted when the core
   * ends a call left alone. Phone (SIP) participants are listed.
   */
  participants: Array<{
    userId: string;
    externalId: string;
    speaking: boolean;
    muted: boolean;
    /** True only with a published, subscribed, unmuted camera track (show video, not avatar). */
    cameraOn: boolean;
    /**
     * Sharing their screen: draw it with `<CallVideoView source="screen">`,
     * large and with `fit="contain"`. Absent before 3.2.
     */
    screenSharing?: boolean;
    /**
     * Their link to the call: `lost` while they have dropped and are
     * coming back (show "Reconnecting…"), `poor` for a weak signal.
     * Absent before 0.11.0.
     */
    connectionQuality?: ConnectionQuality;
  }>;
  /** The kind of output playing now — the short answer to "where is the audio". */
  audioRoute: AudioOutputKind;
  /**
   * Every output the call can play through right now: always the phone
   * (earpiece, or wired headphones in its place) and the speaker, plus
   * each connected Bluetooth / USB device by its own name. Empty until
   * the call's audio is up. Pass an `id` to `setAudioOutput`.
   */
  audioOutputs: AudioOutput[];
  /** The `audioOutputs` entry playing now; null before audio is up. */
  audioOutputId: string | null;
  mutedSelf: boolean;
  /** True only while the local camera track is actually published and enabled. */
  cameraOn: boolean;
  /**
   * A second call ringing while this one is in progress (call waiting).
   * Offer `answerWaiting` ("End & answer" — this call ends) and
   * `declineWaiting` (its caller hears busy). If this call ends first,
   * the waiting one simply becomes the ringing call. null when none;
   * absent before 0.10.0.
   */
  waiting?: WaitingCall | null;
  /** Facing of the published local camera; absent when the camera is off. */
  cameraFacing?: 'front' | 'back';
  /**
   * Your own link to the call. `poor` / `lost`: show a "weak connection"
   * hint; `phase: 'reconnecting'` is the hard version of the same thing.
   * Absent before 0.11.0.
   */
  connectionQuality?: ConnectionQuality;
  /**
   * Incoming video is switched off because your connection could not
   * carry it — the audio keeps going, and video comes back by itself
   * once the link has been good for a few seconds. Participants read
   * `cameraOn: false` meanwhile. Absent before 0.11.0.
   */
  videoPaused?: boolean;
  /** You are sharing your screen. Absent before 3.2. */
  screenSharing?: boolean;
  /**
   * The server (workspace) this call runs on — the `id` given to
   * `addServer`, or `DEFAULT_SERVER_ID` for the one `configure` set.
   * Absent before 3.8.
   */
  serverId?: string | null;
  /**
   * That workspace's name: the ring push's `workspace_name`, else the
   * server's `name`. Absent before 3.8.
   */
  workspaceName?: string | null;
  /**
   * Whether the server lets you publish. `false` while recording consent
   * is required and you have not accepted (docs/RECORDING.md §5): you
   * still hear and see the call, but nothing of yours goes out. Your
   * `mutedSelf` / camera choices are kept and come back as they were once
   * it turns `true` again (the core republishes by itself; call
   * `republish()` from ConsentPrompt's `onAccepted` too). Absent before 3.9.
   */
  canPublish?: boolean;
  /**
   * The call's recording state as the server last told this core (on
   * answer / join / place and each reconnect) — enough to show the
   * indicator at once. Live changes arrive on the conversation socket
   * (`recording:*`). null: not known (a server without recording).
   * Absent before 3.9.
   */
  recording?: CallRecordingState | null;
  /** The live transcript's state, the same way (`transcript:*` on the socket). Absent before 3.9. */
  transcription?: CallTranscriptionState | null;
  /**
   * `meeting`: a scheduled meeting rang this device as it started (the
   * push's `ring_type`), so the ring reads "Weekly sync is starting" and
   * the call screen should name the meeting. `call` otherwise. Absent
   * before 3.10.
   */
  ringType?: 'call' | 'meeting';
  /** The meeting's title for a `meeting` ring; null otherwise. Absent before 3.10. */
  meetingTitle?: string | null;
  /** Noise suppression on the microphone (on by default; `setNoiseSuppression`). Absent before 3.10. */
  noiseSuppression?: boolean;
  /** Background blur on the camera (`setBackgroundBlur`). Absent before 3.10. */
  backgroundBlur?: boolean;
  /**
   * This call was taken over by your other device (`moveCallHere`
   * there); the end that follows has `reason: 'moved'`. Absent before 3.10.
   */
  movedElsewhere?: boolean;
}

/** The CallSummary's `recording` object, as the server sent it (docs/CALL_CONTRACT.md §4.2). */
export interface CallRecordingState {
  /** This server can record (LiveKit Egress). */
  available: boolean;
  active: boolean;
  id: string | null;
  mode: 'video' | 'audio' | null;
  started_at: string | null;
  started_by_user_id: string | null;
  auto: boolean;
  /** You may not publish until you accept. */
  consent_required: boolean;
  /** poolse user ids. */
  consent?: { accepted: string[]; declined: string[] };
}

/** The CallSummary's `transcription` object, as the server sent it. */
export interface CallTranscriptionState {
  available: boolean;
  active: boolean;
  id: string | null;
  status: 'live' | 'stopped' | 'ready' | null;
  language: string | null;
}

/** `good` covers good and excellent; `unknown` until the SFU has measured. */
export type ConnectionQuality = 'good' | 'poor' | 'lost' | 'unknown';

export type AudioOutputKind = 'earpiece' | 'speaker' | 'bluetooth' | 'headset';

/** The call waiting beside the current one. */
export interface WaitingCall {
  callId: string;
  conversationId: string | null;
  conversationName: string | null;
  callerName: string | null;
  media: 'audio' | 'video';
  /** The server (workspace) it rings from — may differ from the current call's. Absent before 3.8. */
  serverId?: string | null;
  /** That workspace's name ("Ana · Acme"). Absent before 3.8. */
  workspaceName?: string | null;
  /** `meeting` when a scheduled meeting is starting rather than a person calling. Absent before 3.10. */
  ringType?: 'call' | 'meeting';
  /** The meeting's title for a `meeting` ring. Absent before 3.10. */
  meetingTitle?: string | null;
}

/** One place call audio can play. */
export interface AudioOutput {
  /** Opaque; stable while the device stays connected. */
  id: string;
  kind: AudioOutputKind;
  /**
   * The device's own name for Bluetooth/USB ("AirPods Pro"); a plain
   * English default for built-ins ("iPhone"/"Phone", "Speaker",
   * "Headphones") — relabel those by `kind` to localise.
   */
  name: string;
}

export interface ConfigureOptions {
  /** Drawable resource NAME for the call notification's small icon. */
  smallIcon?: string;
  /** Ringback tone: raw resource NAME (Android); main-bundle sound name, mp3/caf/wav (iOS). */
  ringback?: string;
  /**
   * Incoming ringtone, overriding the config plugin's `ringtone` (leave it
   * out to use the plugin's, or the system ringtone without one).
   * Android: raw resource NAME (`ring` for `res/raw/ring.ogg`), played by
   * the module. iOS: a main-bundle sound CallKit plays — `ring.caf`, or the
   * base name looked up as caf/aiff/aif/wav; 30 s or shorter. Persisted, so
   * a ring that wakes a closed app uses it too. A name that is not in the
   * app rings with the system ringtone.
   */
  ringtone?: string;
  /**
   * Android: the full-screen incoming-call screen. Each field overrides the
   * config plugin's `incomingCall` option; leave one out to keep the
   * plugin's (or the built-in) value. Persisted for closed-app rings.
   * Ignored on iOS, where CallKit draws the call screen.
   */
  incomingCall?: IncomingCallOptions;
  /**
   * iOS: the APNs environment of this build's `aps-environment`
   * entitlement. Echoed back with the VoIP token so the server pushes to
   * the right gateway. Ignored on Android.
   */
  apnsEnvironment?: 'production' | 'sandbox';
}

/** Android's full-screen incoming call: its look, or the app's own activity instead. */
export interface IncomingCallOptions {
  /** `#RRGGBB` / `#AARRGGBB`: the glow, the pulsing ring and the initials disc (and the notification tint). */
  accentColor?: string;
  /** `#RRGGBB`: the screen's ground. A light one switches the text to dark. Default `#0B0B14`. */
  backgroundColor?: string;
  /**
   * The caller's picture, as a URL template: `{externalId}` (your app's id
   * for the caller) and `{userId}` (the poolse user id) are filled in,
   * URL-encoded — e.g. `https://cdn.example.com/avatars/{externalId}.jpg`.
   * Loaded off the main thread; the initials show until it loads, or if it
   * fails. A ring push's own `caller_avatar_url` wins over the template.
   */
  avatarUrl?: string;
  /**
   * Fully qualified class name of your own Activity (declared in your
   * manifest) to launch instead of the built-in screen. It receives the
   * `PoolseIncomingCall.EXTRA_*` extras and answers / declines through
   * `dev.poolse.callcore.android.PoolseIncomingCall` (see the README).
   * A leading `.` is relative to the application id.
   */
  activity?: string;
}

/** The iOS PushKit (VoIP) token and the APNs environment it belongs to. */
export interface VoipToken {
  /** Hex-encoded PushKit token. */
  token: string;
  environment: 'production' | 'sandbox' | string;
}

export interface PlaceOptions {
  media: 'audio' | 'video';
  /** The user's session token — authorizes placing/joining (CALL_CONTRACT.md §3.2). */
  sessionToken: string;
  /**
   * The server (workspace) the session token belongs to — an `addServer`
   * id. Leave it out for the default server (`configure`'s).
   */
  serverId?: string;
}

/** The server `configure(apiBaseUrl)` sets; what everything defaults to. */
export const DEFAULT_SERVER_ID = 'default';

/**
 * One server (workspace) the app is signed in to. No secrets: rings
 * carry their own grant, and place / join take the session token.
 */
export interface CallServer {
  /**
   * Your id for it, 1–64 of `A–Z a–z 0–9 . _ : -` — what `serverId`
   * says everywhere (snapshots, notification taps and actions).
   */
  id: string;
  /** Its API origin, as for `configure`. */
  apiBaseUrl: string;
  /**
   * The poolse tenant this sign-in belongs to (`tenant_id` of `me` or of
   * the registered device). Pushes carry it: it is how a ring or a
   * notification finds its server. Needed as soon as two servers are
   * added; without it a push goes to the default server.
   */
  tenantId?: string;
  /** The workspace's name — shown when a push carries none ("Ana · Acme"). */
  name?: string;
}

/**
 * What the user tapped on a missed-call notification: the notification
 * itself (`open` the conversation) or its Call back button (`call_back`
 * — place a call on the conversation with `media`).
 */
export interface CallAction {
  type: 'open' | 'call_back';
  conversationId: string;
  callId: string | null;
  media: 'audio' | 'video';
  /** The server (workspace) it belongs to — open that one. Absent before 3.8. */
  serverId?: string | null;
}

/**
 * A Reply or Mark as read the user did from a chat notification, after
 * the native core sent it (or gave up). The server has already posted
 * the reply and marked the conversation read; use this to refresh what
 * the app shows (insert the message, drop the unread count) without
 * waiting for the socket, or to tell the user a reply did not go out.
 */
export interface NotificationActionResult {
  action: 'reply' | 'mark_read';
  conversationId: string;
  /** The server (workspace) the conversation is on. Absent before 3.8. */
  serverId?: string;
  /** Whether the server accepted it. */
  ok: boolean;
  /** Reply only: what the user typed. */
  text?: string;
  /** Reply only: the idempotency id sent with it — the message's id once posted. */
  clientId?: string;
  /** Reply, `ok` only: the posted message's id (equals `clientId`). */
  messageId?: string;
  /**
   * When not `ok`: the server's error code (`unauthorized`,
   * `device_signed_out`, `user_blocked`, `forbidden`, `not_found`,
   * `mau_cap_exceeded`, `validation_failed`, `rate_limited`), or
   * `network`, `no_grant` (the push carried no reply grant),
   * `not_configured` (never `configure`d), `http_<status>`.
   */
  error?: string;
  /** The HTTP status when the server answered with an error. */
  status?: number;
  /** When it finished, epoch ms. */
  at: number;
}

type NativeSnapshot = { snapshot: Snapshot | null };

interface PoolseCallsNative {
  configure(apiBaseUrl: string, options: ConfigureOptions | null): Promise<void>;
  addServer?(server: CallServer): Promise<void>;
  removeServer?(id: string): Promise<void>;
  listServers?(): CallServer[];
  serverForTenant?(tenantId: string | null): string | null;
  getCallState(): NativeSnapshot;
  place(
    conversationId: string,
    media: string,
    sessionToken: string,
    serverId: string | null,
  ): Promise<void>;
  join(
    callId: string,
    conversationId: string | null,
    sessionToken: string,
    serverId: string | null,
  ): Promise<void>;
  answer(): void;
  decline(): void;
  hangUp(): void;
  answerWaiting?(callId: string | null): void;
  declineWaiting?(callId: string | null): void;
  setMuted(muted: boolean): void;
  setCamera(on: boolean): void;
  switchCamera(): void;
  screenShareSupported?(): boolean;
  startScreenShare?(): Promise<boolean>;
  stopScreenShare?(): void;
  setSpeaker(on: boolean): void;
  noiseSuppressionSupported?(): boolean;
  setNoiseSuppression?(on: boolean): boolean;
  backgroundBlurSupported?(): boolean;
  setBackgroundBlur?(on: boolean): boolean;
  setAudioOutput?(id: string): void;
  republish?(): void;
  callControl?(): Promise<{
    callId: string;
    controlToken: string;
    serverId?: string | null;
    apiBaseUrl?: string | null;
  } | null>;
  setPictureInPictureEnabled?(on: boolean): void;
  isInPictureInPicture?(): boolean;
  pictureInPictureSupported?(): boolean;
  onRingEnded(callId: string, reason: string): void;
  onCallFinished(callId: string, reason: string | null): void;
  canUseFullScreenIntent(): boolean;
  openFullScreenIntentSettings(): void;
  setShowOnLockscreen?(enabled: boolean): void;
  getVoipToken?(): VoipToken | null;
  takeCallAction?(): CallAction | null;
  setActiveConversation?(conversationId: string | null, serverId: string | null): void;
  takeNotificationActions?(): NotificationActionResult[];
  observeNotificationActions?(on: boolean): void;
  addListener(event: 'onCallState', cb: (payload: NativeSnapshot) => void): { remove(): void };
  addListener(event: 'onVoipToken', cb: (payload: VoipToken) => void): { remove(): void };
  addListener(event: 'onCallAction', cb: (payload: CallAction) => void): { remove(): void };
  addListener(
    event: 'onNotificationAction',
    cb: (payload: NotificationActionResult) => void,
  ): { remove(): void };
  addListener(
    event: 'onPictureInPicture',
    cb: (payload: { active: boolean }) => void,
  ): { remove(): void };
}

const native = requireOptionalNativeModule<PoolseCallsNative>('PoolseCalls');

/** True when the native call core is present in this build. */
export const nativeCallsAvailable = native != null;

// Kept for startRoom, the one command that talks to the server from JS.
let apiOrigin: string | null = null;

/**
 * Configure once, before any call can arrive. No secrets — just the API
 * origin, which becomes the default server (`DEFAULT_SERVER_ID`).
 *
 * `configure(options)` sets the options alone, for an app whose servers
 * all come from `addServer`.
 */
export async function configure(
  apiBaseUrlOrOptions: string | ConfigureOptions,
  options?: ConfigureOptions,
): Promise<void> {
  if (typeof apiBaseUrlOrOptions !== 'string') {
    await native?.configure('', apiBaseUrlOrOptions ?? null);
    return;
  }
  apiOrigin = apiBaseUrlOrOptions.replace(/\/+$/, '');
  await native?.configure(apiBaseUrlOrOptions, options ?? null);
}

// ── several servers (workspaces) ──────────────────────────────────────

const SERVER_ID = /^[A-Za-z0-9._:-]{1,64}$/;

/**
 * Sign the call core in to one more server (workspace) — or update one
 * (same `id`). Rings from it ring here, answered and declined on that
 * server; its chat notifications post (Android) and act (Reply, Mark as
 * read) against it. Persisted: a closed app woken by its push finds it.
 *
 * Register the device's push tokens with that server too (the SDK's
 * `devices.register`, per client): this only tells the core where it is.
 * Calls `configure` with default options first if it never ran.
 */
export async function addServer(server: CallServer): Promise<void> {
  if (!SERVER_ID.test(server.id))
    throw new Error(`addServer: invalid id ${JSON.stringify(server.id)}.`);
  if (!/^https?:\/\/[^\s]+$/.test(server.apiBaseUrl))
    throw new Error('addServer: apiBaseUrl must be http(s).');
  const entry: CallServer = { id: server.id, apiBaseUrl: server.apiBaseUrl.replace(/\/+$/, '') };
  if (server.tenantId) entry.tenantId = server.tenantId;
  if (server.name) entry.name = server.name;
  if (server.id === DEFAULT_SERVER_ID) apiOrigin = entry.apiBaseUrl;
  await native?.addServer?.(entry);
}

/**
 * Signed out of one server: the core forgets it and takes its
 * notifications down; the others are untouched. A call in progress on
 * it carries on to its end. Unregister its push tokens with that server
 * yourself (before signing out there).
 */
export async function removeServer(id: string): Promise<void> {
  if (id === DEFAULT_SERVER_ID) apiOrigin = null;
  await native?.removeServer?.(id);
}

/** The servers the core knows, in the order they were added (`configure`'s is `default`). */
export function listServers(): CallServer[] {
  return native?.listServers?.() ?? [];
}

/**
 * The server a notification (its data) belongs to, by its `tenant_id` —
 * the same rule the core routes rings and actions by. Use it on a tapped
 * iOS notification to open the right workspace. `null` with no server.
 */
export function serverOfNotification(
  data: Record<string, unknown> | undefined | null,
): string | null {
  const tenant = data && typeof data['tenant_id'] === 'string' ? data['tenant_id'] : null;
  if (native?.serverForTenant) return native.serverForTenant(tenant);
  return apiOrigin ? DEFAULT_SERVER_ID : null;
}

/** The API origin of `serverId` (the default server when absent). */
function originOf(serverId: string | null | undefined): string | null {
  if (!serverId || serverId === DEFAULT_SERVER_ID) {
    if (apiOrigin) return apiOrigin;
  }
  const id = serverId ?? DEFAULT_SERVER_ID;
  const server = listServers().find((s) => s.id === id);
  return server?.apiBaseUrl ?? null;
}

/** The current snapshot — safe to read at any moment, including cold answer and before configure. */
export function getCallState(): Snapshot | null {
  return native?.getCallState().snapshot ?? null;
}

export type Unsubscribe = () => void;

/** Subscribe to call state. Fires a full snapshot on every change. */
export function onCallState(cb: (snapshot: Snapshot | null) => void): Unsubscribe {
  if (!native) return () => undefined;
  const sub = native.addListener('onCallState', (payload) => cb(payload.snapshot));
  return () => sub.remove();
}

export function place(conversationId: string, options: PlaceOptions): Promise<void> {
  return (
    native?.place(conversationId, options.media, options.sessionToken, options.serverId ?? null) ??
    Promise.resolve()
  );
}

/** `serverId`: the server the session token is for — leave it out for the default one. */
export function join(
  callId: string,
  conversationId: string | null,
  sessionToken: string,
  serverId?: string,
): Promise<void> {
  return native?.join(callId, conversationId, sessionToken, serverId ?? null) ?? Promise.resolve();
}

/** What {@link moveCallHere} needs besides the call id. */
export interface MoveCallOptions {
  conversationId: string;
  /** The user's session token on the call's server. */
  sessionToken: string;
  /** The call's server (an `addServer` id); leave it out for the default one. */
  serverId?: string;
}

/**
 * "Move call to this device" (CL11): take a call you are on elsewhere
 * — your desktop, your other phone — over to this one without hanging
 * up. This device joins the same call; the server lets one device per
 * person carry it (CALL_CONTRACT.md §9), so the other one is let go and
 * its snapshot ends with `reason: 'moved'`. Offer it from the Join
 * banner when `liveCalls` says you are already in the call.
 *
 * The camera follows the call's media on this device; mute starts off.
 */
export function moveCallHere(callId: string, options: MoveCallOptions): Promise<void> {
  return join(callId, options.conversationId, options.sessionToken, options.serverId);
}

export interface StartRoomResult {
  /** The room's call id — what the Join banner and `call:*` events carry. */
  callId: string;
  /** False when something was live already (a room, or a ringing call) and this joined it. */
  created: boolean;
}

/**
 * Start the conversation's room — a call that rings nobody (CALL_CONTRACT.md
 * §5.6) — or join whatever is live there, then carry it on the native
 * core like any joined call: CallKit / the call service, so it keeps
 * going with the phone locked, and the same audio routing as a call.
 *
 * Others in the conversation see it through the Join banner and join it
 * with `join`. Leaving (`hangUp`) never ends it for them; it ends once
 * it has been empty for a short grace. `media: 'video'` makes it a video
 * room. Rejects when the server refuses (not a member, no SFU) or
 * before `configure`.
 */
export async function startRoom(
  conversationId: string,
  options: PlaceOptions,
): Promise<StartRoomResult> {
  if (!native) throw new Error('The native call core is not in this build.');
  const origin = originOf(options.serverId);
  if (!origin) throw new Error('Call configure() (or addServer) before startRoom().');
  const res = await fetch(`${origin}/v1/conversations/${encodeURIComponent(conversationId)}/room`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${options.sessionToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ media: options.media }),
  });
  const body = (await res.json().catch(() => null)) as {
    created?: boolean;
    call?: { id?: string };
    error?: { message?: string };
  } | null;
  const callId = body?.call?.id;
  if (!res.ok || !callId) {
    throw new Error(body?.error?.message ?? `Couldn't start the room (${res.status}).`);
  }
  // The core joins with its own request: it owns the session from here,
  // exactly as when the room is joined from the banner.
  await native.join(callId, conversationId, options.sessionToken, options.serverId ?? null);
  return { callId, created: body?.created === true };
}

/** Who to ring into the call — poolse user ids, your app's own (external) ids, or both. */
export interface RingIntoCallOptions {
  userIds?: string[];
  externalIds?: string[];
}

/**
 * Ring more of the conversation's members into the call you are on
 * ("Add people"). Each is rung as on a fresh call — their phone rings,
 * CallKit / full-screen — and answering puts them in this call.
 *
 * Resolves with the poolse user ids actually rung: anyone already in
 * the call, still ringing, or not a member of the conversation is
 * skipped. Rejects with no call in progress, while nobody has answered
 * yet (the call's own ring is still out), or when the server refuses.
 */
export async function ringIntoCall(people: RingIntoCallOptions): Promise<string[]> {
  if (!native?.callControl) throw new Error('This build cannot ring people into a call.');
  const control = await native.callControl();
  if (!control) throw new Error('There is no call in progress.');
  // The call's own server: it may be another workspace than the default.
  const origin = control.apiBaseUrl || originOf(control.serverId);
  if (!origin) throw new Error('Call configure() before ringIntoCall().');
  const res = await fetch(`${origin}/v1/calls/${encodeURIComponent(control.callId)}/ring`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${control.controlToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      user_ids: people.userIds ?? [],
      external_ids: people.externalIds ?? [],
    }),
  });
  const body = (await res.json().catch(() => null)) as {
    rung_user_ids?: string[];
    error?: { message?: string };
  } | null;
  if (!res.ok) throw new Error(body?.error?.message ?? `Couldn't ring them (${res.status}).`);
  return body?.rung_user_ids ?? [];
}

export const answer = (): void => native?.answer();
export const decline = (): void => native?.decline();
export const hangUp = (): void => native?.hangUp();

/**
 * Call waiting: end the current call and answer `snapshot.waiting`.
 * Pass its `callId`: a tap on a card for a call that is no longer the
 * one waiting is then ignored instead of answering a different call.
 */
export const answerWaiting = (callId?: string): void => native?.answerWaiting?.(callId ?? null);

/** Call waiting: turn `snapshot.waiting` away — its caller hears busy. */
export const declineWaiting = (callId?: string): void => native?.declineWaiting?.(callId ?? null);
export const setMuted = (muted: boolean): void => native?.setMuted(muted);
export const setCamera = (on: boolean): void => native?.setCamera(on);
export const switchCamera = (): void => native?.switchCamera();

/**
 * Whether this build can share the screen in a call: Android with the
 * LiveKit media engine; iOS when the app was built with the config
 * plugin's `screenShare` option (the broadcast extension). Every build
 * shows other people's screens.
 */
export const screenShareSupported = (): boolean => native?.screenShareSupported?.() ?? false;

/**
 * Share the screen. Android asks the user first (the system's "Start
 * recording or casting?" prompt) and resolves `false` when they say no.
 * iOS shows the system's broadcast sheet and resolves `true` once it is
 * up; the user still has to tap Start Broadcast. Either way it resolves
 * `false` when the build cannot share, and `snapshot.screenSharing`
 * turns true only once the screen is actually going out. Stopping from
 * the system notification (Android) or the status bar (iOS) ends it the
 * same way.
 */
export const startScreenShare = async (): Promise<boolean> =>
  (await native?.startScreenShare?.()) ?? false;

export const stopScreenShare = (): void => native?.stopScreenShare?.();
// ── capture processing (CL7) ──────────────────────────────────────────

/**
 * Whether noise suppression can be switched. On by default on both
 * platforms; the snapshot's `noiseSuppression` says what is in effect.
 */
export const noiseSuppressionSupported = (): boolean =>
  native?.noiseSuppressionSupported?.() ?? false;

/**
 * Noise suppression on or off, for this and later calls (until the app
 * restarts). Android: WebRTC's noise suppression on the microphone
 * (echo cancellation stays on; the mic track is republished, a short
 * gap). iOS: Apple's voice processing does echo cancellation and noise
 * suppression as one, so off bypasses both — offer "off" for
 * headphones only. Returns false when the build can't.
 */
export const setNoiseSuppression = (on: boolean): boolean =>
  native?.setNoiseSuppression?.(on) ?? false;

/**
 * Whether this build can blur the background behind you. iOS 15+: yes
 * (Vision person segmentation). Android: not yet — it needs an ML Kit
 * segmentation model, planned as a later addition. Hide the toggle when
 * false.
 */
export const backgroundBlurSupported = (): boolean => native?.backgroundBlurSupported?.() ?? false;

/**
 * Blur the background on your camera, kept across camera flips and
 * calls. A no-op returning false where unsupported. Background
 * pictures (replacement) are not offered on native yet.
 */
export const setBackgroundBlur = (on: boolean): boolean => native?.setBackgroundBlur?.(on) ?? false;

/** Route call audio to the loudspeaker (`true`) or back to earpiece / headset (`false`). */
export const setSpeaker = (on: boolean): void => native?.setSpeaker(on);

/**
 * Play call audio through one of `snapshot.audioOutputs`. The choice
 * holds for the rest of the call, until that device disconnects or a new
 * headset / Bluetooth device connects (which takes over, as in the
 * phone's own dialer). Without a choice a connected headset wins, then
 * the earpiece for voice calls or the speaker for video.
 */
export function setAudioOutput(id: string): void {
  if (native?.setAudioOutput) native.setAudioOutput(id);
  else native?.setSpeaker(id === 'speaker'); // an older native build
}

/**
 * Recording consent accepted (ConsentPrompt's `onAccepted`): publish the
 * mic and camera again as the user last had them. The core also does it
 * by itself once the server lets this participant publish; calling it
 * early, or twice, is harmless — nothing goes out while
 * `snapshot.canPublish` is false.
 */
export const republish = (): void => native?.republish?.();

/**
 * `snapshot.canPublish` changed (and once at subscribe time with the
 * current value, while a call is up). `true` when no call is up or the
 * native build predates it.
 */
export function onCanPublishChange(cb: (canPublish: boolean) => void): Unsubscribe {
  let last: boolean | null = null;
  const check = (snapshot: Snapshot | null): void => {
    const now = snapshot?.canPublish ?? true;
    if (now === last) return;
    const first = last === null;
    last = now;
    if (!first || snapshot) cb(now);
  };
  check(getCallState());
  return onCallState(check);
}

/**
 * Socket forwarding for an open app: a `call:ring_ended` seen on the
 * socket. Idempotent with the push path — the core dedupes.
 */
export const onRingEnded = (callId: string, reason: string): void =>
  native?.onRingEnded(callId, reason);

/**
 * Socket forwarding: `call:finished`. Pass the payload's `reason`
 * (`finished` | `declined_all` | `no_answer` | `cancelled`) so an
 * unanswered caller sees "Declined"/"No answer", not "Call ended".
 * Idempotent with the `finished` push.
 */
export const onCallFinished = (callId: string, reason?: string): void =>
  native?.onCallFinished(callId, reason ?? null);

/**
 * Android 14+: whether the app may show the full-screen ring over the
 * lock screen. `true` on older Android and where the module is absent.
 */
export const canUseFullScreenIntent = (): boolean => native?.canUseFullScreenIntent() ?? true;

/** Open the system screen where the user grants full-screen intents (falls back to notification settings). */
export const openFullScreenIntentSettings = (): void => native?.openFullScreenIntentSettings();

/**
 * Android: let the app show over the lock screen while a call rings or
 * runs — answering must never demand an unlock. Turn it off when the
 * call ends. The activity re-applies it when the core relaunches it for
 * a call (`poolse_launch_call`), given the host's MainActivity hook.
 * No-op on iOS, where CallKit owns the lock screen.
 */
export function setShowOnLockscreen(enabled: boolean): void {
  try {
    native?.setShowOnLockscreen?.(enabled);
  } catch {
    // Never let a window flag take a call down.
  }
}

// ── missed-call notifications (Android) ─────────────────────────────────

/**
 * Android: the missed-call notification action the app was LAUNCHED
 * with, once — read it on mount. `null` when the app opened any other
 * way. The native core posts that notification itself from the push,
 * so it works with the app closed.
 *
 * iOS shows missed calls as an ordinary alert push (to the token you
 * register with `kind: 'alert'`); read its taps with your notification
 * library — its `type` is `call_missed`, the category
 * `poolse_missed_call`, the Call back action `call_back`.
 */
export function takeCallAction(): CallAction | null {
  return native?.takeCallAction?.() ?? null;
}

/** Android: a missed-call notification tapped while the app is running. */
export function onCallAction(cb: (action: CallAction) => void): Unsubscribe {
  if (!native || !native.takeCallAction) return () => undefined;
  const sub = native.addListener('onCallAction', cb);
  return () => sub.remove();
}

// ── chat notifications ─────────────────────────────────────────────────

let activeConversation: string | null = null;
let activeServer: string | null = null;

/**
 * Tell the core which conversation is on screen (`null` when none, and
 * when the app goes to the background). Its messages are not notified —
 * the user is reading them — and opening it clears the notifications
 * already shown for it. Signed in to several servers, pass the one it is
 * on (`serverId`); without it, the conversation id alone decides.
 */
export function setActiveConversation(conversationId: string | null, serverId?: string): void {
  activeConversation = conversationId;
  activeServer = conversationId ? (serverId ?? null) : null;
  native?.setActiveConversation?.(conversationId, activeServer);
}

/**
 * For the app's notification handler (expo-notifications'
 * `setNotificationHandler`): `false` for a chat notification of the
 * conversation on screen, which must not pop over the chat itself.
 * Android never asks — the core skips those natively.
 */
export function shouldPresentMessage(data: Record<string, unknown> | undefined | null): boolean {
  if (!data || data['type'] !== 'message') return true;
  if (data['conversation_id'] !== activeConversation) return true;
  return activeServer != null && serverOfNotification(data) !== activeServer;
}

/**
 * The conversation a tapped notification belongs to — a chat message
 * (`type: 'message'`) or a missed call (`call_missed`) — from its data.
 * iOS hands the tap to your notification library; Android delivers it
 * through `takeCallAction` / `onCallAction` (type `open`). Its server:
 * `serverOfNotification`.
 */
export function conversationOfNotification(
  data: Record<string, unknown> | undefined | null,
): string | null {
  if (!data) return null;
  const type = data['type'];
  if (type !== 'message' && type !== 'call_missed') return null;
  return typeof data['conversation_id'] === 'string' ? data['conversation_id'] : null;
}

/**
 * Reply and Mark as read from a chat notification are handled natively —
 * from the lock screen, with the app closed — using the grant the push
 * carried and its server's API origin (`configure` / `addServer`, persisted).
 * This fires once each finishes while the app is running. Read the ones
 * that finished while it was not with `takeNotificationActions` on mount.
 */
export function onNotificationAction(cb: (result: NotificationActionResult) => void): Unsubscribe {
  if (!native?.takeNotificationActions) return () => undefined;
  const sub = native.addListener('onNotificationAction', cb);
  if (actionObservers++ === 0) native.observeNotificationActions?.(true);
  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    sub.remove();
    if (--actionObservers === 0) native?.observeNotificationActions?.(false);
  };
}

// Native queues results until someone listens for them specifically.
let actionObservers = 0;

/** `onNotificationAction`, replies only. */
export function onNotificationReply(cb: (result: NotificationActionResult) => void): Unsubscribe {
  return onNotificationAction((result) => {
    if (result.action === 'reply') cb(result);
  });
}

/**
 * The notification actions that finished while no `onNotificationAction`
 * listener was attached (usually: the app was not running), oldest
 * first, each returned once. Up to the last 50 are kept.
 */
export function takeNotificationActions(): NotificationActionResult[] {
  return native?.takeNotificationActions?.() ?? [];
}

// ── VoIP push (iOS) ───────────────────────────────────────────────────

/**
 * iOS: the current PushKit VoIP token, registered natively at launch.
 * `null` until iOS issues one, and always on Android (FCM carries rings).
 */
export function getVoipToken(): VoipToken | null {
  return native?.getVoipToken?.() ?? null;
}

/** iOS: fires whenever PushKit issues (or rotates) the VoIP token. No-op on Android. */
export function onVoipToken(cb: (token: VoipToken) => void): Unsubscribe {
  if (!native || !native.getVoipToken) return () => undefined;
  const sub = native.addListener('onVoipToken', cb);
  return () => sub.remove();
}

// ── picture-in-picture ────────────────────────────────────────────────

/**
 * Arm picture-in-picture: while on, leaving the app keeps the call's
 * video in a floating window. Turn it on only while a video call shows
 * someone's picture, and off otherwise.
 *
 * iOS (15+) floats the `<CallVideoView pictureInPicture>` that is on
 * screen — mark the main remote picture. Android (8+) floats the whole
 * app: draw a compact layout while `isInPictureInPicture()` (see
 * `onPictureInPicture`). The app needs `android:supportsPictureInPicture`
 * on its activity.
 */
export function setPictureInPictureEnabled(on: boolean): void {
  native?.setPictureInPictureEnabled?.(on);
}

/** Whether the floating window is open right now. */
export function isInPictureInPicture(): boolean {
  return native?.isInPictureInPicture?.() ?? false;
}

/** Whether this device can float a call at all. */
export function pictureInPictureSupported(): boolean {
  return native?.pictureInPictureSupported?.() ?? false;
}

/** Fires when the floating window opens (`true`) and closes (`false`). */
export function onPictureInPicture(cb: (active: boolean) => void): Unsubscribe {
  if (!native?.setPictureInPictureEnabled) return () => undefined;
  const sub = native.addListener('onPictureInPicture', (payload) => cb(payload.active));
  return () => sub.remove();
}

// ── video ─────────────────────────────────────────────────────────────

export interface CallVideoViewProps extends ViewProps {
  /** Remote participant's userId (LiveKit identity). Omit with local=true for self view. */
  participantId?: string;
  local?: boolean;
  /** default: true for local front camera, false otherwise */
  mirror?: boolean;
  /** default 'cover' */
  fit?: 'cover' | 'contain';
  /**
   * `camera` (default), or `screen`: the participant's shared screen
   * (with `local`, your own). A screen is never mirrored; draw it with
   * `fit="contain"` so nothing is cropped.
   */
  source?: 'camera' | 'screen';
  /**
   * iOS: this remote picture is the one picture-in-picture floats when
   * the app is left (`setPictureInPictureEnabled`). Mark one at a time.
   */
  pictureInPicture?: boolean;
}

type NativeVideoProps = CallVideoViewProps;

let nativeVideo: ComponentType<NativeVideoProps> | null | undefined;

/** Resolved lazily (first render) and only when the native module exists. */
function nativeVideoView(): ComponentType<NativeVideoProps> | null {
  if (nativeVideo !== undefined) return nativeVideo;
  nativeVideo = null;
  if (native) {
    try {
      nativeVideo = requireNativeViewManager<NativeVideoProps>('PoolseCalls', 'PoolseCallVideo');
    } catch {
      nativeVideo = null; // an older native build without the view
    }
  }
  return nativeVideo;
}

/**
 * A participant's camera (or, with `local`, your own), rendered natively
 * by the call core. Shows nothing (stays transparent) while that camera
 * is off — draw the avatar from the snapshot's `cameraOn` underneath.
 * Without the native module it renders an empty View.
 */
export function CallVideoView(props: CallVideoViewProps): ReactElement | null {
  const Native = nativeVideoView();
  if (!Native) {
    const {
      participantId: _p,
      local: _l,
      mirror: _m,
      fit: _f,
      source: _s,
      pictureInPicture: _pip,
      ...rest
    } = props;
    return createElement(View, rest);
  }
  return createElement(Native, props);
}
