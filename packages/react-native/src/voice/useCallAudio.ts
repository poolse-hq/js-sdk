import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { describeRoute, type AudioRoute, type LiveKitReactNativeModule } from './livekit-rn.js';

export interface UseCallAudioOptions {
  /**
   * True as soon as a call exists — ringing counts.
   *
   * Deliberately not "connected": the audio session has to be running
   * before LiveKit's audio engine starts, not after. Start it late and
   * the call connects, the roster is right, video flows, and no audio
   * is published in either direction.
   */
  active: boolean;
  /**
   * Whether the call is carrying video.
   *
   * Decides where audio goes by default — nobody holds a phone to their
   * ear while looking at the screen — and nothing else. Read once, when
   * the call starts; see {@link LiveKitReactNativeModule.setupIOSAudioManagement}
   * for why it cannot be re-applied mid-call.
   */
  video: boolean;
  /** `@livekit/react-native`, imported by your app. */
  livekitReactNative?: LiveKitReactNativeModule | null | undefined;
}

export interface CallAudio {
  /** Audio is coming out of the loudspeaker. */
  speakerOn: boolean;
  toggleSpeaker: () => void;
  setSpeaker: (on: boolean) => void;
  /** Every route that can be picked right now. */
  routes: AudioRoute[];
  /**
   * The selected route's platform id, or `null` while routing is
   * automatic — which is the normal state until the user picks
   * something. Automatic means the OS follows the preference order the
   * call was configured with, so plugging in a headset just works.
   */
  selectedRouteId: string | null;
  selectRoute: (id: string) => void;
  /**
   * A headset, AirPods or car kit is connected.
   *
   * Worth surfacing because it changes what the speaker button means:
   * with a headset attached, "off" routes to the headset rather than to
   * the earpiece.
   *
   * Android only, and honestly so — iOS reports just `default` and
   * `force_speaker` from `getAudioOutputs`, with no way to ask what
   * `default` currently resolves to. On iOS this stays `false` and the
   * system route picker is the way to see and change the real device.
   */
  externalDevice: boolean;
  /**
   * The system route picker can be opened. iOS only — Android
   * enumerates its devices in {@link routes} instead.
   */
  canPickSystemRoute: boolean;
  openSystemRoutePicker: () => void;
}

const IOS_AUTO = 'default';
const IOS_SPEAKER = 'force_speaker';

/**
 * Owns the audio session for an SFU-backed call, and the routing on top
 * of it.
 *
 * ## Why this is not `react-native-incall-manager`
 *
 * `registerGlobals()` from `@livekit/react-native` drives AVAudioSession
 * natively off its own audio engine's state. Anything else driving the
 * session at the same time fights it, and the symptom is brutal: the
 * microphone captures nothing, and audio only starts working after some
 * unrelated engine change — turning the camera on, say — makes LiveKit
 * reapply its configuration. So InCallManager is reserved for the
 * peer-to-peer mesh, which has no session management of its own.
 *
 * ## What "default" means on each platform
 *
 * Android is handed a `preferredOutputList` and picks the best
 * available device itself, so a connected headset wins without the app
 * detecting anything. iOS is given `defaultOutput`, which LiveKit
 * documents as the output to use *when a wired headset or Bluetooth
 * output is unavailable* — same effect, same reason: an app that forced
 * the speaker on a video call would yank audio out of the user's
 * AirPods every time.
 */
export function useCallAudio({
  active,
  video,
  livekitReactNative,
}: UseCallAudioOptions): CallAudio {
  const session = livekitReactNative?.AudioSession;
  const ios = Platform.OS === 'ios';

  const [routes, setRoutes] = useState<AudioRoute[]>([]);
  // Null until the user picks: the platform is already routing by the
  // preference order handed to `configureAudio`, and naming a route
  // here would pin it and defeat the automatic headset switching.
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);

  // Captured at call start. Depending on `video` directly would tear the
  // audio session down and rebuild it every time the camera is toggled.
  const preferSpeaker = useRef(video);
  if (!active) preferSpeaker.current = video;

  // Whether the user has made an explicit choice on this call. Once they
  // have, nothing derived from the media type may override it — turning
  // the camera on must not move audio off the earpiece they chose.
  const userChose = useRef(false);
  if (!active) userChose.current = false;

  const refreshRoutes = useCallback(() => {
    if (!session) return;
    void session
      .getAudioOutputs()
      .then((ids) => setRoutes(ids.map(describeRoute)))
      .catch(() => {
        // An unstarted session, or a platform that refuses to enumerate.
        // The speaker toggle still works; only the picker is poorer for
        // it, which is not worth failing a call over.
      });
  }, [session]);

  // ── session lifecycle ────────────────────────────────────────────────

  useEffect(() => {
    if (!active || !session) return;

    const wantsSpeaker = preferSpeaker.current;
    let disposePolicy: (() => void) | undefined;

    // Ordering matters: configure, then install the iOS policy, then
    // start. `configureAudio` is documented as having to run before the
    // room connects for it to apply at all.
    void (async () => {
      try {
        await session.configureAudio({
          android: {
            // Best device first. A headset or car kit outranks the
            // built-in outputs either way; the media type only decides
            // which built-in output wins when nothing is plugged in.
            preferredOutputList: wantsSpeaker
              ? ['bluetooth', 'headset', 'speaker', 'earpiece']
              : ['bluetooth', 'headset', 'earpiece', 'speaker'],
          },
          ios: { defaultOutput: wantsSpeaker ? 'speaker' : 'earpiece' },
        });
      } catch {
        // Falls back to LiveKit's own defaults, which are sane.
      }

      disposePolicy = livekitReactNative?.setupIOSAudioManagement?.(wantsSpeaker);

      try {
        await session.startAudioSession();
      } catch {
        // A refused session leaves the call silent rather than failing
        // it outright. Better a call the user can see is broken than one
        // that never rings.
      }
      refreshRoutes();
    })();

    return () => {
      // Released deliberately. Holding the session open leaves the
      // device in call mode afterwards, with media apps stuck at call
      // volume and the earpiece still routed.
      void session.stopAudioSession().catch(() => {});
      disposePolicy?.();
    };
  }, [active, session, livekitReactNative, refreshRoutes]);

  // A finished call must not hand its routing to the next one.
  useEffect(() => {
    if (active) return;
    setSelectedRouteId(null);
    setRoutes([]);
  }, [active]);

  // ── device changes ───────────────────────────────────────────────────

  useEffect(() => {
    if (!active) return;
    const events = livekitReactNative?.audioDeviceModuleEvents;
    if (!events) return;

    const onChange = () => refreshRoutes();
    try {
      events.addDevicesUpdatedListener(onChange);
    } catch {
      // iOS/macOS only in the current module. Android still refreshes on
      // call start and whenever the picker is opened, which covers the
      // cases a user can actually observe.
      return;
    }
    return () => {
      try {
        events.removeDevicesUpdatedListener(onChange);
      } catch {
        // Nothing registered; nothing to undo.
      }
    };
  }, [active, livekitReactNative, refreshRoutes]);

  // ── selection ────────────────────────────────────────────────────────

  const selectRoute = useCallback(
    (id: string) => {
      userChose.current = true;
      setSelectedRouteId(id);
      if (!session) return;
      void session.selectAudioOutput(id).catch(() => {
        // The device went away between listing and picking. Re-reading
        // is more useful than reporting it.
        refreshRoutes();
      });
    },
    [session, refreshRoutes],
  );

  const externalDevice = useMemo(
    () => routes.some((r) => r.kind === 'headset' || r.kind === 'bluetooth'),
    [routes],
  );

  // With no explicit choice, report where the platform was told to send
  // audio by default — except when something is plugged in, which
  // outranks the loudspeaker in every preference order above.
  const speakerOn =
    selectedRouteId === null
      ? preferSpeaker.current && !externalDevice
      : ios
        ? selectedRouteId === IOS_SPEAKER
        : selectedRouteId === 'speaker';

  const setSpeaker = useCallback(
    (on: boolean) => {
      if (ios) {
        selectRoute(on ? IOS_SPEAKER : IOS_AUTO);
        return;
      }
      if (on) {
        selectRoute('speaker');
        return;
      }
      // Turning the speaker off on Android has to name a destination.
      // Prefer whatever the user is wearing over the earpiece — pulling
      // audio out of connected AirPods would be the wrong reading of
      // "not the loudspeaker".
      const fallback =
        routes.find((r) => r.kind === 'bluetooth') ??
        routes.find((r) => r.kind === 'headset') ??
        routes.find((r) => r.kind === 'earpiece');
      if (fallback) selectRoute(fallback.id);
    },
    [ios, routes, selectRoute],
  );

  const toggleSpeaker = useCallback(() => setSpeaker(!speakerOn), [setSpeaker, speakerOn]);

  const openSystemRoutePicker = useCallback(() => {
    void session?.showAudioRoutePicker?.().catch(() => {});
  }, [session]);

  return {
    speakerOn,
    toggleSpeaker,
    setSpeaker,
    routes,
    selectedRouteId,
    selectRoute,
    externalDevice,
    canPickSystemRoute: ios && typeof session?.showAudioRoutePicker === 'function',
    openSystemRoutePicker,
  };
}
