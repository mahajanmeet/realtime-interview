import type { AudioSource } from '@interview/shared';

const PREFERRED_MIME_TYPE = 'audio/webm;codecs=opus';
const RECORDING_TIMESLICE_MS = 1000;

export class TrackRecorder {
  private recorder: MediaRecorder | null = null;

  private readonly pendingWrites = new Set<Promise<void>>();

  private recordingStarted = false;

  private stopPromise: Promise<void> | null = null;

  private writeError: Error | null = null;

  constructor(
    private readonly sessionId: string,
    private readonly source: AudioSource,
    private readonly onError: (error: Error) => void,
  ) {}

  async start(stream: MediaStream): Promise<void> {
    if (this.recorder || this.recordingStarted) {
      throw new Error(`${this.source} recording is already active.`);
    }

    if (!stream.getAudioTracks().some((track) => track.readyState === 'live')) {
      throw new Error(`The ${this.source} stream does not contain a live audio track.`);
    }

    await window.interviewApi.recording.start(this.sessionId, this.source);
    this.recordingStarted = true;

    try {
      const options = MediaRecorder.isTypeSupported(PREFERRED_MIME_TYPE)
        ? { mimeType: PREFERRED_MIME_TYPE }
        : undefined;
      const recorder = new MediaRecorder(stream, options);

      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size === 0) {
          return;
        }

        const write = event.data
          .arrayBuffer()
          .then((buffer) =>
            window.interviewApi.recording.append(
              this.sessionId,
              this.source,
              new Uint8Array(buffer),
            ),
          )
          .catch((cause: unknown) => {
            const error = normalizeError(cause, `Could not write ${this.source} recording.`);
            this.writeError = error;
            this.onError(error);
          });

        this.pendingWrites.add(write);
        void write.finally(() => {
          this.pendingWrites.delete(write);
        });
      });

      recorder.addEventListener('error', () => {
        this.onError(new Error(`${this.source} recording failed.`));
      });

      recorder.start(RECORDING_TIMESLICE_MS);
      this.recorder = recorder;
    } catch (cause) {
      await window.interviewApi.recording.stop(this.sessionId, this.source);
      this.recordingStarted = false;
      throw normalizeError(cause, `Could not start ${this.source} recording.`);
    }
  }

  async stop(): Promise<void> {
    if (this.stopPromise) {
      return this.stopPromise;
    }

    this.stopPromise = this.stopInternal();

    try {
      await this.stopPromise;
    } finally {
      this.stopPromise = null;
    }
  }

  private async stopInternal(): Promise<void> {
    const recorder = this.recorder;

    if (recorder && recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        recorder.addEventListener('stop', () => resolve(), { once: true });
        recorder.stop();
      });
    }

    await Promise.allSettled([...this.pendingWrites]);

    let stopError: unknown;

    try {
      if (this.recordingStarted) {
        await window.interviewApi.recording.stop(this.sessionId, this.source);
      }
    } catch (cause) {
      stopError = cause;
    } finally {
      this.recorder = null;
      this.recordingStarted = false;
    }

    if (this.writeError) {
      const error = this.writeError;
      this.writeError = null;
      throw error;
    }

    if (stopError) {
      throw normalizeError(stopError, `Could not stop ${this.source} recording.`);
    }
  }
}

const normalizeError = (cause: unknown, fallback: string): Error =>
  cause instanceof Error ? cause : new Error(fallback);
