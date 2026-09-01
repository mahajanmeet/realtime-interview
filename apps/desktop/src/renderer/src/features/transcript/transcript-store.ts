import type { TranscriptSegment } from '@interview/shared';

export class TranscriptStore {
  private readonly segments = new Map<string, TranscriptSegment>();

  upsert(segment: TranscriptSegment): void {
    this.segments.set(segment.id, segment);
  }

  all(): TranscriptSegment[] {
    return [...this.segments.values()].sort(
      (left, right) => left.startMs - right.startMs || left.id.localeCompare(right.id),
    );
  }

  recentFinalText(source: TranscriptSegment['source'], limit = 4): string {
    return this.all()
      .filter((segment) => segment.source === source && segment.status === 'final')
      .slice(-limit)
      .map((segment) => segment.rawText ?? segment.text)
      .join(' ');
  }

  clear(): void {
    this.segments.clear();
  }
}
