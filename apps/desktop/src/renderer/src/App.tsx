import type { JSX } from 'react';
import { useEffect, useState } from 'react';

import { getHealth } from './lib/api';

type BackendStatus = 'checking' | 'online' | 'offline';

export const App = (): JSX.Element => {
  const [backendStatus, setBackendStatus] = useState<BackendStatus>('checking');

  useEffect(() => {
    const checkBackend = async (): Promise<void> => {
      try {
        await getHealth();
        setBackendStatus('online');
      } catch {
        setBackendStatus('offline');
      }
    };

    void checkBackend();
  }, []);

  return (
    <main className="page">
      <section className="card">
        <h1>Realtime Interview</h1>

        <p>Secure interview audio, transcription and chat.</p>

        <div className="status">
          Backend status: <strong>{backendStatus}</strong>
        </div>
      </section>
    </main>
  );
};
