import type { ClientSignalMessage } from '@interview/shared';

type TranscriptMessage = Extract<ClientSignalMessage, { type: 'transcript-segment' }>;

// Coalesce hypotheses instead of accumulating a queue of obsolete text.
// Budget includes JSON/UTF-8 payload, not TLS/TCP overhead.
export class TranscriptOutbox {
  private readonly entries = new Map<
    string,
    { message: TranscriptMessage; wire: string; dirty: boolean; lastSent: number }
  >();
  private bytes = 0;
  private tokens = 64 * 1024;
  private lastTick = 0;

  enqueue(message: TranscriptMessage): void {
    const { rawText: _rawText, ...segment } = message.segment;
    const compact: TranscriptMessage = { type: 'transcript-segment', segment };
    const key = segment.id;
    const previous = this.entries.get(key);
    if (previous?.message.segment.status === 'final' && segment.status === 'partial') return;
    const wire = JSON.stringify(compact);
    if (previous?.wire === wire) return;
    const size = new TextEncoder().encode(wire).length;
    if (previous) this.bytes -= new TextEncoder().encode(previous.wire).length;
    this.entries.set(key, {
      message: compact,
      wire,
      dirty: true,
      lastSent: previous?.lastSent ?? -Infinity,
    });
    this.bytes += size;
    // Retain recent snapshots for reconnect; never grow memory indefinitely.
    while (this.entries.size > 256 || this.bytes > 2 * 1024 * 1024) {
      const oldest = this.entries.keys().next().value as string;
      const entry = this.entries.get(oldest)!;
      this.bytes -= new TextEncoder().encode(entry.wire).length;
      this.entries.delete(oldest);
    }
  }

  replay(): void {
    for (const entry of this.entries.values()) entry.dirty = true;
  }

  flush(now: number, send: (wire: string) => boolean): void {
    const elapsed = this.lastTick ? Math.max(0, now - this.lastTick) : 0;
    this.lastTick = now;
    this.tokens = Math.min(64 * 1024, this.tokens + elapsed * 16.384);
    // Fair scheduling prevents a busy source from starving the other source.
    for (const entry of [...this.entries.values()]
      .reverse()
      .sort((a, b) => a.lastSent - b.lastSent)) {
      if (!entry.dirty) continue;
      const size = new TextEncoder().encode(entry.wire).length;
      if (size > this.tokens || !send(entry.wire)) break;
      this.tokens -= size;
      entry.dirty = false;
      entry.lastSent = now;
    }
  }
}
