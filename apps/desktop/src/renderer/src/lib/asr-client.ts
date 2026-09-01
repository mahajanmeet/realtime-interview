import {
  AsrResultSchema,
  AsrStatusSchema,
  type AsrResult,
  type AsrStartResult,
  type AsrStatus,
  type AudioSource,
} from '@interview/shared';

type ResultHandler = (result: AsrResult) => void;
type StatusHandler = (status: AsrStatus) => void;

export class AsrClient {
  private readonly resultHandlers = new Set<ResultHandler>();

  private readonly statusHandlers = new Set<StatusHandler>();

  private removeResultListener: (() => void) | null = null;

  private removeStatusListener: (() => void) | null = null;

  async start(): Promise<AsrStartResult> {
    this.connectListeners();
    const result = await window.interviewApi.asr.start();

    this.emitStatus(result.status);
    return result;
  }

  sendAudio(source: AudioSource, samples: Float32Array): void {
    window.interviewApi.asr.sendAudio(source, samples);
  }

  reset(source: AudioSource): void {
    window.interviewApi.asr.reset(source);
  }

  onResult(handler: ResultHandler): () => void {
    this.resultHandlers.add(handler);
    return () => {
      this.resultHandlers.delete(handler);
    };
  }

  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    return () => {
      this.statusHandlers.delete(handler);
    };
  }

  async stop(): Promise<void> {
    this.removeResultListener?.();
    this.removeStatusListener?.();
    this.removeResultListener = null;
    this.removeStatusListener = null;
    await window.interviewApi.asr.stop();
  }

  private connectListeners(): void {
    if (!this.removeResultListener) {
      this.removeResultListener = window.interviewApi.asr.onResult((value) => {
        const result = AsrResultSchema.safeParse(value);

        if (result.success) {
          for (const handler of this.resultHandlers) {
            handler(result.data);
          }
        }
      });
    }

    if (!this.removeStatusListener) {
      this.removeStatusListener = window.interviewApi.asr.onStatus((value) => {
        const status = AsrStatusSchema.safeParse(value);

        if (status.success) {
          this.emitStatus(status.data);
        }
      });
    }
  }

  private emitStatus(status: AsrStatus): void {
    for (const handler of this.statusHandlers) {
      handler(status);
    }
  }
}
