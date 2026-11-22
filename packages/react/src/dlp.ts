// Data loss prevention at send (AD6): the server checks a message
// against the workspace's patterns and either warns (the sender may
// send anyway) or blocks. This reads that answer out of the send's
// error so both composers can show the same dialog.

import { ApiError } from '@poolse/sdk';

/** One rule that matched. `excerpt` is a masked snippet, never the full secret. */
export interface DlpMatch {
  rule: string;
  excerpt?: string;
}

export interface DlpOutcome {
  /** `warn`: may be sent with `dlp_acknowledged: true`. `block`: can't be sent. */
  action: 'warn' | 'block';
  matches: DlpMatch[];
  /** The admin's own wording, when set. */
  message?: string;
}

const WARN_CODES = new Set(['dlp_warning', 'dlp_warn']);
const BLOCK_CODES = new Set(['dlp_blocked', 'dlp_block']);

/** The DLP outcome carried by a failed send, or `null` for any other error. */
export function readDlpError(err: unknown): DlpOutcome | null {
  if (!(err instanceof ApiError)) return null;
  const code = String(err.code);
  const action = WARN_CODES.has(code) ? 'warn' : BLOCK_CODES.has(code) ? 'block' : null;
  if (!action) return null;
  const details = (err.details ?? {}) as Record<string, unknown>;
  const raw = Array.isArray(details.matches) ? details.matches : [];
  const matches: DlpMatch[] = [];
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue;
    const r = m as Record<string, unknown>;
    const rule = typeof r.rule === 'string' ? r.rule : typeof r.name === 'string' ? r.name : null;
    if (!rule) continue;
    matches.push({ rule, ...(typeof r.excerpt === 'string' ? { excerpt: r.excerpt } : {}) });
  }
  const message = typeof details.message === 'string' ? details.message : undefined;
  return { action, matches, ...(message ? { message } : {}) };
}
