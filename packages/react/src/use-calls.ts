import type { IncomingCall, OutgoingCall } from '@poolse/sdk';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePoolse } from './provider.js';

/** Where a call is in its lifecycle, from this device's point of view. */
export type CallPhase =
  | 'idle'
  /** We placed a call and are waiting for an answer. */
  | 'ringing-out'
  /** Someone is ringing us. */
  | 'ringing-in'
  /** Both sides agreed; the voice room should be joined now. */
  | 'active'
  /** The far side said no. */
  | 'declined'
  /** The person we called is already on another call. */
  | 'busy';

export interface UseCalls {
  phase: CallPhase;
  /** Set while `phase` is `ringing-in`. */
  incoming: IncomingCall | null;
  /** Set while `phase` is `ringing-out` or `active`. */
  outgoing: OutgoingCall | null;
  /**
   * Conversation whose voice room should be joined once `phase` turns
   * `active` — the same id for both caller and callee.
   */
  activeConversationId: string | null;
  error: Error | null;
  /** Ring every other member of a conversation. */
  call: (conversationId: string) => Promise<void>;
  /** Answer the inbound ring. */
  accept: () => Promise<void>;
  /** Reject the inbound ring. */
  decline: () => Promise<void>;
  /** Hang up an outbound ring before it's answered. */
  cancel: () => Promise<void>;
  /** Drop back to idle — call after leaving the room, or to clear a
   *  `declined` / `busy` state the UI has finished showing. */
  reset: () => void;
}

/**
 * WhatsApp-style calling: ring a conversation, show an incoming-call
 * screen, accept or decline.
 *
 * This hook is only the *invitation* half. Audio starts when you join
 * the voice room, which the host app does once `phase` is `active`:
 *
 *     const calls = useCalls(myUserId);
 *     const voice = useVoiceRoom(calls.activeConversationId);
 *
 *     useEffect(() => {
 *       if (calls.phase === 'active') void voice.join();
 *     }, [calls.phase]);
 *
 * Keeping them separate means a "join voice" button and a ringing call
 * share exactly one implementation of the media path.
 */
export function useCalls(userId: string | null): UseCalls {
  const poolse = usePoolse();

  const [phase, setPhase] = useState<CallPhase>('idle');
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);
  const [outgoing, setOutgoing] = useState<OutgoingCall | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const calls = useMemo(() => (userId ? poolse.realtime.calls(userId) : null), [poolse, userId]);

  useEffect(() => {
    if (!calls) return;

    const offIncoming = calls.onIncoming((call) => {
      // One call at a time. A second ring must not replace the screen
      // mid-decision — but it must not vanish silently either, or the
      // second caller can't tell "busy" from "ignoring me". Answer it
      // automatically so their UI can say so.
      setPhase((current) => {
        if (current !== 'idle') {
          void calls.markBusy(call).catch(() => {
            // Best effort: failing to send busy just degrades to the
            // old silence, which must not break the call in progress.
          });
          return current;
        }
        setIncoming(call);
        return 'ringing-in';
      });
    });

    const offAccepted = calls.onAccepted((call) => {
      setPhase('active');
      setActiveConversationId(call.conversationId);
    });

    const offDeclined = calls.onDeclined(() => {
      setPhase('declined');
      setOutgoing(null);
    });

    const offBusy = calls.onBusy(() => {
      setPhase('busy');
      setOutgoing(null);
    });

    const offCancelled = calls.onCancelled((call) => {
      // Only clear if it's the call we're actually showing — a late
      // cancel for an older call shouldn't dismiss a fresh ring.
      setIncoming((current) => {
        if (current && current.callId !== call.callId) return current;
        setPhase('idle');
        return null;
      });
    });

    return () => {
      offIncoming();
      offAccepted();
      offDeclined();
      offBusy();
      offCancelled();
    };
  }, [calls]);

  const call = useCallback(
    async (conversationId: string) => {
      if (!calls) return;
      setError(null);
      try {
        const placed = await calls.invite(conversationId);
        setOutgoing(placed);
        setPhase('ringing-out');
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
        setPhase('idle');
      }
    },
    [calls],
  );

  const accept = useCallback(async () => {
    if (!calls || !incoming) return;
    try {
      await calls.accept(incoming);
      setActiveConversationId(incoming.conversationId);
      setPhase('active');
      setIncoming(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  }, [calls, incoming]);

  const decline = useCallback(async () => {
    if (!calls || !incoming) return;
    try {
      await calls.decline(incoming);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      // Local state clears either way: a failed decline shouldn't leave
      // the ring screen stuck on screen.
      setIncoming(null);
      setPhase('idle');
    }
  }, [calls, incoming]);

  const cancel = useCallback(async () => {
    if (!calls || !outgoing) return;
    try {
      await calls.cancel(outgoing);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setOutgoing(null);
      setPhase('idle');
    }
  }, [calls, outgoing]);

  const reset = useCallback(() => {
    setPhase('idle');
    setIncoming(null);
    setOutgoing(null);
    setActiveConversationId(null);
    setError(null);
  }, []);

  return {
    phase,
    incoming,
    outgoing,
    activeConversationId,
    error,
    call,
    accept,
    decline,
    cancel,
    reset,
  };
}
