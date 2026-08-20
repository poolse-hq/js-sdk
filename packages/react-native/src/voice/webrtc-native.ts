/**
 * React Native WebRTC binding, backed by `react-native-webrtc`.
 *
 * The module is passed IN rather than required here, and that is
 * deliberate. Metro resolves dependencies statically, and this package
 * is published through tsup, which rewrites a literal `require(...)`
 * into a `__require(...)` call it cannot see — so bundling
 * `react-native-webrtc` from inside this file never worked. It wasn't
 * merely unavailable in Expo Go; it was absent from every bundle,
 * development builds included, and surfaced as
 * "Requiring unknown module react-native-webrtc" at runtime.
 *
 * Importing it in the app fixes that: Metro sees a static import in
 * your source and bundles it. Optionality then lives where it belongs —
 * an app that doesn't want voice simply never imports it, and never
 * installs the native dependency.
 *
 *     import * as webrtc from 'react-native-webrtc';
 *     <VoiceRoomBar conversationId={id} webrtc={webrtc} />
 *
 * Media streams on native aren't attached to an element the way they
 * are on the web — audio-only calls route to the device's audio session
 * once the peer connection is live, so the sink is a no-op. Video would
 * render the stream through `<RTCView>` via the `toURL()` it exposes.
 */

import type { VoiceIceServer, VoicePeerConnection, VoiceStream, WebRtcAdapter } from '@poolse/sdk';

/**
 * The shape this binding needs from `react-native-webrtc`. The module's
 * own namespace satisfies it, so `import * as webrtc` type-checks
 * straight through.
 */
export interface NativeWebRtcModule {
  RTCPeerConnection: new (config: { iceServers: VoiceIceServer[] }) => VoicePeerConnection;
  mediaDevices: {
    getUserMedia(constraints: {
      audio: boolean | Record<string, unknown>;
      video: boolean;
    }): Promise<VoiceStream>;
  };
}

/**
 * True when `mod` looks like a usable `react-native-webrtc`.
 *
 * Guards against a half-linked native module: in a bare Expo Go client
 * the JS may load while the native side is missing, leaving
 * `RTCPeerConnection` undefined.
 */
export function isNativeWebRtcAvailable(mod: NativeWebRtcModule | null | undefined): boolean {
  return typeof mod?.RTCPeerConnection === 'function' && mod?.mediaDevices != null;
}

/**
 * Adapter for `useVoiceRoom`'s `webrtc` option.
 *
 * @param mod the `react-native-webrtc` module, imported by your app.
 * @throws when `mod` isn't a usable binding — check
 *         {@link isNativeWebRtcAvailable} first if that's reachable in
 *         your UI.
 */
export function createNativeWebRtcAdapter(mod: NativeWebRtcModule): WebRtcAdapter {
  if (!isNativeWebRtcAvailable(mod)) {
    throw new Error(
      'react-native-webrtc is missing or not linked. Install it and rebuild:\n' +
        '  npx expo install react-native-webrtc\n' +
        'It contains native code, so it needs a development build — it will not run in Expo Go.',
    );
  }

  return {
    createPeerConnection(iceServers: VoiceIceServer[]): VoicePeerConnection {
      return new mod.RTCPeerConnection({ iceServers });
    },

    getUserMedia(): Promise<VoiceStream> {
      return mod.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
    },

    playRemoteStream(): () => void {
      // Audio-only: the native audio session plays the remote track as
      // soon as it connects, so there's no sink to create or clean up.
      return () => {};
    },
  };
}
