// Call quality in plain words (CL15): a connection indicator per person
// comes straight from `CallParticipant.connectionQuality`; this turns
// your own link — LiveKit's quality, the reconnect state and the
// sender's WebRTC stats — into the one sentence a banner shows:
// "Your network is dropping packets, so others may hear you break up."
//
//   const monitor = new CallQualityMonitor(room);
//   const off = monitor.subscribe((report) => setBanner(report.issues[0] ?? null));
//   …
//   off(); monitor.stop();

import type { CallRoom, Unsubscribe } from './call-room.js';
import type { CallConnectionQuality, CallNetworkStats } from './livekit-types.js';

export type CallNetworkIssueKind =
  | 'offline'
  | 'reconnecting'
  | 'connection_lost'
  | 'packet_loss'
  | 'high_latency'
  | 'jitter'
  | 'bandwidth_limited'
  | 'cpu_limited'
  | 'poor_connection';

/** One thing wrong with your connection, worded for the person in the call. */
export interface CallNetworkIssue {
  kind: CallNetworkIssueKind;
  /** `error`: the call is (about to be) broken; `warning`: it degrades. */
  severity: 'warning' | 'error';
  /** A short headline: "Your network is dropping packets". */
  title: string;
  /** What it means for the call and what to try. */
  detail: string;
}

/** What {@link diagnoseCallNetwork} reads. Every field is optional. */
export interface CallNetworkInput {
  /** The browser or phone says it is offline (`navigator.onLine === false`). */
  offline?: boolean;
  reconnecting?: boolean;
  quality?: CallConnectionQuality;
  stats?: CallNetworkStats | null;
}

/** Thresholds, picked where people start to notice. */
export const CALL_NETWORK_THRESHOLDS = {
  /** Share of packets lost: a warning above this… */
  lossWarning: 0.05,
  /** …an error above this. */
  lossError: 0.15,
  rttWarningMs: 400,
  jitterWarningMs: 50,
} as const;

const TEXT: Record<CallNetworkIssueKind, { title: string; detail: string }> = {
  offline: {
    title: 'You are offline',
    detail: 'The call will reconnect by itself when your device is back online.',
  },
  reconnecting: {
    title: 'Reconnecting…',
    detail: 'Your connection dropped. Hold on — the call comes back by itself in a moment.',
  },
  connection_lost: {
    title: 'Your connection is lost',
    detail: 'Others can’t hear or see you right now. Check your Wi-Fi or mobile data.',
  },
  packet_loss: {
    title: 'Your network is dropping packets',
    detail: 'Others may hear you break up. Move closer to your Wi-Fi or use a cable.',
  },
  high_latency: {
    title: 'Your connection is slow',
    detail: 'There is a delay before others hear you. Another app may be using the network.',
  },
  jitter: {
    title: 'Your connection is unsteady',
    detail: 'Your audio may sound choppy. A wired or closer Wi-Fi connection helps.',
  },
  bandwidth_limited: {
    title: 'Your network can’t keep up with video',
    detail: 'Others see you in lower quality. Turn your camera off to keep your voice clear.',
  },
  cpu_limited: {
    title: 'Your device is busy',
    detail: 'Video quality was lowered. Closing other apps or the background effect helps.',
  },
  poor_connection: {
    title: 'Your connection is weak',
    detail: 'Others may hear or see you in lower quality.',
  },
};

function issue(kind: CallNetworkIssueKind, severity: 'warning' | 'error'): CallNetworkIssue {
  return { kind, severity, ...TEXT[kind] };
}

/**
 * Turn your link's readings into what is wrong, worst first — empty when
 * all is well. Pure, so it can run on any platform's numbers (the native
 * core's `connectionQuality` too).
 */
export function diagnoseCallNetwork(input: CallNetworkInput): CallNetworkIssue[] {
  if (input.offline) return [issue('offline', 'error')];
  if (input.reconnecting) return [issue('reconnecting', 'error')];
  if (input.quality === 'lost') return [issue('connection_lost', 'error')];

  const out: CallNetworkIssue[] = [];
  const t = CALL_NETWORK_THRESHOLDS;
  const s = input.stats;
  if (s?.packetLoss != null && s.packetLoss > t.lossWarning) {
    out.push(issue('packet_loss', s.packetLoss > t.lossError ? 'error' : 'warning'));
  }
  if (s?.rttMs != null && s.rttMs > t.rttWarningMs) out.push(issue('high_latency', 'warning'));
  if (s?.jitterMs != null && s.jitterMs > t.jitterWarningMs) out.push(issue('jitter', 'warning'));
  if (s?.limitedBy === 'bandwidth') out.push(issue('bandwidth_limited', 'warning'));
  if (s?.limitedBy === 'cpu') out.push(issue('cpu_limited', 'warning'));
  if (out.length === 0 && input.quality === 'poor') out.push(issue('poor_connection', 'warning'));
  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
}

/** Short label for a participant's link, for a tooltip or a screen reader. */
export function connectionQualityLabel(quality: CallConnectionQuality | undefined): string {
  switch (quality) {
    case 'excellent':
      return 'Excellent connection';
    case 'good':
      return 'Good connection';
    case 'poor':
      return 'Weak connection';
    case 'lost':
      return 'Reconnecting';
    default:
      return 'Connection unknown';
  }
}

/** What {@link CallQualityMonitor} reports on every reading. */
export interface CallQualityReport {
  quality: CallConnectionQuality;
  reconnecting: boolean;
  stats: CallNetworkStats | null;
  /** Worst first; a stats-based issue only once it held for two readings in a row. */
  issues: CallNetworkIssue[];
}

/**
 * Polls one call's own link every `intervalMs` (default 3 s) while
 * someone listens, and reports {@link CallQualityReport}. An issue from
 * the stats must show in two readings in a row before it is reported —
 * one lost burst is not worth a banner. Reconnects and going offline
 * are reported at once.
 */
export class CallQualityMonitor {
  private readonly listeners = new Set<(report: CallQualityReport) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private previous = new Set<CallNetworkIssueKind>();
  private offReconnect: Unsubscribe | null = null;
  private last: CallQualityReport | null = null;

  constructor(
    private readonly room: CallRoom,
    private readonly opts: { intervalMs?: number } = {},
  ) {}

  /** The latest report, or null before the first reading. */
  peek(): CallQualityReport | null {
    return this.last;
  }

  subscribe(fn: (report: CallQualityReport) => void): Unsubscribe {
    this.listeners.add(fn);
    if (this.last) fn(this.last);
    if (!this.timer) this.start();
    return () => {
      this.listeners.delete(fn);
      if (this.listeners.size === 0) this.stop();
    };
  }

  /** Take one reading now (also what the timer runs). */
  async sample(): Promise<CallQualityReport> {
    const stats = await this.room.getNetworkStats();
    const quality = this.room.getConnectionQuality();
    const reconnecting = this.room.isReconnecting();
    const offline =
      typeof globalThis.navigator !== 'undefined' && globalThis.navigator.onLine === false;
    const all = diagnoseCallNetwork({ offline, reconnecting, quality, stats });
    const now = new Set(all.map((i) => i.kind));
    const immediate: CallNetworkIssueKind[] = [
      'offline',
      'reconnecting',
      'connection_lost',
      'poor_connection',
    ];
    const issues = all.filter((i) => immediate.includes(i.kind) || this.previous.has(i.kind));
    this.previous = now;
    const report: CallQualityReport = { quality, reconnecting, stats, issues };
    this.last = report;
    for (const fn of this.listeners) fn(report);
    return report;
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.offReconnect?.();
    this.offReconnect = null;
  }

  private start(): void {
    const every = this.opts.intervalMs ?? 3000;
    this.timer = setInterval(() => void this.sample(), every);
    this.offReconnect = this.room.onReconnecting(() => void this.sample());
    void this.sample();
  }
}
