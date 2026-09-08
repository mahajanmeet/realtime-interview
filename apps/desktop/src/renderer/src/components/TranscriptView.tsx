import { useEffect, useRef, useState, type JSX } from 'react';

import type { AsrStatus } from '@interview/shared';

import type { TranscriptEntry } from '../features/transcript/transcript-store';

type TranscriptViewProps = {
  segments: TranscriptEntry[];
  asrStatus: AsrStatus;
};

export const TranscriptView = ({ segments, asrStatus }: TranscriptViewProps): JSX.Element => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const [following, setFollowing] = useState(true);
  const [copyStatus, setCopyStatus] = useState('');
  useEffect(() => {
    if (followRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [segments]);
  const copyTranscript = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(
        segments
          .map(
            (segment) =>
              `[${formatTimestamp(segment.startMs)}] ${segment.speaker}${segment.source === 'system' ? ' (system audio)' : ''}: ${segment.text}`,
          )
          .join('\n\n'),
      );
      setCopyStatus('Transcript copied');
    } catch {
      setCopyStatus('Could not copy. Select the transcript text to copy it manually.');
    }
  };
  return (
    <aside className="transcript-panel" aria-label="Live transcript">
      <header className="transcript-header">
        <div>
          <span className="transcript-eyebrow">Live transcript</span>
          <h2>Conversation</h2>
        </div>

        <span className={`asr-state asr-state-${asrStatus.state}`}>
          <span aria-hidden="true" />
          Local: {getAsrStatusLabel(asrStatus)}
        </span>
      </header>

      {asrStatus.message && asrStatus.state !== 'ready' && (
        <p className="transcript-message">{asrStatus.message}</p>
      )}

      <div className="transcript-toolbar">
        <span>
          {segments.filter((segment) => segment.status === 'final').length} completed segments
        </span>
        <button
          type="button"
          className="secondary-button"
          disabled={!segments.length}
          onClick={() => void copyTranscript()}
        >
          Copy transcript
        </button>
      </div>
      {copyStatus && (
        <p className="copy-status" role="status">
          {copyStatus}
        </p>
      )}
      <div
        className="transcript-segments"
        ref={scrollRef}
        tabIndex={0}
        aria-label="Conversation transcript"
        onScroll={(event) => {
          const element = event.currentTarget;
          followRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 64;
          setFollowing(followRef.current);
        }}
      >
        {segments.length === 0 ? (
          <p className="transcript-empty">
            {asrStatus.state === 'ready'
              ? 'Ready to listen. Speak with your microphone enabled to see words appear here.'
              : 'Your conversation will appear here as speech is transcribed. Local transcription status is shown above.'}
          </p>
        ) : (
          segments.map((segment) => (
            <article
              key={`${segment.speaker}:${segment.id}`}
              className={`transcript-segment speaker-${segment.speaker} ${segment.status === 'partial' ? 'partial' : ''}`}
            >
              <div className="transcript-meta">
                <time>{formatTimestamp(segment.startMs)}</time>
                <strong>
                  {segment.speaker === 'interviewer' ? 'Interviewer' : 'Candidate'}
                  {segment.source === 'system' ? ' · System audio' : ''}
                </strong>
              </div>
              <p>{segment.text}</p>
            </article>
          ))
        )}
      </div>
      <footer className="transcript-footer">
        <span>Live text may update as you speak.</span>
        {!following && (
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              followRef.current = true;
              setFollowing(true);
              if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            }}
          >
            Jump to latest
          </button>
        )}
      </footer>
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
