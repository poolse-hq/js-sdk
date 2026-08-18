/**
 * React Native WebRTC binding, backed by `react-native-webrtc`.
 *
 * That package ships native code, so it can't run in Expo Go and not
 * every app wants it. It's therefore an OPTIONAL peer dependency,
 * resolved with a guarded `require` at call time rather than a static
 * import: an app that never places a call doesn't need it installed,
 * and one that does gets a clear message instead of a redbox at import.
 *
 * Media streams on native aren't attached to an element the way they
 * are on the web — audio-only calls route to the device's audio session
 * automatically once the peer connection is live, so the sink is a
 * no-op. Video would render the stream through `<RTCView>` using the
 * `toURL()` the stream exposes.
 */

import type { VoiceIceServer, VoicePeerConnection, VoiceStream, WebRtcAdapter } from '@poolse/sdk';

interface NativeWebRtcModule {
  RTCPeerConnection: new (config: { iceServers: VoiceIceServer[] }) => VoicePeerConnection;
  mediaDevices: {
    getUserMedia(constraints: {
      audio: boolean | Record<string, unknown>;
      video: boolean;
    }): Promise<VoiceStream>;
  };
}

let cached: NativeWebRtcModule | null | undefined;

/** Resolve the native module once, remembering a miss so repeated
 *  checks don't keep paying for a failing require. */
function loadNativeWebRtc(): NativeWebRtcModule | null {
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('react-native-webrtc') as NativeWebRtcModule;
  } catch {
    cached = null;
  }
  return cached;
}

/**
 * Whether this app can actually carry call audio. Use it to disable a
 * call button rather than letting the user tap into a failure.
 */
export function isNativeWebRtcAvailable(): boolean {
  return loadNativeWebRtc() != null;
}

/**
 * Adapter for {@link useVoiceRoom}'s `webrtc` option.
 *
 * @throws when `react-native-webrtc` isn't installed — check
 *         {@link isNativeWebRtcAvailable} first if that's reachable in
 *         your UI.
 */
export function createNativeWebRtcAdapter(): WebRtcAdapter {
  const native = loadNativeWebRtc();
  if (!native) {
    throw new Error(
      'react-native-webrtc is not installed. Add it to enable poolse voice calls:\n' +
        '  npx expo install react-native-webrtc\n' +
        'It contains native code, so it needs a development build — it will not run in Expo Go.',
    );
  }

  return {
    createPeerConnection(iceServers: VoiceIceServer[]): VoicePeerConnection {
      return new native.RTCPeerConnection({ iceServers });
    },

    getUserMedia(): Promise<VoiceStream> {
      return native.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
    },

    playRemoteStream(): () => void {
      // Audio-only: the native audio session plays the remote track as
      // soon as it's connected, so there's no sink to create or clean up.
      return () => {};
    },
  };
}
