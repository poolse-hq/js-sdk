import { useEffect, type RefObject } from 'react';

/**
 * Resize a textarea to fit its content. Re-runs on every value change.
 * CSS `max-height` caps the growth and `overflow-y: auto` shows a
 * scrollbar past that — the hook itself doesn't enforce a maximum.
 *
 * Needed by composers that ship `rows={1}` for the empty-state look:
 * without it, multi-line content (list continuations, soft-wrapped
 * markdown, etc.) hides behind the single visible row.
 */
export function useAutogrow(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
): void {
  useEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    // Reset to auto so a shrinking value can collapse the textarea
    // back down — otherwise scrollHeight stays at the previous max.
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  }, [ref, value]);
}
