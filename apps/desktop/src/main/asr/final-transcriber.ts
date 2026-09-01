import type { AudioSource } from '@interview/shared';

export type FinalizeRequest = {
  sessionId: string;
  source: AudioSource;
  filePath: string;
};

export type FinalizeResult = {
  segments: {
    startMs: number;
    endMs: number;
    text: string;
  }[];
};

export interface FinalTranscriber {
  transcribe(request: FinalizeRequest): Promise<FinalizeResult>;
}
