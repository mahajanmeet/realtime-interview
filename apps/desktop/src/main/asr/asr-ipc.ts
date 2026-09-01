import { ipcMain, type WebContents } from 'electron';
import { z } from 'zod';

import type { AsrResult, AsrStatus, AudioSource } from '@interview/shared';

import { AsrProcess } from './asr-process';

const MAX_AUDIO_SAMPLES = 16_000;

const AudioPayloadSchema = z.object({
  source: z.enum(['microphone', 'system']),
  samples: z
    .instanceof(Float32Array)
    .refine((samples) => samples.length > 0, 'ASR samples cannot be empty.')
    .refine((samples) => samples.length <= MAX_AUDIO_SAMPLES, 'ASR audio chunk is too large.')
    .refine(
      (samples) => samples.every((sample) => Number.isFinite(sample) && Math.abs(sample) <= 1.5),
      'ASR samples must contain normalized finite PCM values.',
    ),
});

const SourcePayloadSchema = z.object({
  source: z.enum(['microphone', 'system']),
});

export const registerAsrIpc = (): AsrProcess => {
  const subscribers = new Set<WebContents>();
  const process = new AsrProcess({
    onResult: (result: AsrResult) => {
      broadcast(subscribers, 'asr:result', result);
    },
    onStatus: (status: AsrStatus) => {
      broadcast(subscribers, 'asr:status', status);
    },
  });

  ipcMain.handle('asr:start', async (event) => {
    const sender = event.sender;

    subscribers.add(sender);
    sender.once('destroyed', () => {
      subscribers.delete(sender);

      if (subscribers.size === 0) {
        void process.stop();
      }
    });

    return process.start();
  });

  ipcMain.on('asr:audio', (event, payload: unknown) => {
    if (!subscribers.has(event.sender)) {
      return;
    }

    const parsed = AudioPayloadSchema.safeParse(payload);

    if (!parsed.success) {
      return;
    }

    process.sendAudio(parsed.data.source as AudioSource, parsed.data.samples);
  });

  ipcMain.on('asr:reset', (event, payload: unknown) => {
    if (!subscribers.has(event.sender)) {
      return;
    }

    const parsed = SourcePayloadSchema.safeParse(payload);

    if (parsed.success) {
      process.reset(parsed.data.source as AudioSource);
    }
  });

  ipcMain.handle('asr:stop', async (event) => {
    subscribers.delete(event.sender);

    if (subscribers.size === 0) {
      await process.stop();
    }
  });

  return process;
};

const broadcast = (subscribers: Set<WebContents>, channel: string, payload: unknown): void => {
  for (const subscriber of subscribers) {
    if (subscriber.isDestroyed()) {
      subscribers.delete(subscriber);
      continue;
    }

    subscriber.send(channel, payload);
  }
};
