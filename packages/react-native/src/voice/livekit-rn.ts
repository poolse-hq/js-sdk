/**
 * The slice of `@livekit/react-native` this package uses.
 *
 * Passed in by the app rather than imported, for the same reason
 * `react-native-webrtc` is: tsup rewrites `require()` into
 * `__require()`, which Metro cannot follow, so anything this package
 * imports for itself never reaches a React Native bundle.
 *
 *     import * as livekitRN from '@livekit/react-native';
 *     <CallScreen livekitReactNative={livekitRN} … />
 *
 * Everything past `VideoTrack` is optional so an older version of the
 * module still type-checks — the features degrade rather than failing
 * to compile.
 */

import type { ComponentType } from 'react';
import type { ViewStyle } from 'react-native';

/**
 * The slice of `VideoTrack` actually rendered.
 *
 * `LiveKitReactNativeModule.VideoTrack` is `unknown` because React props
 * are contravariant — declaring the narrow shape there means the real
 * component is not assignable to it and no app can pass the module in.
 * Narrowing happens at the point of use, through this.
 */
export type CheckedVideoTrack = ComponentType<{
  trackRef: unknown;
  style?: ViewStyle;
  objectFit?: 'cover' | 'contain';
  mirror?: boolean;
  zOrder?: number;
}>;

/** What an audio route is, once its platform id has been read. */
export type AudioRouteKind = 'speaker' | 'earpiece' | 'headset' | 'bluetooth' | 'auto';

export interface AudioRoute {
  /** Platform id, passed back to `selectAudioOutput`. */
  id: string;
  kind: AudioRouteKind;
  /** Human label for a picker row. */
  label: string;
}

/**
 * LiveKit's audio session.
 *
 * The two platforms expose genuinely different things and the shape
 * reflects that rather than papering over it:
 *
 *   * **Android** enumerates real devices — `speaker`, `earpiece`,
 *     `headset`, `bluetooth` — and `selectAudioOutput` picks one.
 *   * **iOS** offers only `default` and `force_speaker`, because AVAudio
 *     does not let an app pick a route directly. Anything else (AirPods,
 *     a wired headset, AirPlay) goes through the system's own picker,
 *     which is what `showAudioRoutePicker` opens.
 */
export interface LiveKitAudioSession {
  configureAudio(config: {
    android?: {
      preferredOutputList?: ('speaker' | 'earpiece' | 'headset' | 'bluetooth')[];
      audioTypeOptions?: unknown;
    };
    ios?: { defaultOutput?: 'speaker' | 'earpiece' };
  }): Promise<void>;
  startAudioSession(): Promise<void>;
  stopAudioSession(): Promise<void>;
  getAudioOutputs(): Promise<string[]>;
  selectAudioOutput(deviceId: string): Promise<void>;
  /** iOS 11+. Opens the system route picker (AirPods, AirPlay, …). */
  showAudioRoutePicker?(): Promise<void>;
}

/** Fires when a headset or Bluetooth device appears or disappears. */
export interface AudioDeviceModuleEvents {
  addDevicesUpdatedListener(listener: () => void): void;
  removeDevicesUpdatedListener(listener: () => void): void;
}

export interface LiveKitReactNativeModule {
  /**
   * The module's `VideoTrack` component.
   *
   * Typed as `unknown` on purpose. Its real props are far more specific
   * than what this renders with, and React component props are
   * contravariant — declaring the narrow shape here means the real
   * component is not assignable to it and no app can pass the module in.
   * It is narrowed at the point of use.
   */
  VideoTrack: unknown;
  AudioSession?: LiveKitAudioSession | undefined;
  /**
   * Installs LiveKit's iOS audio policy and returns a disposer.
   *
   * Must not be re-run mid-call: it abandons the session activation the
   * previous handlers were holding, which kills audio outright. The
   * speaker preference is therefore captured once, when the call
   * starts, and later changes go through `selectAudioOutput` instead.
   */
  setupIOSAudioManagement?: ((preferSpeakerOutput?: boolean) => () => void) | undefined;
  audioDeviceModuleEvents?: AudioDeviceModuleEvents | undefined;
}

/** Turn a platform output id into something renderable. */
export function describeRoute(id: string): AudioRoute {
  switch (id) {
    case 'speaker':
    case 'force_speaker':
      return { id, kind: 'speaker', label: 'Speaker' };
    case 'earpiece':
      return { id, kind: 'earpiece', label: 'Phone' };
    case 'headset':
      return { id, kind: 'headset', label: 'Headphones' };
    case 'bluetooth':
      return { id, kind: 'bluetooth', label: 'Bluetooth' };
    case 'default':
      // iOS's "whatever the OS thinks is right" — the earpiece normally,
      // a headset or AirPods the moment one is connected. Labelled for
      // the common case rather than the mechanism.
      return { id, kind: 'auto', label: 'iPhone' };
    default:
      return { id, kind: 'auto', label: id };
  }
}
