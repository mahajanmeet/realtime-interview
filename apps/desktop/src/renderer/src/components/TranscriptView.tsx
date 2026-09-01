import type { JSX } from 'react';

import type { AsrStatus, TranscriptSegment } from '@interview/shared';

type TranscriptViewProps = {
  segments: TranscriptSegment[];
  asrStatus: AsrStatus;
};

export const TranscriptView = ({ segments, asrStatus }: TranscriptViewProps): JSX.Element => {
  return (
    <aside className="transcript-panel" aria-label="Live transcript">
      <header className="transcript-header">
        <div>
          <span className="transcript-eyebrow">Live transcript</span>
          <h2>Conversation</h2>
        </div>

        <span className={`asr-state asr-state-${asrStatus.state}`}>
          <span aria-hidden="true" />
          {getAsrStatusLabel(asrStatus)}
        </span>
      </header>

      {asrStatus.message && asrStatus.state !== 'ready' && (
        <p className="transcript-message">{asrStatus.message}</p>
      )}

      <div className="transcript-segments" aria-live="polite">
        {segments.length === 0 ? (
          <p className="transcript-empty">
            {asrStatus.state === 'ready'
              ? 'Listening for candidate and system audio...'
              : 'Transcript will appear when the local ASR worker is ready.'}
          </p>
        ) : (
          segments.map((segment) => (
            <article
              key={segment.id}
              className={`transcript-segment ${segment.status === 'partial' ? 'partial' : ''}`}
            >
              <div className="transcript-meta">
                <time>{formatTimestamp(segment.startMs)}</time>
                <strong>{segment.source === 'microphone' ? 'Candidate' : 'System'}</strong>
              </div>
              <p>{segment.text}</p>
            </article>
          ))
        )}
      </div>
    </aside>
  );
};

const formatTimestamp = (milliseconds: number): string => {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

const getAsrStatusLabel = (status: AsrStatus): string => {
  switch (status.state) {
    case 'ready':
      return 'Live';
    case 'starting':
      return 'Starting';
    case 'restarting':
      return 'Restarting';
    case 'unavailable':
      return 'Unavailable';
    case 'error':
      return 'Error';
    default:
      return 'Stopped';
  }
};
