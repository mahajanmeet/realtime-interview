import { contextBridge, ipcRenderer } from 'electron';

import type {
  AsrResult,
  AsrStartResult,
  AsrStatus,
  AudioSource,
  InterviewApi,
} from '@interview/shared';

const interviewApi: InterviewApi = {
  recording: {
    start: (sessionId: string, source: AudioSource) =>
      ipcRenderer.invoke('recording:start', {
        sessionId,
        source,
      }) as Promise<string>,

    append: (sessionId: string, source: AudioSource, chunk: Uint8Array) =>
      ipcRenderer.invoke('recording:append', {
        sessionId,
        source,
        chunk,
      }) as Promise<void>,

    stop: (sessionId: string, source: AudioSource) =>
      ipcRenderer.invoke('recording:stop', {
        sessionId,
        source,
      }) as Promise<void>,
  },

  asr: {
    start: () => ipcRenderer.invoke('asr:start') as Promise<AsrStartResult>,

    sendAudio: (source: AudioSource, samples: Float32Array) => {
      ipcRenderer.send('asr:audio', {
        source,
        samples,
      });
    },

    reset: (source: AudioSource) => {
      ipcRenderer.send('asr:reset', { source });
    },

    stop: () => ipcRenderer.invoke('asr:stop') as Promise<void>,

    onResult: (handler: (result: AsrResult) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, result: AsrResult): void => {
        handler(result);
      };

      ipcRenderer.on('asr:result', listener);
      return () => {
        ipcRenderer.removeListener('asr:result', listener);
      };
    },

    onStatus: (handler: (status: AsrStatus) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, status: AsrStatus): void => {
        handler(status);
      };

      ipcRenderer.on('asr:status', listener);
      return () => {
        ipcRenderer.removeListener('asr:status', listener);
      };
    },
  },
};

contextBridge.exposeInMainWorld('interviewApi', interviewApi);
