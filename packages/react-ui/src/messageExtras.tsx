// What a message's agent and meeting parts do when pressed — a citation
// under an assistant's answer, a moment in a call summary, a clip's
// "Open the recording". `<ConversationView>` and `<ThreadView>` provide
// it from their props; a custom layout wraps its rows in
// `<MessageExtrasProvider>` itself.

import type { Citation, MeetingMoment, Message } from '@poolse/sdk';
import { createContext, useContext, type ReactNode } from 'react';

export interface MessageExtrasHandlers {
  /**
   * A citation was pressed. A `message` citation: focus that message;
   * `transcript`: open the call at `startMs`; `file`: open the file.
   * `<ConversationView>` focuses messages of its own conversation by
   * itself when this isn't given.
   */
  onOpenCitation?: (citation: Citation, message: Message) => void;
  /**
   * A point in a call was pressed (a summary line or moment, a source of
   * an answer): open its recording at `recordingMs` (when `recordingId`
   * is set) or its transcript at `startMs`.
   */
  onOpenMoment?: (moment: MeetingMoment) => void;
  /** A poolse user id → display name (assignees in summaries). Unknown: null. */
  nameForUserId?: (userId: string) => string | null | undefined;
  /**
   * A poolse user id → their `external_id`, so a name can be resolved
   * (and kept live) with `useUser`. `<ConversationView>` maps its members.
   */
  externalIdForUserId?: (userId: string) => string | null | undefined;
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
