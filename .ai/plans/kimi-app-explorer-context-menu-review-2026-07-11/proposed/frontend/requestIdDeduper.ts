/**
 * Bounded TTL deduper for Tauri events.
 *
 * Kimi Sidekick currently emits the same navigate_session payload on both
 * workspace-session-bootstrap and workspace-session-bridge. A new-pane action
 * must be deduped, otherwise one Explorer click can create two panes.
 */
export class RequestIdDeduper {
  readonly ttlMs: number;
  readonly maxEntries: number;
  private readonly seen = new Map<string, number>();

  constructor(options: { ttlMs?: number; maxEntries?: number } = {}) {
    this.ttlMs = Math.max(1_000, options.ttlMs ?? 60_000);
    this.maxEntries = Math.max(32, options.maxEntries ?? 512);
  }

  /** Returns true only for the first delivery inside the TTL window. */
  accept(requestId: string | null | undefined, now = Date.now()): boolean {
    const id = requestId?.trim();
    if (!id) {
      // Requests without an id cannot be safely deduped. Preserve legacy
      // behavior rather than dropping them.
      return true;
    }

    this.prune(now);
    const previous = this.seen.get(id);
    if (previous !== undefined && now - previous <= this.ttlMs) {
      return false;
    }

    this.seen.delete(id);
    this.seen.set(id, now);
    if (this.seen.size > this.maxEntries) {
      const oldest = this.seen.keys().next().value as string | undefined;
      if (oldest) this.seen.delete(oldest);
    }
    return true;
  }

  clear(): void {
    this.seen.clear();
  }

  get size(): number {
    return this.seen.size;
  }

  private prune(now: number): void {
    for (const [id, timestamp] of this.seen) {
      if (now - timestamp > this.ttlMs) this.seen.delete(id);
    }
  }
}
