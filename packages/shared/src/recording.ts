import type { AudioSource } from './audio';
import type { AsrApi } from './asr';

export type RecordingApi = {
  start(sessionId: string, source: AudioSource): Promise<string>;
  append(sessionId: string, source: AudioSource, chunk: Uint8Array): Promise<void>;
  stop(sessionId: string, source: AudioSource): Promise<void>;
};

export type InterviewApi = {
  recording: RecordingApi;
  asr: AsrApi;
};
