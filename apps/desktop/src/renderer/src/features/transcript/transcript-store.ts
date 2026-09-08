import type { AppRole, TranscriptSegment } from '@interview/shared';

export type TranscriptEntry = TranscriptSegment & {
  speaker: AppRole;
};

export class TranscriptStore {
  private readonly segments = new Map<string, TranscriptEntry>();

  upsert(segment: TranscriptEntry): void {
    // ASR workers on separate devices can generate the same segment ID.
    // Namespace it locally so both sides remain visible in one conversation.
    this.segments.set(`${segment.speaker}:${segment.id}`, segment);
  }

  all(): TranscriptEntry[] {
    return [...this.segments.values()].sort(
      (left, right) => left.startMs - right.startMs || left.id.localeCompare(right.id),
    );
  }

  recentFinalText(speaker: AppRole, source: TranscriptSegment['source'], limit = 4): string {
    return this.all()
      .filter(
        (segment) =>
          segment.speaker === speaker && segment.source === source && segment.status === 'final',
      )
      .slice(-limit)
      .map((segment) => segment.rawText ?? segment.text)
      .join(' ');
  }

  clear(): void {
    this.segments.clear();
  }
}
