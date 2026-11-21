// Call recording, consent and transcripts (the server's docs/RECORDING.md).
//
//   poolse.calls.recording.start(callId, { mode: 'audio' })
//   poolse.calls.recording.stop(callId)
//   poolse.calls.consent(callId, 'accepted')
//   poolse.calls.transcription.start(callId)
//   poolse.calls.transcript.get(callId)
//
// State changes reach everyone with the conversation open as
// `recording:*` / `transcript:*` events (`ConversationChannel.onRecording…`),
// and every call snapshot (`LiveCall.recording`, `.transcription`) carries
// the current state, so someone joining late sees it at once. The live
// transcript has its own topic: `poolse.realtime.transcript(callId)`.

import type { RestClient } from '../rest-client.js';

export type RecordingMode = 'video' | 'audio';
export type RecordingStatus = 'starting' | 'recording' | 'stopping' | 'ready' | 'failed';
export type ConsentDecision = 'accepted' | 'declined';
/** Where a recording or transcript file was stored: the server's storage or the tenant's own bucket. */
export type CaptureStorage = 'server' | 'own';

/** One recording of a call. */
export interface Recording {
  id: string;
  call_id: string;
  conversation_id: string;
  status: RecordingStatus;
  mode: RecordingMode;
  /** Started by the conversation's auto-record setting, not a person. */
  auto: boolean;
  /** Nobody's media is captured until they accept (`calls.consent`). */
  consent_required: boolean;
  started_by_user_id: string | null;
  /** Resolved on lists; `null` for auto-record and on event payloads. */
  started_by: { user_id: string; external_id: string | null; display_name: string | null } | null;
  stopped_by_user_id: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_ms: number | null;
  size_bytes: number | null;
  content_type: string | null;
  storage: CaptureStorage;
  /**
   * Chapters (RT13), recording time, from the summary's moments; empty
   * until the summary is ready. Read with `chaptersOf(recording)`.
   */
  chapters?: Array<{ title: string; start_ms: number; end_ms?: number | null }>;
  /** Stretches without speech (not sent by the server yet); `silencesOf(recording)`. */
  silences?: Array<{ start_ms: number; end_ms: number }>;
}

/** A call snapshot's recording state (`LiveCall.recording`). */
export interface CallRecordingState {
  /** This server can record at all (LiveKit Egress set up). Hide the Record button when false. */
  available: boolean;
  active: boolean;
  id: string | null;
  mode: RecordingMode | null;
  started_at: string | null;
  started_by_user_id: string | null;
  auto: boolean;
  /** True: whoever hasn't accepted may not publish until they do. */
  consent_required: boolean;
  /** Who answered so far, for this call. */
  consent: { accepted: string[]; declined: string[] };
}

/** A call snapshot's transcript state (`LiveCall.transcription`). */
export interface CallTranscriptionState {
  /** Transcription is set up on this server (Soniox). False on offline installs. */
  available: boolean;
  /** A live transcript is running. */
  active: boolean;
  id: string | null;
  status: TranscriptStatus | null;
  language: string | null;
}

/** `calls.consent` reply. */
export interface ConsentResult {
  call_id: string;
  user_id: string;
  decision: ConsentDecision;
}

/** A short-lived (5 minute) link to a finished recording's file. */
export interface RecordingDownload {
  url: string;
  expires_at: string;
  content_type: string | null;
  size_bytes: number | null;
}

export type WhoMayRecord = 'admins' | 'members' | 'nobody';
export type ConsentPolicy = 'notice' | 'required';

/**
 * A conversation's recording settings. `who_may_record` and `consent` may
 * only be stricter than the workspace's; `effective` is what applies.
 */
export interface ConversationRecordingSettings {
  auto_record: boolean;
  auto_transcribe: boolean;
  mode: RecordingMode | null;
  /** The room's language (ISO 639-1), for transcription and the spoken notice. */
  language: string | null;
  who_may_record: WhoMayRecord | null;
  consent: ConsentPolicy | null;
  effective: {
    enabled?: boolean;
    who_may_record?: WhoMayRecord;
    consent?: ConsentPolicy;
    mode?: RecordingMode;
    live_transcription?: boolean;
    transcribe_recordings?: boolean;
    [key: string]: unknown;
  };
  recording_available: boolean;
  transcription_available: boolean;
}

export type ConversationRecordingSettingsUpdate = Partial<
  Pick<
    ConversationRecordingSettings,
    'auto_record' | 'auto_transcribe' | 'mode' | 'language' | 'who_may_record' | 'consent'
  >
>;

export type TranscriptStatus = 'live' | 'stopped' | 'ready';

/** A call's transcript, without its text. */
export interface Transcript {
  id: string;
  call_id: string;
  conversation_id: string;
  /** `live` while it runs, `stopped` when paused (starting again resumes it), `ready` once the call is over. */
  status: TranscriptStatus;
  /** What started it: someone opening it live, a recording, or the room's auto-transcribe. */
  source: 'live' | 'recording' | 'auto';
  language: string | null;
  started_at: string | null;
  ended_at: string | null;
  segment_count: number;
  /** `null` until a finished copy is stored. */
  storage: CaptureStorage | null;
}

/** Someone who spoke in a transcript, with the name to show. */
export interface TranscriptSpeaker {
  /** The LiveKit identity — the poolse user id for people. Key for `renameSpeakers`. */
  key: string;
  user_id: string | null;
  external_id: string | null;
  /** The corrected name if someone renamed them, else their own. */
  name: string | null;
  /** Someone renamed this speaker. */
  corrected: boolean;
}

/** One stretch of speech. */
export interface TranscriptSegment {
  /** The speaker's key (see `TranscriptSpeaker.key`). */
  speaker: string;
  speaker_user_id: string | null;
  speaker_name: string | null;
  text: string;
  /** Milliseconds since the transcript's `started_at`. */
  start_ms: number;
  end_ms: number;
  language: string | null;
}

/** A transcript with its speakers and every segment. */
export interface TranscriptWithSegments extends Transcript {
  speakers: TranscriptSpeaker[];
  segments: TranscriptSegment[];
}

export interface ListPageOptions {
  /** 1–100. */
  limit?: number;
  /** Items started before this time (the last one's `started_at`). */
  before?: string;
  signal?: AbortSignal;
}

const call = (id: string) => `/v1/calls/${encodeURIComponent(id)}`;
const conversation = (id: string) => `/v1/conversations/${encodeURIComponent(id)}`;

/** `poolse.calls.recording` */
export class CallRecordingApi {
  constructor(private readonly client: RestClient) {}

  /**
   * POST /v1/calls/:id/recording — start recording (the running one if
   * it already is). Starting is also accepting consent.
   *
   * Errors (`ApiError.code`): `not_allowed`, `recording_disabled` (403),
   * `call_finished` (410), `recording_unavailable` (503),
   * `egress_failed` (502 — e.g. nobody's media connected yet), `invalid_mode`,
   * `rate_limited`.
   */
  async start(
    callId: string,
    opts: { mode?: RecordingMode; signal?: AbortSignal } = {},
  ): Promise<Recording> {
    const res = await this.client.request<{ data: Recording }>({
      method: 'POST',
      path: `${call(callId)}/recording`,
      body: opts.mode ? { mode: opts.mode } : {},
      // 503 (not set up) and 502 (Egress refused) are answers, not blips.
      maxRetries: 0,
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    return res.data;
  }

  /**
   * DELETE /v1/calls/:id/recording — stop (answers `status: "stopping"`;
   * `recording:ready` follows once the file is stored). `not_recording`
   * (409), `not_allowed`. Whoever started it may always stop it.
   */
  async stop(callId: string, signal?: AbortSignal): Promise<Recording> {
    const res = await this.client.request<{ data: Recording }>({
      method: 'DELETE',
      path: `${call(callId)}/recording`,
      ...(signal ? { signal } : {}),
    });
    return res.data;
  }

  /** GET /v1/conversations/:id/recordings — newest first. */
  async list(conversationId: string, opts: ListPageOptions = {}): Promise<Recording[]> {
    const res = await this.client.request<{ data: Recording[] }>({
      method: 'GET',
      path: `${conversation(conversationId)}/recordings`,
      query: {
        ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
        ...(opts.before !== undefined ? { before: opts.before } : {}),
      },
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    return res.data;
  }

  /**
   * GET /v1/recordings/:id/download-url — a link valid for 5 minutes;
   * fetch a new one each time it is played or saved. `not_ready` (409)
   * until `status: "ready"`.
   */
  downloadUrl(recordingId: string, signal?: AbortSignal): Promise<RecordingDownload> {
    return this.client.request<RecordingDownload>({
      method: 'GET',
      path: `/v1/recordings/${encodeURIComponent(recordingId)}/download-url`,
      ...(signal ? { signal } : {}),
    });
  }

  /** GET /v1/conversations/:id/recording-settings */
  async settings(
    conversationId: string,
    signal?: AbortSignal,
  ): Promise<ConversationRecordingSettings> {
    const res = await this.client.request<{ data: ConversationRecordingSettings }>({
      method: 'GET',
      path: `${conversation(conversationId)}/recording-settings`,
      ...(signal ? { signal } : {}),
    });
    return res.data;
  }

  /**
   * PUT /v1/conversations/:id/recording-settings — the conversation's
   * owners and admins (`forbidden` otherwise; `validation_failed`).
   */
  async updateSettings(
    conversationId: string,
    patch: ConversationRecordingSettingsUpdate,
    signal?: AbortSignal,
  ): Promise<ConversationRecordingSettings> {
    const res = await this.client.request<{ data: ConversationRecordingSettings }>({
      method: 'PUT',
      path: `${conversation(conversationId)}/recording-settings`,
      body: patch,
      ...(signal ? { signal } : {}),
    });
    return res.data;
  }
}

/** `poolse.calls.transcription` — the live transcript's on/off switch. */
export class CallTranscriptionApi {
  constructor(private readonly client: RestClient) {}

  /**
   * POST /v1/calls/:id/transcription — start (or resume) the live
   * transcript. Someone in the call, or a conversation owner/admin.
   * `not_in_call`, `transcription_disabled` (403), `transcription_unavailable` (503).
   */
  async start(callId: string, signal?: AbortSignal): Promise<Transcript> {
    const res = await this.client.request<{ data: Transcript }>({
      method: 'POST',
      path: `${call(callId)}/transcription`,
      body: {},
      maxRetries: 0,
      ...(signal ? { signal } : {}),
    });
    return res.data;
  }

  /** DELETE /v1/calls/:id/transcription — `not_transcribing` (409). */
  async stop(callId: string, signal?: AbortSignal): Promise<Transcript> {
    const res = await this.client.request<{ data: Transcript }>({
      method: 'DELETE',
      path: `${call(callId)}/transcription`,
      ...(signal ? { signal } : {}),
    });
    return res.data;
  }
}

/** `poolse.calls.transcript` — stored transcripts. */
export class CallTranscriptApi {
  constructor(private readonly client: RestClient) {}

  /** GET /v1/calls/:id/transcript — everything; `not_found` when the call was never transcribed. */
  async get(callId: string, signal?: AbortSignal): Promise<TranscriptWithSegments> {
    const res = await this.client.request<{ data: TranscriptWithSegments }>({
      method: 'GET',
      path: `${call(callId)}/transcript`,
      ...(signal ? { signal } : {}),
    });
    return res.data;
  }

  /** GET /v1/conversations/:id/transcripts — newest first, without segments. */
  async list(
    conversationId: string,
    opts: { limit?: number; signal?: AbortSignal } = {},
  ): Promise<Transcript[]> {
    const res = await this.client.request<{ data: Transcript[] }>({
      method: 'GET',
      path: `${conversation(conversationId)}/transcripts`,
      query: { ...(opts.limit !== undefined ? { limit: opts.limit } : {}) },
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    return res.data;
  }

  /**
   * PATCH /v1/calls/:id/transcript/speakers — correct who said what:
   * speaker key → name, or `null` to put back the person's own name. For
   * someone who took part in the call, or the conversation's owners and
   * admins (`forbidden`). At most 50 names of 100 characters.
   * Everyone with the conversation open hears `transcript:speakers`.
   */
  async renameSpeakers(
    callId: string,
    speakers: Record<string, string | null>,
    signal?: AbortSignal,
  ): Promise<TranscriptWithSegments> {
    const res = await this.client.request<{ data: TranscriptWithSegments }>({
      method: 'PATCH',
      path: `${call(callId)}/transcript/speakers`,
      body: { speakers },
      ...(signal ? { signal } : {}),
    });
    return res.data;
  }
}

/** `poolse.calls` — recording, consent and transcripts of a call. */
export class CallsResource {
  public readonly recording: CallRecordingApi;
  public readonly transcription: CallTranscriptionApi;
  public readonly transcript: CallTranscriptApi;

  constructor(private readonly client: RestClient) {
    this.recording = new CallRecordingApi(client);
    this.transcription = new CallTranscriptionApi(client);
    this.transcript = new CallTranscriptApi(client);
  }

  /**
   * POST /v1/calls/:id/consent — answer the consent prompt. With the
   * workspace's `consent: "required"`, someone who hasn't accepted may
   * not publish while the call is captured: accepting lets them publish
   * again (the SDK's `CallRoom` republishes their microphone and camera
   * by itself once LiveKit allows it); declining keeps them listen-only.
   * `invalid_decision` (422), `call_finished` (410).
   */
  async consent(
    callId: string,
    decision: ConsentDecision,
    signal?: AbortSignal,
  ): Promise<ConsentResult> {
    const res = await this.client.request<{ data: ConsentResult }>({
      method: 'POST',
      path: `${call(callId)}/consent`,
      body: { decision },
      ...(signal ? { signal } : {}),
    });
    return res.data;
  }
}
