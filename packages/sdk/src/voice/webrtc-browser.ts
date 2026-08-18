/**
 * Browser WebRTC binding. Used automatically when no adapter is passed
 * to {@link VoiceRoom}; React Native supplies its own via
 * `@poolse/react-native`.
 */

import type { VoiceIceServer, VoicePeerConnection, VoiceStream, WebRtcAdapter } from './types.js';

/** True when this runtime can actually negotiate WebRTC. */
export function isWebRtcAvailable(): boolean {
  return (
    typeof globalThis !== 'undefined' &&
    typeof (globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection === 'function'
  );
}

export function createBrowserWebRtcAdapter(): WebRtcAdapter {
  return {
    createPeerConnection(iceServers: VoiceIceServer[]): VoicePeerConnection {
      // The DOM's RTCPeerConnection satisfies VoicePeerConnection
      // structurally; the cast is only needed because our interface is
      // deliberately narrower than the full DOM type.
      return new RTCPeerConnection({
        iceServers: iceServers as RTCIceServer[],
      }) as unknown as VoicePeerConnection;
    },

    async getUserMedia(): Promise<VoiceStream> {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      return stream as unknown as VoiceStream;
    },

    playRemoteStream(_peerId: string, stream: VoiceStream): () => void {
      const el = document.createElement('audio');
      el.autoplay = true;
      // Present in the DOM (required for playback) but never laid out.
      el.style.display = 'none';
      el.srcObject = stream as unknown as MediaStream;
      document.body.appendChild(el);

      // Autoplay policies reject until the user has gestured. Joining a
      // call is a gesture, so this normally resolves; swallow either way
      // rather than failing the whole room.
      void el.play().catch(() => {});

      return () => {
        el.srcObject = null;
        el.remove();
      };
    },
  };
}
