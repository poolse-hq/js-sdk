import type { IncomingCall, OutgoingCall } from '@poolse/sdk';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  | 'busy'
  /** Nobody picked up before the ring timeout elapsed. */
  | 'timed-out';

export interface UseCallsOptions {
  /**
   * How long a ring may go unanswered, in milliseconds, before it is
   * given up on. Defaults to 45s, roughly what the mainstream call apps
   * use. Pass `0` to ring indefinitely.
   *
   * The server deliberately holds no timer — only the UI knows when it
   * stopped waiting — so this is what actually ends an unanswered call.
   * Both directions are covered: an outbound ring cancels itself, and an
   * inbound one gives up too, otherwise a caller that crashed mid-ring
   * would leave the callee's phone ringing forever.
   */
  ringTimeoutMs?: number;
}

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
  /**
   * Answer the inbound ring.
   *
   * Pass the call explicitly when it didn't arrive over the socket — a
   * VoIP push can launch the app cold, in which case this hook has no
   * `incoming` state and the push payload is the only source of truth.
   */
  accept: (call?: IncomingCall) => Promise<void>;
  /** Reject the inbound ring. Takes an explicit call for the same
   *  cold-launch reason as {@link accept}. */
  decline: (call?: IncomingCall) => Promise<void>;
  /** Hang up an outbound ring before it's answered. */
  cancel: () => Promise<void>;
  /**
   * End the call, whatever state it is in.
   *
   * The one action a UI's hang-up button should call: it sends the right
   * signal for the current phase — cancel while ringing out, decline
   * while ringing in, hangup once connected — and always returns to
   * idle, even if the signal fails. `reset` alone clears local state
   * only, which leaves the other side in the call.
   */
  hangUp: () => Promise<void>;
  /** Drop back to idle — call after leaving the room, or to clear a
   *  `declined` / `busy` / `timed-out` state the UI has finished
   *  showing. */
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
export function useCalls(userId: string | null, opts: UseCallsOptions = {}): UseCalls {
  const ringTimeoutMs = opts.ringTimeoutMs ?? 45_000;
  const poolse = usePoolse();

  const [phase, setPhase] = useState<CallPhase>('idle');
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);
  const [outgoing, setOutgoing] = useState<OutgoingCall | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);

  // Held in a ref so the timeout effect can reach the current handlers
  // without re-arming the timer every time one of them is recreated —
  // re-arming would silently extend the ring forever.
  const actionsRef = useRef<{ cancel: () => Promise<void>; decline: () => Promise<void> }>({
    cancel: async () => {},
    decline: async () => {},
  });

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

    // The other side hung up a connected call. Without this the screen
    // stays open on a call that no longer exists.
    const offEnded = calls.onEnded(() => {
      setPhase('idle');
      setIncoming(null);
      setOutgoing(null);
      setActiveConversationId(null);
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
      offEnded();
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

  const accept = useCallback(
    async (call?: IncomingCall) => {
      const target = call ?? incoming;
      if (!calls || !target) return;
      try {
        await calls.accept(target);
        setActiveConversationId(target.conversationId);
        setPhase('active');
        setIncoming(null);
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    },
    [calls, incoming],
  );

  const decline = useCallback(
    async (call?: IncomingCall) => {
      const target = call ?? incoming;
      if (!calls || !target) return;
      try {
        await calls.decline(target);
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        // Local state clears either way: a failed decline shouldn't
        // leave the ring screen stuck on screen.
        setIncoming(null);
        setPhase('idle');
      }
    },
    [calls, incoming],
  );

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

  actionsRef.current = { cancel, decline };

  // Give up on a ring that nobody answered.
  useEffect(() => {
    if (ringTimeoutMs <= 0) return;
    if (phase !== 'ringing-out' && phase !== 'ringing-in') return;

    const outbound = phase === 'ringing-out';
    const timer = setTimeout(() => {
      // Tell the far side before changing local state, so their UI
      // stops ringing too rather than waiting out its own timer.
      void (outbound ? actionsRef.current.cancel() : actionsRef.current.decline()).finally(() => {
        // cancel()/decline() both land on 'idle'; outbound gets a
        // distinct phase so the UI can say "no answer" instead of
        // silently dismissing the call.
        if (outbound) setPhase('timed-out');
      });
    }, ringTimeoutMs);

    return () => clearTimeout(timer);
  }, [phase, ringTimeoutMs]);

  /**
   * End the call and tell the other side.
   *
   * Local state is cleared in `finally` on purpose: a failed signal must
   * never strand the user on a call screen they cannot dismiss.
   */
  const hangUp = useCallback(async () => {
    const conversationId =
      activeConversationId ?? incoming?.conversationId ?? outgoing?.conversationId;
    const callId = incoming?.callId ?? outgoing?.callId;

    try {
      if (!calls || !callId || !conversationId) return;

      if (phase === 'ringing-out' && outgoing) {
        await calls.cancel(outgoing);
      } else if (phase === 'ringing-in' && incoming) {
        await calls.decline(incoming);
      } else if (phase === 'active') {
        await calls.hangUp({ callId, conversationId });
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setPhase('idle');
      setIncoming(null);
      setOutgoing(null);
      setActiveConversationId(null);
    }
  }, [calls, phase, incoming, outgoing, activeConversationId]);

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
    hangUp,
    reset,
  };
}
