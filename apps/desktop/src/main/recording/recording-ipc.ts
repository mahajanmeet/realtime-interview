import { ipcMain } from 'electron';
import { z } from 'zod';

import type { AudioSource } from '@interview/shared';

import type { RecordingManager } from './recording-manager';

const MAX_RECORDING_CHUNK_BYTES = 16 * 1024 * 1024;

const RecordingTargetSchema = z.object({
  sessionId: z.string().uuid(),
  source: z.enum(['microphone', 'system']),
});

const RecordingChunkSchema = RecordingTargetSchema.extend({
  chunk: z
    .instanceof(Uint8Array)
    .refine((chunk) => chunk.byteLength > 0, 'Recording chunk cannot be empty.')
    .refine(
      (chunk) => chunk.byteLength <= MAX_RECORDING_CHUNK_BYTES,
      'Recording chunk is too large.',
    ),
});

export const registerRecordingIpc = (recordingManager: RecordingManager): void => {
  ipcMain.handle('recording:start', async (_event, payload: unknown) => {
    const target = RecordingTargetSchema.parse(payload);

    return recordingManager.start(target.sessionId, target.source as AudioSource);
  });

  ipcMain.handle('recording:append', async (_event, payload: unknown) => {
    const chunk = RecordingChunkSchema.parse(payload);

    await recordingManager.append(chunk.sessionId, chunk.source as AudioSource, chunk.chunk);
  });

  ipcMain.handle('recording:stop', async (_event, payload: unknown) => {
    const target = RecordingTargetSchema.parse(payload);

    await recordingManager.stop(target.sessionId, target.source as AudioSource);
  });
};
