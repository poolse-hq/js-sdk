// The live store behind approvals and agent escalations: items that
// arrive by event, by the user's own answer, and by re-listing on every
// channel rejoin. Without ordering, a list that was in flight while an
// event landed deletes the new pending item, or brings back a pending
// copy of one the user just answered.

/** @internal */
export class PendingItems<T extends { id: string; status: string }> {
  readonly byId = new Map<string, T>();
  // When each item was last written (a logical clock, not wall time).
  private readonly changedAt = new Map<string, number>();
  private clock = 0;

  /** Call before a list request; pass the result to {@link merge}. */
  begin(): number {
    return ++this.clock;
  }

  /**
   * Record one seen live (an event, the user's own answer). A decided
   * one is never undone by an older pending copy. Returns whether it
   * changed anything.
   */
  apply(item: T): boolean {
    const prev = this.byId.get(item.id);
    if (prev && prev.status !== 'pending' && item.status === 'pending') return false;
    this.byId.set(item.id, item);
    this.changedAt.set(item.id, ++this.clock);
    return true;
  }

  /**
   * Merge the rows of a list request begun at `since`. Rows older than
   * what is known are skipped; with `prune` (a `status=pending` list)
   * pending items the server didn't list were answered elsewhere and
   * go, unless they arrived after the request started.
   */
  merge(rows: readonly T[], since: number, prune: boolean): void {
    for (const row of rows) {
      if ((this.changedAt.get(row.id) ?? 0) > since) continue;
      const prev = this.byId.get(row.id);
      if (prev && prev.status !== 'pending' && row.status === 'pending') continue;
      this.byId.set(row.id, row);
      this.changedAt.set(row.id, since);
    }
    if (!prune) return;
    const listed = new Set(rows.map((r) => r.id));
    for (const [id, item] of this.byId) {
      if (item.status !== 'pending' || listed.has(id)) continue;
      if ((this.changedAt.get(id) ?? 0) > since) continue;
      this.byId.delete(id);
      this.changedAt.delete(id);
    }
  }
}
