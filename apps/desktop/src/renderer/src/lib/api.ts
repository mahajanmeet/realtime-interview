const API_URL_STORAGE_KEY = 'realtime-interview.api-url';
const DEFAULT_API_URL = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8787';

const normalizeApiUrl = (value: string): string => {
  let url: URL;

  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('Enter a complete backend URL, for example https://your-service.onrender.com.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('The backend URL must start with http:// or https://.');
  }

  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Enter only the backend origin, without a path, query, or credentials.');
  }

  return url.origin;
};

export const getApiUrl = (): string => {
  try {
    return normalizeApiUrl(localStorage.getItem(API_URL_STORAGE_KEY) ?? DEFAULT_API_URL);
  } catch {
    return normalizeApiUrl(DEFAULT_API_URL);
  }
};

export const setApiUrl = (value: string): string => {
  const normalized = normalizeApiUrl(value);
  localStorage.setItem(API_URL_STORAGE_KEY, normalized);
  return normalized;
};

type HealthResponse = {
  status: 'ok';
};

export type CreatedSession = {
  sessionId: string;
  code: string;
  peerToken: string;
  signalTicket: string;
};

export type JoinedSession = {
  sessionId: string;
  peerToken: string;
  signalTicket: string;
};

type ApiError = {
  message?: string;
};

const getErrorMessage = async (response: Response): Promise<string> => {
  try {
    const body = (await response.json()) as ApiError;

    return body.message ?? 'Request failed.';
  } catch {
    return 'Request failed.';
  }
};

export const getHealth = async (): Promise<HealthResponse> => {
  const response = await fetch(`${getApiUrl()}/health`);

  if (!response.ok) {
    throw new Error(`Backend responded with ${response.status}`);
  }

  return response.json() as Promise<HealthResponse>;
};

export const createSession = async (): Promise<CreatedSession> => {
  const response = await fetch(`${getApiUrl()}/api/sessions`, {
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }

  return response.json() as Promise<CreatedSession>;
};

export const joinSession = async (code: string): Promise<JoinedSession> => {
  const response = await fetch(`${getApiUrl()}/api/sessions/join`, {
    method: 'POST',

    headers: {
      'Content-Type': 'application/json',
    },

    body: JSON.stringify({
      code,
    }),
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }

  return response.json() as Promise<JoinedSession>;
};

export const createSignalTicket = async (sessionId: string, peerToken: string): Promise<string> => {
  const response = await fetch(`${getApiUrl()}/api/sessions/${sessionId}/signal-ticket`, {
    method: 'POST',
    signal: AbortSignal.timeout(15_000),

    headers: {
      'Content-Type': 'application/json',
    },

    body: JSON.stringify({
      peerToken,
    }),
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }

  const body = (await response.json()) as {
    signalTicket: string;
  };

  return body.signalTicket;
};
