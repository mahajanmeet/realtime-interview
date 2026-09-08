import './zod-config';
import { z } from 'zod';

import { AudioSourceSchema } from './audio';

export const FinalTranscriptSegmentSchema = z.object({
  id: z.string().min(1),
  source: AudioSourceSchema,
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  liveText: z.string(),
  finalText: z.string(),
  confidence: z.enum(['high', 'medium', 'low']),
});

export const FinalizationStateSchema = z.enum(['pending', 'processing', 'complete', 'failed']);

export type FinalTranscriptSegment = z.infer<typeof FinalTranscriptSegmentSchema>;
export type FinalizationState = z.infer<typeof FinalizationStateSchema>;
