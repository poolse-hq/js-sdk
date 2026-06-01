// Smart Enter handling for list continuation inside the chat composer
// — mirrors the convention used by Slack, Notion, iA Writer, etc.
//
// Given the current textarea value + caret position, returns either:
//   * { kind: 'continue', value, caret } — list continues onto a new
//     line with the next marker pre-typed
//   * { kind: 'end', value, caret } — the user pressed Enter on an
//     empty list item; the marker is stripped and the cursor is
//     placed where it was
//   * null — Enter should fall through to its default behavior
//     (submit the message)
//
// Recognises:
//   - "- foo" / "* foo" / "+ foo"   (unordered, three Markdown markers)
//   - "1. foo" / "12. foo"          (ordered, any leading integer)
// Preserves leading indentation (so nested lists work).

export interface ListContinueResult {
  kind: 'continue' | 'end';
  value: string;
  caret: number;
}

const UNORDERED_RE = /^(\s*)([-*+]) (.*)$/;
const ORDERED_RE = /^(\s*)(\d+)\. (.*)$/;

export function handleListEnter(value: string, caret: number): ListContinueResult | null {
  // Identify the current line (the run of text leading up to the
  // caret, terminated by the previous newline). End of caret marks
  // where Enter would otherwise split.
  const lineStart = value.lastIndexOf('\n', caret - 1) + 1;
  const lineEnd = (() => {
    const nl = value.indexOf('\n', caret);
    return nl === -1 ? value.length : nl;
  })();
  const currentLine = value.slice(lineStart, lineEnd);

  const unordered = UNORDERED_RE.exec(currentLine);
  const ordered = ORDERED_RE.exec(currentLine);
  const match = unordered ?? ordered;
  if (!match) return null;

  // strict tsconfig — pull the captures by index and assert non-null;
  // the regex always provides all three groups when it matches.
  const indent = match[1] ?? '';
  const marker = match[2] ?? '';
  const content = match[3] ?? '';

  // Empty list item — strip the marker and stay on the line. This
  // is how Slack / Notion let you exit a list.
  if (content === '') {
    const before = value.slice(0, lineStart);
    const after = value.slice(lineEnd);
    return { kind: 'end', value: before + after, caret: lineStart };
  }

  // Non-empty — continue with the next marker (incremented for
  // ordered lists, repeated for unordered).
  const nextMarker = ordered ? `${parseInt(marker, 10) + 1}.` : marker;
  const prefix = `\n${indent}${nextMarker} `;
  const before = value.slice(0, caret);
  const after = value.slice(caret);
  return {
    kind: 'continue',
    value: before + prefix + after,
    caret: caret + prefix.length,
  };
}
