/**
 * WhatsApp-style call invitations.
 *
 * {@link VoiceRoom} is room-shaped: you're only reachable once you've
 * already joined. Ringing somebody who is sitting idle needs a channel
 * they're always on, which is their own `user:<id>` topic — so that's
 * where the invite half of a call lives.
 *
 *     const call = await poolse.calls.invite(conversationId);
 *     // …callee's client fires onIncoming, shows a ring screen…
 *     poolse.calls.onAccepted(({ callId }) => {
 *       if (callId === call.callId) void room.join();
 *     });
 *
 * Media never touches this class. Once both sides have accepted they
 * join the voice room and negotiate exactly as the Discord-style flow
 * does.
 *
 * There is no ring timeout here on purpose: only the UI knows when it
 * gave up, and it can call {@link cancel} at that point.
 */

import type { Channel } from 'phoenix';

import { PoolseError } from '../errors.js';
import type {
  CallAccepted,
  CallBusy,
  CallCancelled,
  CallDeclined,
  CallEnded,
  IncomingCall,
  OutgoingCall,
} from './types.js';

export type Unsubscribe = () => void;

/** Wire shapes, snake_case as the server sends them. */
interface WireIncoming {
  call_id: string;
  conversation_id: string;
  caller_user_id: string;
}
interface WireParty {
  call_id: string;
  conversation_id: string;
  user_id: string;
}
interface WireInviteReply {
  call_id: string;
  conversation_id: string;
  callee_user_ids?: string[];
}

export class CallsResource {
  /** Resolves the user channel lazily — it may not be joined yet. */
  private readonly getChannel: () => Channel;

  private readonly incoming = new Set<(c: IncomingCall) => void>();
  private readonly accepted = new Set<(c: CallAccepted) => void>();
  private readonly declined = new Set<(c: CallDeclined) => void>();
  private readonly busy = new Set<(c: CallBusy) => void>();
  private readonly cancelled = new Set<(c: CallCancelled) => void>();
  private readonly ended = new Set<(c: CallEnded) => void>();

  private bound = false;

  constructor(getChannel: () => Channel) {
    this.getChannel = getChannel;
  }

  // ── placing and answering ──────────────────────────────────────────

  /**
   * Ring every other member of a conversation. Resolves once the server
   * has fanned the invite out, with the minted call id and who was rung
   * — not when anyone answers; that arrives via {@link onAccepted}.
   */
  invite(conversationId: string): Promise<OutgoingCall> {
    return this.request<WireInviteReply>('call:invite', {
      conversation_id: conversationId,
    }).then((reply) => ({
      callId: reply.call_id,
      conversationId: reply.conversation_id,
      calleeUserIds: reply.callee_user_ids ?? [],
    }));
  }

  /**
   * Answer a ringing call. This only tells the caller you picked up —
   * join the voice room yourself to actually connect audio.
   */
  async accept(call: IncomingCall): Promise<void> {
    await this.request('call:accept', {
      call_id: call.callId,
      conversation_id: call.conversationId,
      caller_user_id: call.callerUserId,
    });
  }

  /** Reject a ringing call without joining the room. */
  async decline(call: IncomingCall): Promise<void> {
    await this.request('call:decline', {
      call_id: call.callId,
      conversation_id: call.conversationId,
      caller_user_id: call.callerUserId,
    });
  }

  /**
   * Tell the caller you are already on another call.
   *
   * Distinct from {@link decline}: nobody chose anything, so clients
   * send this automatically when a ring arrives mid-call. `useCalls`
   * does it for you.
   */
  async markBusy(call: IncomingCall): Promise<void> {
    await this.request('call:busy', {
      call_id: call.callId,
      conversation_id: call.conversationId,
      caller_user_id: call.callerUserId,
    });
  }

  /**
   * End a call that is already connected.
   *
   * Distinct from {@link cancel}, which withdraws an unanswered invite.
   * Without this a connected call has no end signal, so hanging up
   * leaves the other side sitting in the room with a call screen it has
   * no reason to close.
   */
  async hangUp(call: { callId: string; conversationId: string }): Promise<void> {
    await this.request('call:hangup', {
      call_id: call.callId,
      conversation_id: call.conversationId,
    });
  }

  /** Withdraw an invite you placed — hung up before anyone answered. */
  async cancel(call: OutgoingCall): Promise<void> {
    await this.request('call:cancel', {
      call_id: call.callId,
      conversation_id: call.conversationId,
    });
  }

  // ── subscriptions ──────────────────────────────────────────────────

  /** Somebody is ringing you. */
  onIncoming(fn: (call: IncomingCall) => void): Unsubscribe {
    this.bind();
    this.incoming.add(fn);
    return () => this.incoming.delete(fn) as unknown as void;
  }

  /** Your outbound call was answered — join the room now. */
  onAccepted(fn: (call: CallAccepted) => void): Unsubscribe {
    this.bind();
    this.accepted.add(fn);
    return () => this.accepted.delete(fn) as unknown as void;
  }

  /** Your outbound call was rejected. */
  onDeclined(fn: (call: CallDeclined) => void): Unsubscribe {
    this.bind();
    this.declined.add(fn);
    return () => this.declined.delete(fn) as unknown as void;
  }

  /** The person you called is already on another call. */
  onBusy(fn: (call: CallBusy) => void): Unsubscribe {
    this.bind();
    this.busy.add(fn);
    return () => this.busy.delete(fn) as unknown as void;
  }

  /** The other side ended a connected call. */
  onEnded(fn: (call: CallEnded) => void): Unsubscribe {
    this.bind();
    this.ended.add(fn);
    return () => this.ended.delete(fn) as unknown as void;
  }

  /** An inbound ring was withdrawn before you answered. */
  onCancelled(fn: (call: CallCancelled) => void): Unsubscribe {
    this.bind();
    this.cancelled.add(fn);
    return () => this.cancelled.delete(fn) as unknown as void;
  }

  // ── internals ──────────────────────────────────────────────────────

  /**
   * One Phoenix binding per event regardless of listener count; we fan
   * out ourselves, matching how the conversation channels do it.
   */
  private bind(): void {
    if (this.bound) return;
    this.bound = true;
    const channel = this.getChannel();

    channel.on('call:incoming', (p: WireIncoming) => {
      const call: IncomingCall = {
        callId: p.call_id,
        conversationId: p.conversation_id,
        callerUserId: p.caller_user_id,
      };
      this.incoming.forEach((l) => l(call));
    });

    channel.on('call:accepted', (p: WireParty) => {
      const call: CallAccepted = {
        callId: p.call_id,
        conversationId: p.conversation_id,
        userId: p.user_id,
      };
      this.accepted.forEach((l) => l(call));
    });

    channel.on('call:declined', (p: WireParty) => {
      const call: CallDeclined = {
        callId: p.call_id,
        conversationId: p.conversation_id,
        userId: p.user_id,
      };
      this.declined.forEach((l) => l(call));
    });

    channel.on('call:busy', (p: WireParty) => {
      const call: CallBusy = {
        callId: p.call_id,
        conversationId: p.conversation_id,
        userId: p.user_id,
      };
      this.busy.forEach((l) => l(call));
    });

    channel.on('call:ended', (p: WireParty) => {
      const call: CallEnded = {
        callId: p.call_id,
        conversationId: p.conversation_id,
        userId: p.user_id,
      };
      this.ended.forEach((l) => l(call));
    });

    channel.on('call:cancelled', (p: WireIncoming) => {
      const call: CallCancelled = {
        callId: p.call_id,
        conversationId: p.conversation_id,
        callerUserId: p.caller_user_id,
      };
      this.cancelled.forEach((l) => l(call));
    });
  }

  private request<T>(event: string, payload: Record<string, unknown>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.getChannel()
        .push(event, payload)
        .receive('ok', (reply: T) => resolve(reply))
        .receive('error', (reply: { reason?: string }) =>
          reject(new PoolseError(`${event} rejected: ${reply?.reason ?? 'unknown'}`)),
        )
        .receive('timeout', () => reject(new PoolseError(`${event} timed out`)));
    });
  }
}
