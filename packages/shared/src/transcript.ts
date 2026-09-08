import './zod-config';
import { z } from 'zod';

import { AudioSourceSchema } from './audio';

export const TranscriptSegmentSchema = z.object({
  id: z.string(),
  source: AudioSourceSchema,
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative().nullable(),
  text: z.string(),
  rawText: z.string().optional(),
  status: z.enum(['partial', 'final']),
});

export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;
