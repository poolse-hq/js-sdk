// Voice messages (MS15) and video messages (MS16): a recorder and players
// with 1×, 1.5× and 2× and the transcript Soniox made on the server
// (`attachment.transcript`, `summary`). Same props in @poolse/react-native.
//
//     <VoiceRecorder onRecorded={async (blob, ms) => {
//       const a = await chat.attachments.upload({ body: blob, contentType: blob.type,
//         byteSize: blob.size, purpose: 'voice', durationMs: ms });
//       await send({ attachment_ids: [a.id] });
//     }} />
//     <VoiceMessagePlayer src={url} attachment={a} />

import type { Attachment } from '@poolse/sdk';
import { VIDEO_MESSAGE_MAX_MS, formatClock } from '@poolse/sdk';
import { nextPlaybackRate, playbackRateLabel, waveformBars } from '@poolse/react';
import { useEffect, useRef, useState } from 'react';
import { PoolseIcon } from './PoolseIcon.js';

function usePlayback(ref: React.RefObject<HTMLMediaElement | null>) {
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sync = () => {
      setPlaying(!el.paused && !el.ended);
      setTime(el.currentTime * 1000);
      if (Number.isFinite(el.duration)) setDuration(el.duration * 1000);
    };
    const evts = ['play', 'pause', 'ended', 'timeupdate', 'loadedmetadata', 'durationchange'];
    for (const e of evts) el.addEventListener(e, sync);
    return () => {
      for (const e of evts) el.removeEventListener(e, sync);
    };
  }, [ref]);
  return {
    playing,
    time,
    duration,
    rate,
    toggle: () => {
      const el = ref.current;
      if (!el) return;
      if (el.paused) void el.play().catch(() => undefined);
      else el.pause();
    },
    cycleRate: () => {
      const next = nextPlaybackRate(rate);
      setRate(next);
      if (ref.current) ref.current.playbackRate = next;
    },
    seek: (ms: number) => {
      if (ref.current) ref.current.currentTime = ms / 1000;
    },
  };
}

function TranscriptBlock({ attachment }: { attachment?: Attachment | null }) {
  const [open, setOpen] = useState(false);
  if (!attachment) return null;
  const status = attachment.transcript_status;
  if (status === 'pending')
    return <div className="poolse-media__transcript-status">Transcribing…</div>;
  if (!attachment.transcript) return null;
  return (
    <div className="poolse-media__transcript">
      <button
        type="button"
        className="poolse-media__transcript-toggle"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? 'Hide transcript' : 'Show transcript'}
      </button>
      {open && <p className="poolse-media__transcript-text">{attachment.transcript}</p>}
    </div>
  );
}

export interface VoiceMessagePlayerProps {
  /** A playable URL (`chat.attachments.downloadUrl`). */
  src: string;
  /** For the duration (when the file has none yet) and the transcript. */
  attachment?: Attachment | null;
  /** Amplitude samples 0–1 for the waveform, if the app has them. */
  waveform?: readonly number[];
  className?: string;
}

export function VoiceMessagePlayer({
  src,
  attachment,
  waveform,
  className,
}: VoiceMessagePlayerProps) {
  const ref = useRef<HTMLAudioElement | null>(null);
  const p = usePlayback(ref);
  const total = p.duration || attachment?.duration_ms || 0;
  const bars = waveformBars(waveform ?? [], 32);
  const progress = total > 0 ? p.time / total : 0;
  return (
    <div className={['poolse-media poolse-voice', className].filter(Boolean).join(' ')}>
      <audio ref={ref} src={src} preload="metadata" />
      <div className="poolse-voice__row">
        <button
          type="button"
          className="poolse-media__play"
          onClick={p.toggle}
          aria-label={p.playing ? 'Pause' : 'Play voice message'}
        >
          <span aria-hidden="true">{p.playing ? '❚❚' : '▶'}</span>
        </button>
        <div
          className="poolse-voice__wave"
          role="slider"
          tabIndex={0}
          aria-label="Position"
          aria-valuemin={0}
          aria-valuemax={Math.round(total / 1000)}
          aria-valuenow={Math.round(p.time / 1000)}
          aria-valuetext={formatClock(p.time)}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            if (r.width > 0) p.seek(((e.clientX - r.left) / r.width) * total);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') p.seek(Math.min(total, p.time + 5000));
            if (e.key === 'ArrowLeft') p.seek(Math.max(0, p.time - 5000));
          }}
        >
          {bars.map((h, i) => (
            <span
              key={i}
              className={`poolse-voice__bar${i / bars.length < progress ? ' poolse-voice__bar--played' : ''}`}
              style={{ height: `${Math.round(h * 100)}%` }}
            />
          ))}
        </div>
        <span className="poolse-media__time">
          {formatClock(p.playing || p.time > 0 ? p.time : total)}
        </span>
        <button
          type="button"
          className="poolse-media__rate"
          onClick={p.cycleRate}
          aria-label={`Playback speed ${playbackRateLabel(p.rate)}`}
        >
          {playbackRateLabel(p.rate)}
        </button>
      </div>
      <TranscriptBlock attachment={attachment ?? null} />
    </div>
  );
}

export interface VideoMessagePlayerProps {
  src: string;
  /** Thumbnail URL (`chat.attachments.thumbnailUrl`). */
  poster?: string;
  attachment?: Attachment | null;
  className?: string;
}

/** A video message with its short summary, the transcript and 1×/1.5×/2×. */
export function VideoMessagePlayer({
  src,
  poster,
  attachment,
  className,
}: VideoMessagePlayerProps) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const p = usePlayback(ref);
  return (
    <div className={['poolse-media poolse-video', className].filter(Boolean).join(' ')}>
      <video
        ref={ref}
        src={src}
        poster={poster}
        controls
        playsInline
        preload="metadata"
        className="poolse-video__el"
      />
      <div className="poolse-video__bar">
        <span className="poolse-media__time">
          {formatClock(p.time)} / {formatClock(p.duration || attachment?.duration_ms || 0)}
        </span>
        <button
          type="button"
          className="poolse-media__rate"
          onClick={p.cycleRate}
          aria-label={`Playback speed ${playbackRateLabel(p.rate)}`}
        >
          {playbackRateLabel(p.rate)}
        </button>
      </div>
      {attachment?.summary && <p className="poolse-video__summary">{attachment.summary}</p>}
      <TranscriptBlock attachment={attachment ?? null} />
    </div>
  );
}

export interface VoiceRecorderProps {
  /** The finished recording (webm/opus or mp4/aac, whatever the browser makes) and its length. */
  onRecorded: (blob: Blob, durationMs: number) => void | Promise<unknown>;
  /** Longest recording; it stops by itself. Default 15 minutes. */
  maxMs?: number;
  /** Record video (a video message, MS16) instead of audio. Capped at 5 minutes. */
  video?: boolean | 'screen';
  disabled?: boolean;
  onError?: (err: unknown) => void;
}

/** Press to record, press again to send; Cancel throws it away. MediaRecorder-based. */
export function VoiceRecorder({
  onRecorded,
  maxMs,
  video = false,
  disabled,
  onError,
}: VoiceRecorderProps) {
  const limit = Math.min(maxMs ?? 15 * 60_000, video ? VIDEO_MESSAGE_MAX_MS : Infinity);
  const [state, setState] = useState<'idle' | 'recording' | 'sending'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const rec = useRef<{
    mr: MediaRecorder;
    stream: MediaStream;
    chunks: Blob[];
    start: number;
    cancel: boolean;
  } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTracks = () => rec.current?.stream.getTracks().forEach((t) => t.stop());
  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
      if (rec.current) {
        rec.current.cancel = true;
        if (rec.current.mr.state !== 'inactive') rec.current.mr.stop();
        stopTracks();
      }
    },
    [],
  );

  const start = async () => {
    try {
      const md = navigator.mediaDevices;
      const stream =
        video === 'screen'
          ? await md.getDisplayMedia({ video: true, audio: true })
          : await md.getUserMedia(video ? { audio: true, video: true } : { audio: true });
      const mr = new MediaRecorder(stream);
      const r = { mr, stream, chunks: [] as Blob[], start: Date.now(), cancel: false };
      rec.current = r;
      mr.ondataavailable = (e) => e.data.size > 0 && r.chunks.push(e.data);
      mr.onstop = () => {
        if (timer.current) clearInterval(timer.current);
        stopTracks();
        const ms = Date.now() - r.start;
        rec.current = null;
        if (r.cancel || r.chunks.length === 0) {
          setState('idle');
          return;
        }
        const blob = new Blob(r.chunks, { type: mr.mimeType || r.chunks[0]!.type });
        setState('sending');
        void Promise.resolve(onRecorded(blob, ms))
          .catch((err: unknown) => onError?.(err))
          .finally(() => setState('idle'));
      };
      mr.start(250);
      setElapsed(0);
      setState('recording');
      timer.current = setInterval(() => {
        const ms = Date.now() - r.start;
        setElapsed(ms);
        if (ms >= limit && mr.state === 'recording') mr.stop();
      }, 200);
    } catch (err) {
      setState('idle');
      onError?.(err);
    }
  };
  const stop = (cancel: boolean) => {
    const r = rec.current;
    if (!r) return;
    r.cancel = cancel;
    if (r.mr.state !== 'inactive') r.mr.stop();
  };

  const what = video === 'screen' ? 'screen' : video ? 'video' : 'voice message';
  if (state === 'recording') {
    return (
      <div
        className="poolse-recorder poolse-recorder--on"
        role="group"
        aria-label={`Recording ${what}`}
      >
        <span className="poolse-recorder__dot" aria-hidden="true" />
        <span className="poolse-media__time" aria-live="off">
          {formatClock(elapsed)}
          {Number.isFinite(limit) ? ` / ${formatClock(limit)}` : ''}
        </span>
        <button type="button" className="poolse-recorder__cancel" onClick={() => stop(true)}>
          Cancel
        </button>
        <button
          type="button"
          className="poolse-recorder__send"
          onClick={() => stop(false)}
          aria-label={`Send ${what}`}
        >
          <PoolseIcon name="send-fill" size={16} label={null} />
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      className="poolse-composer__attach poolse-recorder"
      onClick={() => void start()}
      disabled={disabled || state === 'sending'}
      aria-label={`Record ${what}`}
      title={`Record ${what}`}
    >
      <PoolseIcon name={video ? 'video' : 'mic'} size={20} label={null} />
    </button>
  );
}
