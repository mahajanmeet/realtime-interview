import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { join } from 'node:path';

import { app } from 'electron';

import type { AudioSource } from '@interview/shared';

type ActiveRecording = {
  sessionId: string;
  source: AudioSource;
  stream: WriteStream;
  filePath: string;
  pendingWrite: Promise<void>;
  error: Error | null;
};

export class RecordingManager {
  private readonly recordings = new Map<string, ActiveRecording>();

  async start(sessionId: string, source: AudioSource): Promise<string> {
    await this.stop(sessionId, source);

    const directory = join(app.getPath('userData'), 'recordings', sessionId);

    mkdirSync(directory, { recursive: true });

    const filePath = join(directory, `${source}.webm`);
    const stream = createWriteStream(filePath, { flags: 'w' });
    const recording: ActiveRecording = {
      sessionId,
      source,
      stream,
      filePath,
      pendingWrite: Promise.resolve(),
      error: null,
    };

    stream.on('error', (error: Error) => {
      recording.error = error;
    });

    this.recordings.set(this.getKey(sessionId, source), recording);

    try {
      await waitForStreamOpen(stream);
    } catch (error) {
      this.recordings.delete(this.getKey(sessionId, source));
      stream.destroy();
      throw error;
    }

    return filePath;
  }

  async append(sessionId: string, source: AudioSource, chunk: Uint8Array): Promise<void> {
    const recording = this.recordings.get(this.getKey(sessionId, source));

    if (!recording) {
      throw new Error('Recording is not active.');
    }

    const buffer = Buffer.from(chunk);
    const write = recording.pendingWrite.then(async () => {
      if (recording.error) {
        throw recording.error;
      }

      if (!recording.stream.write(buffer)) {
        await waitForDrain(recording.stream);
      }

      if (recording.error) {
        throw recording.error;
      }
    });

    recording.pendingWrite = write.catch(() => undefined);
    await write;
  }

  async stop(sessionId: string, source: AudioSource): Promise<void> {
    const key = this.getKey(sessionId, source);
    const recording = this.recordings.get(key);

    if (!recording) {
      return;
    }

    this.recordings.delete(key);
    await recording.pendingWrite;

    if (recording.error) {
      recording.stream.destroy();
      throw recording.error;
    }

    await endStream(recording.stream);
  }

  async stopAll(): Promise<void> {
    const recordings = [...this.recordings.values()];

    await Promise.allSettled(
      recordings.map((recording) => this.stop(recording.sessionId, recording.source)),
    );
  }

  private getKey(sessionId: string, source: AudioSource): string {
    return `${sessionId}:${source}`;
  }
}

const waitForStreamOpen = async (stream: WriteStream): Promise<void> => {
  if (stream.pending === false) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const onOpen = (): void => {
      cleanup();
      resolve();
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const cleanup = (): void => {
      stream.off('open', onOpen);
      stream.off('error', onError);
    };

    stream.once('open', onOpen);
    stream.once('error', onError);
  });
};

const waitForDrain = async (stream: WriteStream): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const onDrain = (): void => {
      cleanup();
      resolve();
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const cleanup = (): void => {
      stream.off('drain', onDrain);
      stream.off('error', onError);
    };

    stream.once('drain', onDrain);
    stream.once('error', onError);
  });
};

const endStream = async (stream: WriteStream): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    stream.end((error?: Error | null) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
};
