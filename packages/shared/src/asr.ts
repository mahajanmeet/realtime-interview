import './zod-config';
import { z } from 'zod';

import { AudioSourceSchema, type AudioSource } from './audio';

export const AsrResultSchema = z.object({
  type: z.enum(['partial', 'final']),
  source: AudioSourceSchema,
  segmentId: z.string().min(1),
  text: z.string(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative().nullable(),
});

export type AsrResult = z.infer<typeof AsrResultSchema>;

export const AsrWorkerStateSchema = z.enum([
  'stopped',
  'starting',
  'ready',
  'unavailable',
  'error',
  'restarting',
]);

export type AsrWorkerState = z.infer<typeof AsrWorkerStateSchema>;

export const AsrStatusSchema = z.object({
  state: AsrWorkerStateSchema,
  message: z.string().optional(),
});

export type AsrStatus = z.infer<typeof AsrStatusSchema>;

export type AsrStartResult = {
  available: boolean;
  status: AsrStatus;
};

export type AsrApi = {
  start(): Promise<AsrStartResult>;
  sendAudio(source: AudioSource, samples: Float32Array): void;
  reset(source: AudioSource): void;
  stop(): Promise<void>;
  onResult(handler: (result: AsrResult) => void): () => void;
  onStatus(handler: (status: AsrStatus) => void): () => void;
};
