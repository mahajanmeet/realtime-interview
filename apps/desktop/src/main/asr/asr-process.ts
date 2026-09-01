import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { app } from 'electron';
import { z } from 'zod';

import type {
  AsrResult,
  AsrStartResult,
  AsrStatus,
  AsrWorkerState,
  AudioSource,
} from '@interview/shared';

const SAMPLE_RATE = 16_000;
const MAX_AUDIO_SAMPLES = SAMPLE_RATE;
const MAX_OUTPUT_LINE_BYTES = 1024 * 1024;
const MAX_QUEUED_AUDIO_BYTES = 2 * 1024 * 1024;
const MAX_RESTART_DELAY_MS = 15_000;

const COMMAND_START = 1;
const COMMAND_AUDIO = 2;
const COMMAND_RESET = 3;
const COMMAND_STOP = 4;

const WorkerResultSchema = z.object({
  type: z.enum(['partial', 'final']),
  source: z.enum(['microphone', 'system']),
  segmentId: z.string().min(1),
  text: z.string(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative().nullable(),
});

const WorkerStatusSchema = z.object({
  type: z.literal('status'),
  state: z.enum(['ready', 'error']),
  message: z.string().optional(),
});

type QueuedFrame = {
  source: AudioSource;
  frame: Buffer;
};

type AsrProcessCallbacks = {
  onResult(result: AsrResult): void;
  onStatus(status: AsrStatus): void;
};

export class AsrProcess {
  private child: ChildProcessWithoutNullStreams | null = null;

  private state: AsrWorkerState = 'stopped';

  private statusMessage: string | undefined;

  private outputBuffer = '';

  private readonly activeSources = new Set<AudioSource>();

  private queuedFrames: QueuedFrame[] = [];

  private queuedBytes = 0;

  private waitingForDrain = false;

  private restartAttempts = 0;

  private workerGeneration = 0;

  private restartTimer: ReturnType<typeof setTimeout> | null = null;

  private stopping = false;

  private stopPromise: Promise<void> | null = null;

  constructor(private readonly callbacks: AsrProcessCallbacks) {}

  async start(): Promise<AsrStartResult> {
    if (this.child) {
      return {
        available: this.state !== 'unavailable' && this.state !== 'error',
        status: this.getStatus(),
      };
    }

    this.stopping = false;

    const runtime = getAsrRuntime();

    if (!runtime) {
      this.setStatus(
        'unavailable',
        'Sherpa worker or model files are missing. The call and recording will continue.',
      );

      return {
        available: false,
        status: this.getStatus(),
      };
    }

    this.setStatus(this.restartAttempts > 0 ? 'restarting' : 'starting');

    const child = spawn(runtime.executable, runtime.arguments, {
      cwd: runtime.workingDirectory,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    this.child = child;
    this.workerGeneration += 1;
    this.outputBuffer = '';
    this.waitingForDrain = false;

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      this.handleOutput(chunk);
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      const message = chunk.trim();

      if (message) {
        console.warn('[ASR worker]', message.slice(0, 2000));
      }
    });

    child.stdin.on('drain', () => {
      if (this.child !== child) {
        return;
      }

      this.waitingForDrain = false;
      this.flushQueuedAudio();
    });

    child.once('error', (error) => {
      if (this.child !== child) {
        return;
      }

      this.child = null;
      this.setStatus('error', `Sherpa worker could not start: ${error.message}`);
      this.scheduleRestart();
    });

    child.once('exit', (code, signal) => {
      if (this.child !== child) {
        return;
      }

      this.child = null;
      this.waitingForDrain = false;

      if (this.stopping) {
        this.setStatus('stopped');
        return;
      }

      const detail = signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`;
      this.setStatus('error', `Sherpa worker exited with ${detail}. Recording continues.`);
      this.scheduleRestart();
    });

    return {
      available: true,
      status: this.getStatus(),
    };
  }

  sendAudio(source: AudioSource, samples: Float32Array): void {
    if (samples.length === 0 || samples.length > MAX_AUDIO_SAMPLES) {
      return;
    }

    const isNewSource = !this.activeSources.has(source);
    this.activeSources.add(source);

    if (this.state === 'ready' && isNewSource) {
      this.writeFrame(createControlFrame(COMMAND_START, source));
    }

    const frame = createAudioFrame(source, samples);

    if (this.state !== 'ready' || !this.child || this.waitingForDrain) {
      this.queueAudio(source, frame);
      return;
    }

    this.writeFrame(frame);
  }

  reset(source: AudioSource): void {
    this.activeSources.delete(source);
    this.removeQueuedSource(source);

    if (this.state === 'ready') {
      this.writeFrame(createControlFrame(COMMAND_RESET, source));
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
    this.stopping = true;
    this.clearRestartTimer();
    this.activeSources.clear();
    this.queuedFrames = [];
    this.queuedBytes = 0;

    const child = this.child;

    if (!child) {
      this.setStatus('stopped');
      return;
    }

    this.writeFrame(createControlFrame(COMMAND_STOP, 'microphone'));
    child.stdin.end();

    await new Promise<void>((resolveStop) => {
      const timeout = setTimeout(() => {
        child.kill();
        resolveStop();
      }, 2000);

      child.once('exit', () => {
        clearTimeout(timeout);
        resolveStop();
      });
    });

    if (this.child === child) {
      this.child = null;
    }

    this.setStatus('stopped');
  }

  getStatus(): AsrStatus {
    return {
      state: this.state,
      ...(this.statusMessage ? { message: this.statusMessage } : {}),
    };
  }

  private handleOutput(chunk: string): void {
    this.outputBuffer += chunk;

    if (Buffer.byteLength(this.outputBuffer, 'utf8') > MAX_OUTPUT_LINE_BYTES) {
      this.outputBuffer = '';
      this.setStatus('error', 'Sherpa worker returned an oversized message.');
      return;
    }

    let newlineIndex = this.outputBuffer.indexOf('\n');

    while (newlineIndex >= 0) {
      const line = this.outputBuffer.slice(0, newlineIndex).trim();
      this.outputBuffer = this.outputBuffer.slice(newlineIndex + 1);

      if (line) {
        this.handleOutputLine(line);
      }

      newlineIndex = this.outputBuffer.indexOf('\n');
    }
  }

  private handleOutputLine(line: string): void {
    let value: unknown;

    try {
      value = JSON.parse(line);
    } catch {
      this.setStatus('error', 'Sherpa worker returned malformed output.');
      return;
    }

    const status = WorkerStatusSchema.safeParse(value);

    if (status.success) {
      if (status.data.state === 'ready') {
        this.restartAttempts = 0;
        this.setStatus('ready');

        for (const source of this.activeSources) {
          this.writeFrame(createControlFrame(COMMAND_START, source));
        }

        this.flushQueuedAudio();
      } else {
        this.setStatus('error', status.data.message ?? 'Sherpa worker reported an error.');
      }

      return;
    }

    const result = WorkerResultSchema.safeParse(value);

    if (result.success) {
      this.callbacks.onResult({
        ...result.data,
        segmentId: `${this.workerGeneration}-${result.data.segmentId}`,
      });
    }
  }

  private writeFrame(frame: Buffer): void {
    const child = this.child;

    if (!child || child.stdin.destroyed || !child.stdin.writable) {
      return;
    }

    this.waitingForDrain = !child.stdin.write(frame);
  }

  private queueAudio(source: AudioSource, frame: Buffer): void {
    this.queuedFrames.push({ source, frame });
    this.queuedBytes += frame.byteLength;

    while (this.queuedBytes > MAX_QUEUED_AUDIO_BYTES && this.queuedFrames.length > 0) {
      const dropped = this.queuedFrames.shift();

      if (dropped) {
        this.queuedBytes -= dropped.frame.byteLength;
      }
    }
  }

  private flushQueuedAudio(): void {
    if (this.state !== 'ready' || !this.child || this.waitingForDrain) {
      return;
    }

    while (this.queuedFrames.length > 0 && !this.waitingForDrain) {
      const queued = this.queuedFrames.shift();

      if (!queued) {
        break;
      }

      this.queuedBytes -= queued.frame.byteLength;

      if (this.activeSources.has(queued.source)) {
        this.writeFrame(queued.frame);
      }
    }
  }

  private removeQueuedSource(source: AudioSource): void {
    this.queuedFrames = this.queuedFrames.filter((queued) => {
      if (queued.source !== source) {
        return true;
      }

      this.queuedBytes -= queued.frame.byteLength;
      return false;
    });
  }

  private scheduleRestart(): void {
    if (this.stopping || this.restartTimer) {
      return;
    }

    this.restartAttempts += 1;
    const delay = Math.min(1000 * 2 ** (this.restartAttempts - 1), MAX_RESTART_DELAY_MS);

    this.setStatus('restarting', `Restarting local transcription in ${Math.round(delay / 1000)}s.`);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      void this.start();
    }, delay);
  }

  private clearRestartTimer(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }

  private setStatus(state: AsrWorkerState, message?: string): void {
    this.state = state;
    this.statusMessage = message;
    this.callbacks.onStatus(this.getStatus());
  }
}

type AsrRuntime = {
  executable: string;
  workingDirectory: string;
  arguments: string[];
};

const getAsrRuntime = (): AsrRuntime | null => {
  const executableName = process.platform === 'win32' ? 'asr-worker.exe' : 'asr-worker';
  const repositoryRoot = resolve(app.getAppPath(), '..', '..');
  const developmentWorkerDirectory = join(repositoryRoot, 'native', 'asr-worker');
  const packagedDirectory = join(process.resourcesPath, 'asr');
  const workerDirectory = app.isPackaged ? packagedDirectory : developmentWorkerDirectory;
  const executableCandidates = app.isPackaged
    ? [join(workerDirectory, executableName)]
    : [
        process.env.ASR_WORKER_PATH,
        join(workerDirectory, 'build', 'Release', executableName),
        join(workerDirectory, 'build', executableName),
      ];
  const executable = executableCandidates.find((candidate): candidate is string =>
    Boolean(candidate && existsSync(candidate)),
  );
  const modelDirectory = process.env.ASR_MODEL_DIR ?? join(workerDirectory, 'models');
  const modelFiles = {
    encoder: join(modelDirectory, 'encoder.onnx'),
    decoder: join(modelDirectory, 'decoder.onnx'),
    joiner: join(modelDirectory, 'joiner.onnx'),
    tokens: join(modelDirectory, 'tokens.txt'),
    bpeVocabulary: join(modelDirectory, 'bpe.vocab'),
    hotwords: join(modelDirectory, 'hotwords.txt'),
  };

  if (
    !executable ||
    !existsSync(modelFiles.encoder) ||
    !existsSync(modelFiles.decoder) ||
    !existsSync(modelFiles.joiner) ||
    !existsSync(modelFiles.tokens)
  ) {
    return null;
  }

  const argumentsList = [
    `--encoder=${modelFiles.encoder}`,
    `--decoder=${modelFiles.decoder}`,
    `--joiner=${modelFiles.joiner}`,
    `--tokens=${modelFiles.tokens}`,
    '--threads=2',
    '--provider=cpu',
    '--decoding-method=modified_beam_search',
  ];

  if (existsSync(modelFiles.hotwords)) {
    if (existsSync(modelFiles.bpeVocabulary)) {
      argumentsList.push(`--bpe-vocab=${modelFiles.bpeVocabulary}`);
    }

    argumentsList.push(`--hotwords=${modelFiles.hotwords}`, '--hotwords-score=1.5');
  }

  return {
    executable,
    workingDirectory: dirname(executable),
    arguments: argumentsList,
  };
};

const createControlFrame = (command: number, source: AudioSource): Buffer => {
  const frame = Buffer.allocUnsafe(6);

  frame.writeUInt8(command, 0);
  frame.writeUInt8(source === 'microphone' ? 1 : 2, 1);
  frame.writeUInt32LE(0, 2);

  return frame;
};

const createAudioFrame = (source: AudioSource, samples: Float32Array): Buffer => {
  const header = Buffer.allocUnsafe(6);

  header.writeUInt8(COMMAND_AUDIO, 0);
  header.writeUInt8(source === 'microphone' ? 1 : 2, 1);
  header.writeUInt32LE(samples.length, 2);

  const payload = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  return Buffer.concat([header, payload]);
};
