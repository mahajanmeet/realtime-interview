import type { InterviewApi } from '@interview/shared';

declare global {
  interface Window {
    readonly interviewApi: InterviewApi;
  }
}

export {};
