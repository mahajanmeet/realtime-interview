import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { z } from 'zod';

import {
  FinalTranscriptSegmentSchema,
  FinalizationStateSchema,
  TranscriptSegmentSchema,
  type FinalTranscriptSegment,
  type TranscriptSegment,
} from '@interview/shared';

import type { FinalizeRequest, FinalTranscriber } from './final-transcriber';

const FinalizationJobSchema = z.object({
  id: z.string().min(1),
  request: z.object({
    sessionId: z.string().uuid(),
    source: z.enum(['microphone', 'system']),
    filePath: z.string().min(1),
  }),
  state: FinalizationStateSchema,
  attempts: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  liveSegments: z.array(TranscriptSegmentSchema),
  finalSegments: z.array(FinalTranscriptSegmentSchema),
  error: z.string().optional(),
});

const FinalizationFileSchema = z.object({
  version: z.literal(1),
  jobs: z.array(FinalizationJobSchema),
});

export type FinalizationJob = z.infer<typeof FinalizationJobSchema>;

type FinalizationManagerOptions = {
  stateFile: string;
  transcriber: FinalTranscriber;
  onUpdate?(job: FinalizationJob): void;
};

export class FinalizationManager {
  private readonly jobs = new Map<string, FinalizationJob>();

  private readonly activeJobs = new Set<string>();

  private persistQueue = Promise.resolve();

  constructor(private readonly options: FinalizationManagerOptions) {}

  async initialize(): Promise<void> {
    let contents: string;

    try {
      contents = await readFile(this.options.stateFile, 'utf8');
    } catch (error) {
      if (isMissingFileError(error)) {
        return;
      }

      throw error;
    }

    const saved = FinalizationFileSchema.parse(JSON.parse(contents));
    let recoveredInterruptedJob = false;

    for (const savedJob of saved.jobs) {
      const job = savedJob.state === 'processing' ? { ...savedJob, state: 'pending' as const } : savedJob;

      recoveredInterruptedJob ||= savedJob.state === 'processing';
      this.jobs.set(job.id, job);
    }

    if (recoveredInterruptedJob) {
      await this.persist();
    }
  }

  all(): FinalizationJob[] {
    return [...this.jobs.values()].sort((left, right) => left.updatedAt - right.updatedAt);
  }

  async enqueue(
    request: FinalizeRequest,
    liveSegments: TranscriptSegment[],
  ): Promise<FinalizationJob> {
    const id = `${request.sessionId}:${request.source}`;
    const job: FinalizationJob = {
      id,
      request,
      state: 'pending',
      attempts: this.jobs.get(id)?.attempts ?? 0,
      updatedAt: Date.now(),
      liveSegments: liveSegments.filter((segment) => segment.source === request.source),
      finalSegments: [],
    };

    FinalizationJobSchema.parse(job);
    this.jobs.set(id, job);
    await this.persist();
    this.emit(job);
    void this.run(id);

    return job;
  }

  async resumePending(): Promise<void> {
    await Promise.all(
      this.all()
        .filter((job) => job.state === 'pending')
        .map((job) => this.run(job.id)),
    );
  }

  async retry(id: string): Promise<void> {
    const job = this.jobs.get(id);

    if (!job || job.state !== 'failed') {
      return;
    }

    job.state = 'pending';
    job.updatedAt = Date.now();
    delete job.error;
    await this.persist();
    this.emit(job);
    await this.run(id);
  }

  private async run(id: string): Promise<void> {
    if (this.activeJobs.has(id)) {
      return;
    }

    const job = this.jobs.get(id);

    if (!job || job.state !== 'pending') {
      return;
    }

    this.activeJobs.add(id);
    job.state = 'processing';
    job.attempts += 1;
    job.updatedAt = Date.now();
    await this.persist();
    this.emit(job);

    try {
      const result = await this.options.transcriber.transcribe(job.request);
      job.finalSegments = result.segments.map((segment, index) => {
        const liveText = findOverlappingLiveText(job.liveSegments, segment.startMs, segment.endMs);

        return FinalTranscriptSegmentSchema.parse({
          id: `${job.id}:${index}`,
          source: job.request.source,
          startMs: segment.startMs,
          endMs: segment.endMs,
          liveText,
          finalText: segment.text,
          confidence: liveText
            ? normalizeForComparison(liveText) === normalizeForComparison(segment.text)
              ? 'high'
              : 'medium'
            : 'low',
        });
      });
      job.state = 'complete';
      delete job.error;
    } catch (error) {
      job.state = 'failed';
      job.error = error instanceof Error ? error.message : 'Final transcription failed.';
    } finally {
      job.updatedAt = Date.now();
      this.activeJobs.delete(id);
      await this.persist();
      this.emit(job);
    }
  }

  private persist(): Promise<void> {
    const contents = JSON.stringify({ version: 1, jobs: this.all() }, null, 2);
    const stateDirectory = dirname(this.options.stateFile);
    const temporaryFile = `${this.options.stateFile}.tmp`;
    const write = this.persistQueue.then(async () => {
      await mkdir(stateDirectory, { recursive: true });
      await writeFile(temporaryFile, contents, 'utf8');
      await rename(temporaryFile, this.options.stateFile);
    });

    this.persistQueue = write.catch(() => undefined);
    return write;
  }

  private emit(job: FinalizationJob): void {
    this.options.onUpdate?.(structuredClone(job));
  }
}

const findOverlappingLiveText = (
  liveSegments: TranscriptSegment[],
  startMs: number,
  endMs: number,
): string => {
  let bestText = '';
  let bestOverlap = 0;

  for (const segment of liveSegments) {
    const segmentEnd = segment.endMs ?? endMs;
    const overlap = Math.max(0, Math.min(endMs, segmentEnd) - Math.max(startMs, segment.startMs));

    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestText = segment.rawText ?? segment.text;
    }
  }

  return bestText;
};

const normalizeForComparison = (text: string): string =>
  text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

const isMissingFileError = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';
