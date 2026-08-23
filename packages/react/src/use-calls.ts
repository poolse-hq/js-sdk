import type { CallMedia, IncomingCall, OutgoingCall } from '@poolse/sdk';
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
  /**
   * What the current call opened as.
   *
   * `'audio'` when nothing is in flight. Either side can still turn
   * their camera on mid-call — this is what was rung, which is what the
   * incoming UI has to commit to before the user answers.
   */
  media: CallMedia;
  error: Error | null;
  /** Ring every other member of a conversation. */
  call: (conversationId: string, media?: CallMedia) => Promise<void>;
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

  // The phase as of the last render, readable from a socket callback
  // without making every subscription depend on it — re-subscribing on
  // each phase change would drop events in the gap.
  const phaseRef = useRef<CallPhase>('idle');
  phaseRef.current = phase;
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);
  const [outgoing, setOutgoing] = useState<OutgoingCall | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  /**
   * The id of the call this client is in, once it is in one.
   *
   * Tracked separately because neither `incoming` nor `outgoing`
   * survives being answered — `accept()` clears `incoming`, and a callee
   * never had an `outgoing`. Without this the callee's `hangUp()` had no
   * call id at all and returned before sending anything, so answering a
   * call meant you could never end it for the other side: they sat in a
   * call the app had already left.
   *
   * It is also what makes the socket handlers below able to tell a
   * signal about THIS call from a late one about a previous call.
   */
  const [activeCallId, setActiveCallId] = useState<string | null>(null);

  /**
   * What the call in progress opened as.
   *
   * Tracked for the same reason as {@link activeCallId}: `accept()`
   * clears `incoming`, and a callee never had an `outgoing`, so once a
   * call was answered there was nothing left to read the media type
   * from and it fell back to `'audio'`. The callee's room was then
   * built for an audio call and never opened the camera — so on a video
   * call the caller's camera came on and the callee's did not, which
   * reads as the default being random when it is really "whichever end
   * you were on".
   */
  const [activeMedia, setActiveMedia] = useState<CallMedia | null>(null);
  const [error, setError] = useState<Error | null>(null);

  // Same reason as `phaseRef`: the handlers are bound once, and must be
  // able to ask "is this signal about the call I am in?" without
  // re-subscribing on every state change.
  const incomingRef = useRef<IncomingCall | null>(null);
  incomingRef.current = incoming;
  const outgoingRef = useRef<OutgoingCall | null>(null);
  outgoingRef.current = outgoing;
  const activeCallIdRef = useRef<string | null>(null);
  activeCallIdRef.current = activeCallId;

  /** Is this signal about the call this client is currently in? */
  const isCurrent = useCallback((callId: string) => {
    return (
      callId === activeCallIdRef.current ||
      callId === incomingRef.current?.callId ||
      callId === outgoingRef.current?.callId
    );
  }, []);

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
      //
      // The decision reads a ref rather than a `setPhase` updater.
      // Updaters must be pure: React runs them during render and may run
      // them more than once, so sending `call:busy` from inside one
      // could reject a call the user was in fact being shown — and did,
      // under StrictMode's double-invoke.
      if (phaseRef.current !== 'idle') {
        void calls.markBusy(call).catch(() => {
          // Best effort: failing to send busy just degrades to the old
          // silence, which must not break the call in progress.
        });
        return;
      }
      setIncoming(call);
      setPhase('ringing-in');
    });

    // Every handler below is guarded on the call id. A signal that
    // arrives late, or belongs to a call this client already finished
    // with, must not touch the call it is in now — that is how a live
    // call ended up being torn down by a `call:cancelled` for a
    // different one.

    const offAccepted = calls.onAccepted((call) => {
      // Only our own outbound call. Nothing else should move us into a
      // call we did not place.
      if (outgoingRef.current && call.callId !== outgoingRef.current.callId) return;
      setPhase('active');
      setActiveConversationId(call.conversationId);
      setActiveCallId(call.callId);
    });

    const offDeclined = calls.onDeclined((call) => {
      if (!isCurrent(call.callId)) return;
      setPhase('declined');
      setOutgoing(null);
      setActiveCallId(null);
      setActiveMedia(null);
    });

    const offBusy = calls.onBusy((call) => {
      if (!isCurrent(call.callId)) return;
      setPhase('busy');
      setOutgoing(null);
      setActiveCallId(null);
      setActiveMedia(null);
    });

    // The other side hung up a connected call. Without this the screen
    // stays open on a call that no longer exists.
    const offEnded = calls.onEnded((call) => {
      if (!isCurrent(call.callId)) return;
      setPhase('idle');
      setIncoming(null);
      setOutgoing(null);
      setActiveConversationId(null);
      setActiveCallId(null);
      setActiveMedia(null);
    });

    const offCancelled = calls.onCancelled((call) => {
      // Strictly the ring we are showing.
      //
      // This used to fall through to `setPhase('idle')` whenever
      // `incoming` was null — which is precisely the state `accept()`
      // leaves behind. A caller's ring timeout firing as the callee
      // answered would then drop the callee straight out of the call
      // they had just joined, leaving media running with no UI.
      if (call.callId !== incomingRef.current?.callId) return;
      setIncoming(null);
      setPhase('idle');
      setActiveCallId(null);
      setActiveMedia(null);
    });

    return () => {
      offIncoming();
      offAccepted();
      offDeclined();
      offBusy();
      offEnded();
      offCancelled();
    };
  }, [calls, isCurrent]);

  const call = useCallback(
    async (conversationId: string, media: CallMedia = 'audio') => {
      if (!calls) return;
      setError(null);
      try {
        const placed = await calls.invite(conversationId, media);
        setOutgoing(placed);
        setActiveCallId(placed.callId);
        setActiveMedia(placed.media);
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
        // Recorded BEFORE `incoming` is cleared — it is the only thing
        // that will still know which call this is once the ring state
        // is gone, and it is what `hangUp` needs to tell the other side.
        setActiveCallId(target.callId);
        setActiveMedia(target.media);
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
        setActiveCallId(null);
        setActiveMedia(null);
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
      setActiveCallId(null);
      setActiveMedia(null);
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
    // `activeCallId` first, and that is the whole fix: answering a call
    // clears `incoming`, and a callee never had an `outgoing`, so this
    // used to resolve to undefined and return before signalling. The
    // caller was left in a call the callee had already walked out of.
    const callId = activeCallId ?? incoming?.callId ?? outgoing?.callId;

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
      setActiveCallId(null);
      setActiveMedia(null);
    }
  }, [calls, phase, incoming, outgoing, activeConversationId, activeCallId]);

  const reset = useCallback(() => {
    setPhase('idle');
    setIncoming(null);
    setOutgoing(null);
    setActiveConversationId(null);
    setActiveCallId(null);
    setActiveMedia(null);
    setError(null);
  }, []);

  // Whichever end we are: the callee learns it from the ring, the
  // caller from the invite it placed, and `activeMedia` carries it
  // through being answered — the point at which both of the other two
  // can be gone. Idle reports audio rather than holding the last call's
  // value, so a fresh audio call can never inherit video from the one
  // before it.
  const media: CallMedia = incoming?.media ?? outgoing?.media ?? activeMedia ?? 'audio';

  return {
    phase,
    incoming,
    outgoing,
    activeConversationId,
    media,
    error,
    call,
    accept,
    decline,
    cancel,
    hangUp,
    reset,
  };
}
