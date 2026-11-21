// What a message's agent and meeting parts do when pressed, and how
// recordings and clips play. `<ConversationView>` provides it from its
// props; a custom layout wraps its rows in `<MessageExtrasProvider>`.
// Same handlers as @poolse/react-ui, plus `renderMedia`.

import type { Citation, MeetingMoment, Message } from '@poolse/sdk';
import { createContext, useContext, type ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

/**
 * What a media adapter gets (see `renderMedia`). A controlled player:
 * follow `paused` and `rate`, seek when `seek.nonce` changes, and report
 * the position (a few times a second), the duration, the end and errors.
 */
export interface PoolseMediaProps {
  uri: string;
  contentType: string | null;
  kind: 'audio' | 'video';
  paused: boolean;
  rate: number;
  /** A seek request: go to `ms` whenever `nonce` changes. Null: none yet. */
  seek: { ms: number; nonce: number } | null;
  onProgress: (positionMs: number) => void;
  onLoad: (durationMs: number | null) => void;
  onEnd: () => void;
  onError: (error: unknown) => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * Plays a recording or clip. @poolse/react-native ships no media player
 * of its own: wire the one your app uses (expo-video, expo-audio,
 * react-native-video) — the README has an expo-video adapter. Without
 * one, players show their chapters and transcript but no media.
 */
export type RenderMedia = (props: PoolseMediaProps) => ReactNode;

export interface MessageExtrasHandlers {
  /**
   * A citation was pressed. A `message` citation: focus that message;
   * `transcript`: open the call at `startMs`; `file`: open the file.
   * `<ConversationView>` focuses messages of its own conversation by
   * itself when this isn't given.
   */
  onOpenCitation?: (citation: Citation, message: Message) => void;
  /**
   * A point in a call was pressed: open its recording at `recordingMs`
   * (when `recordingId` is set) or its transcript at `startMs`.
   */
  onOpenMoment?: (moment: MeetingMoment) => void;
  /** A poolse user id → display name (assignees in summaries). Unknown: null. */
  nameForUserId?: (userId: string) => string | null | undefined;
  /** A poolse user id → their `external_id`, so a name resolves live with `useUser`. */
  externalIdForUserId?: (userId: string) => string | null | undefined;
  /** The media adapter for clips in chat (and any player without its own). */
  renderMedia?: RenderMedia;
}

const MessageExtrasContext = createContext<MessageExtrasHandlers>({});

export function MessageExtrasProvider({
  value,
  children,
}: {
  value: MessageExtrasHandlers;
  children: ReactNode;
}) {
  return <MessageExtrasContext.Provider value={value}>{children}</MessageExtrasContext.Provider>;
}

/** The nearest `MessageExtrasProvider`'s handlers (empty without one). */
export function useMessageExtras(): MessageExtrasHandlers {
  return useContext(MessageExtrasContext);
}
