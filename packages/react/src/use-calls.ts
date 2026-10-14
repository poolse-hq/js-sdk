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
   * Register a ring that arrived by some route other than the socket —
   * in practice a VoIP push.
   *
   * Without this the push path shows a ring the state machine knows
   * nothing about, and every signal that ends a call is guarded on
   * state the machine never had: the caller hanging up sent
   * `call:cancelled`, the guard found no matching `incoming`, and the
   * callee's phone rang on until its own timeout.
   *
   * Idempotent per call id, because the socket almost always delivers
   * the same call a moment later — that is one ring arriving twice, not
   * a second caller.
   */
  ring: (call: IncomingCall) => void;
  /**
   * A call was torn down from outside this state machine.
   *
   * The counterpart to {@link ring}: the caller withdrew, or the call
   * ended, and the news reached this device as a VoIP push rather than
   * over the socket — which is the normal case for a phone that was
   * asleep when the ring arrived and whose socket may not be up yet.
   *
   * Ignores call ids this client is not in, so a teardown for a
   * previous call cannot end the current one.
   */
  dropped: (callId: string) => void;
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
  /**
   * Tell the hook how many OTHER people are currently on the call's
   * media. `hangUp` consults it: with two or more others connected,
   * hanging up just leaves — the call continues without you — and the
   * end-the-call signal is only sent when at most one other remains.
   * Every hang-up path funnels through the hook (the in-call button,
   * CallKit's end event, the OS back gesture), so this is the ONE
   * place group calls are protected from being ended by a leaver.
   */
  reportOthersOnCall: (count: number) => void;
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

  /**
   * Who has said no to the outbound call, and how.
   *
   * A group ring is not over because one person waved it away. Everyone
   * still has a phone ringing, and ending the call on the first refusal
   * hangs up on all of them. So refusals accumulate here and the call
   * only ends once nobody is left who might still pick up.
   *
   * Keyed by user id, so the same person's device sending both a busy
   * and a decline counts once.
   */
  const rejectedRef = useRef<Map<string, 'declined' | 'busy'>>(new Map());

  /**
   * An accept or decline the user made before the socket resource
   * existed.
   *
   * `useCalls(userId)` builds nothing until it has a user id, and the
   * host app gets that from `useMe()` — a network round trip. A VoIP
   * push launches the app cold and CallKit lets the user answer or
   * refuse immediately, which is comfortably before that request comes
   * back. Both actions then hit `if (!calls) return` and were dropped on
   * the floor: the caller was told nothing and rang on.
   */
  const pendingRef = useRef<{ kind: 'accept' | 'decline'; call: IncomingCall } | null>(null);

  // Held in a ref so the timeout effect can reach the current handlers
  // without re-arming the timer every time one of them is recreated —
  // re-arming would silently extend the ring forever.
  const actionsRef = useRef<{ cancel: () => Promise<void>; decline: () => Promise<void> }>({
    cancel: async () => {},
    decline: async () => {},
  });

  const calls = useMemo(() => (userId ? poolse.realtime.calls(userId) : null), [poolse, userId]);

  /**
   * Apply one callee's refusal to an outbound ring.
   *
   * Ends the call only when there is nobody left it could still be
   * answered by — see {@link rejectedRef}. A server that doesn't report
   * who was rung leaves `calleeUserIds` empty, and then the first
   * refusal ends the call, which is the old behaviour and the right
   * fallback: better to hang up early than to ring forever.
   */
  const reject = useCallback((callId: string, userId: string, kind: 'declined' | 'busy') => {
    // Only a ring can be refused. Once somebody has answered, a decline
    // from a member who never joined is them dropping out of a call that
    // is happily going on without them — not the end of it.
    if (phaseRef.current !== 'ringing-out') return;

    const out = outgoingRef.current;
    if (!out || out.callId !== callId) return;

    rejectedRef.current.set(userId, kind);

    const outstanding = out.calleeUserIds.filter((id) => !rejectedRef.current.has(id));
    if (out.calleeUserIds.length > 0 && outstanding.length > 0) return;

    // "Busy" and "declined" are different sentences to show the user, so
    // a call that everybody was busy for says so; any outright refusal
    // makes it a decline.
    const allBusy = [...rejectedRef.current.values()].every((k) => k === 'busy');
    setPhase(allBusy ? 'busy' : 'declined');
    setOutgoing(null);
    setActiveCallId(null);
    setActiveMedia(null);
  }, []);

  useEffect(() => {
    if (!calls) return;

    const offIncoming = calls.onIncoming((call) => {
      // The same ring arriving by both routes. A VoIP push gets here
      // first and `ring()` recorded it; the socket then delivers the
      // identical call. Treating that as a second caller would answer
      // the user's own call with `call:busy`.
      if (call.callId === incomingRef.current?.callId) return;
      if (call.callId === activeCallIdRef.current) return;

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
      reject(call.callId, call.userId, 'declined');
    });

    const offBusy = calls.onBusy((call) => {
      if (!isCurrent(call.callId)) return;
      reject(call.callId, call.userId, 'busy');
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
  }, [calls, isCurrent, reject]);

  /**
   * Send whatever the user decided before the socket was ready.
   *
   * Runs the moment `calls` exists — see {@link pendingRef}. The local
   * state was already moved when the action was taken, so this is purely
   * about telling the other side.
   */
  useEffect(() => {
    if (!calls) return;
    const queued = pendingRef.current;
    if (!queued) return;
    pendingRef.current = null;

    const sent = queued.kind === 'accept' ? calls.accept(queued.call) : calls.decline(queued.call);
    void sent.catch((err: unknown) => {
      setError(err instanceof Error ? err : new Error(String(err)));
    });
  }, [calls]);

  const call = useCallback(
    async (conversationId: string, media: CallMedia = 'audio') => {
      if (!calls) return;
      setError(null);
      // A fresh ring, so nobody has refused it yet. Left over from the
      // previous call, one stale entry could end this one early.
      rejectedRef.current = new Map();
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

  /**
   * Record a ring that reached us outside the socket. See {@link
   * UseCalls.ring}.
   */
  const ring = useCallback((call: IncomingCall) => {
    // Already showing it, or already in it. Both mean this is the same
    // call arriving twice rather than anything new.
    if (incomingRef.current?.callId === call.callId) return;
    if (activeCallIdRef.current === call.callId) return;
    // Deliberately silent when busy: the socket's `onIncoming` is what
    // sends `call:busy`, and doing it here too would send it twice.
    if (phaseRef.current !== 'idle') return;

    setIncoming(call);
    setPhase('ringing-in');
  }, []);

  /** See {@link UseCalls.dropped}. */
  const dropped = useCallback(
    (callId: string) => {
      // Whatever was waiting to be sent about THIS call is moot — there
      // is no longer a call to accept or refuse. Checked before the
      // guard below, because taking the action already cleared the
      // state that guard reads: a decline made before the socket was up
      // leaves nothing behind but the queued signal itself.
      if (pendingRef.current?.call.callId === callId) pendingRef.current = null;

      if (!isCurrent(callId)) return;
      rejectedRef.current = new Map();
      setPhase('idle');
      setIncoming(null);
      setOutgoing(null);
      setActiveConversationId(null);
      setActiveCallId(null);
      setActiveMedia(null);
    },
    [isCurrent],
  );

  const accept = useCallback(
    async (call?: IncomingCall) => {
      const target = call ?? incoming;
      if (!target) return;

      // Answered before the socket resource exists — hold it and send it
      // the moment there is somewhere to send it to. Local state still
      // moves, so the UI follows the user rather than the network.
      if (!calls) {
        pendingRef.current = { kind: 'accept', call: target };
        setActiveConversationId(target.conversationId);
        setActiveCallId(target.callId);
        setActiveMedia(target.media);
        setPhase('active');
        setIncoming(null);
        return;
      }

      // Local state moves FIRST — the UI follows the user's answer, not
      // the network. Waiting for the server's reply before showing the
      // call meant a slow ack stranded the user on the ring screen with
      // a red "timed out" while the call was in fact connecting.
      setActiveConversationId(target.conversationId);
      // Recorded BEFORE `incoming` is cleared — it is the only thing
      // that will still know which call this is once the ring state
      // is gone, and it is what `hangUp` needs to tell the other side.
      setActiveCallId(target.callId);
      setActiveMedia(target.media);
      setPhase('active');
      setIncoming(null);

      try {
        await calls.accept(target);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // A TIMEOUT is not a verdict: the server usually processed the
        // accept and only the ack was lost. The call proves itself —
        // media connects, or the alone-watch ends it. Showing an error
        // over a working call taught people to ignore errors.
        if (message.includes('timed out')) return;
        // An explicit rejection IS a verdict — the call is gone
        // (withdrawn, rung out, hung up). Stand down.
        setPhase('idle');
        setActiveConversationId(null);
        setActiveCallId(null);
        setActiveMedia(null);
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    },
    [calls, incoming],
  );

  const decline = useCallback(
    async (call?: IncomingCall) => {
      const target = call ?? incoming;
      if (!target) return;

      // Same as `accept`: refusing a call before the socket is up must
      // still reach the caller, or their phone rings until it times out.
      if (!calls) {
        pendingRef.current = { kind: 'decline', call: target };
        setIncoming(null);
        setActiveCallId(null);
        setActiveMedia(null);
        setPhase('idle');
        return;
      }

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
  const othersOnCallRef = useRef(0);
  const reportOthersOnCall = useCallback((count: number) => {
    othersOnCallRef.current = count;
  }, []);

  const hangUp = useCallback(async () => {
    // Leaving a GROUP call is not ending it: walk out quietly and the
    // others keep talking. The signal that tears the call down for
    // everyone is reserved for the last pair.
    if (phaseRef.current === 'active' && othersOnCallRef.current >= 2) {
      setPhase('idle');
      setIncoming(null);
      setOutgoing(null);
      setActiveConversationId(null);
      setActiveCallId(null);
      setActiveMedia(null);
      setError(null);
      return;
    }
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
    rejectedRef.current = new Map();
    pendingRef.current = null;
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
    ring,
    dropped,
    accept,
    decline,
    cancel,
    hangUp,
    reportOthersOnCall,
    reset,
  };
}
