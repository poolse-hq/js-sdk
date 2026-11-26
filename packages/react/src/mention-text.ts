// Which people a message's text mentions, for composers on both
// platforms. A draft restored from storage keeps its "@Name" text but
// not which person was picked, so names are also matched against the
// conversation's members at send time.

export interface MentionCandidate {
  userId: string;
  /** The name as inserted after "@". Empty: never matched. */
  label: string;
}

const WORD = /[\p{L}\p{N}_]/u;

/** Whether "@label" appears in `text` as a whole name (not the start of a longer one). */
function mentions(text: string, label: string): boolean {
  if (!label) return false;
  const needle = `@${label}`;
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) {
    const next = text.charAt(i + needle.length);
    if (!next || !WORD.test(next)) return true;
  }
  return false;
}

/**
 * The user ids `text` mentions: everyone `picked` from the suggestions
 * whose "@label" is still in it, plus `members` written out by name — a
 * draft restored after a restart, or a name typed in full. A member
 * name two people share is left out (it can't say which one).
 */
export function mentionedUserIdsIn(
  text: string,
  picked: ReadonlyArray<MentionCandidate>,
  members: ReadonlyArray<MentionCandidate> = [],
): string[] {
  const out: string[] = [];
  for (const p of picked) {
    if (!out.includes(p.userId) && p.label && text.includes(`@${p.label}`)) out.push(p.userId);
  }
  const byLabel = new Map<string, Set<string>>();
  for (const m of members) {
    if (!m.label) continue;
    const ids = byLabel.get(m.label) ?? new Set<string>();
    ids.add(m.userId);
    byLabel.set(m.label, ids);
  }
  for (const [label, ids] of byLabel) {
    if (ids.size !== 1) continue;
    const [id] = ids;
    if (id && !out.includes(id) && mentions(text, label)) out.push(id);
  }
  return out;
}
