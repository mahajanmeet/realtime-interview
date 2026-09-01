import { z } from 'zod';

export const AudioSourceSchema = z.enum(['microphone', 'system']);

export type AudioSource = z.infer<typeof AudioSourceSchema>;
