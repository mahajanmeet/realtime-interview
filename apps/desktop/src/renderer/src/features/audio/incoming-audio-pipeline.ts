import type { AudioSource } from '@interview/shared';

import { logger } from '../../lib/logger';

import { PCM_CHUNK_SAMPLES, PCM_SAMPLE_RATE, PcmTap } from './pcm-tap';
import { TrackRecorder } from './recorder';

type IncomingAudioPipelineCallbacks = {
  onRecordingStarted(source: AudioSource): void;
  onPcmStarted(source: AudioSource): void;
  onPcmChunk(source: AudioSource, samples: Float32Array): void;
  onError(source: AudioSource, error: Error): void;
};

export class IncomingAudioPipeline {
  private readonly recorder: TrackRecorder;

  private readonly pcmTap = new PcmTap();

  private startPromise: Promise<void> | null = null;

  private pcmStarted = false;

  constructor(
    sessionId: string,
    private readonly source: AudioSource,
    private readonly callbacks: IncomingAudioPipelineCallbacks,
  ) {
    this.recorder = new TrackRecorder(sessionId, source, (error) => {
      callbacks.onError(source, error);
    });
  }

  async start(stream: MediaStream): Promise<void> {
    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = this.startInternal(stream);
    return this.startPromise;
  }

  async stop(): Promise<void> {
    await this.startPromise?.catch(() => undefined);

    const results = await Promise.allSettled([this.pcmTap.stop(), this.recorder.stop()]);
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );

    if (failure) {
      throw failure.reason;
    }
  }

  private async startInternal(stream: MediaStream): Promise<void> {
    try {
      await this.recorder.start(stream);
      this.callbacks.onRecordingStarted(this.source);

      await this.pcmTap.start(stream, (samples) => {
        if (!this.pcmStarted) {
          this.pcmStarted = true;
          this.callbacks.onPcmStarted(this.source);

          logger.info('PCM capture started.', {
            source: this.source,
            sampleRate: PCM_SAMPLE_RATE,
            chunkSamples: samples.length,
            expectedChunkSamples: PCM_CHUNK_SAMPLES,
          });
        }

        this.callbacks.onPcmChunk(this.source, samples);
      });
    } catch (cause) {
      await Promise.allSettled([this.pcmTap.stop(), this.recorder.stop()]);

      const error = cause instanceof Error ? cause : new Error(`Could not capture ${this.source}.`);
      this.callbacks.onError(this.source, error);
      throw error;
    }
  }
}
