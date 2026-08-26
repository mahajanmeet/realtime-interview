const API_URL = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8787';

type HealthResponse = {
  status: 'ok';
};

export const getHealth = async (): Promise<HealthResponse> => {
  const response = await fetch(`${API_URL}/health`);

  if (!response.ok) {
    throw new Error(`Backend responded with ${response.status}`);
  }

  return response.json() as Promise<HealthResponse>;
};
