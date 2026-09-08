import { useEffect, useRef, useState, type JSX } from 'react';

import type { AppRole } from '@interview/shared';

import type { ConnectionStats } from '../lib/webrtc/connection-stats';

type ConnectionInfoProps = {
  role: AppRole;
  connectionStatus: string;
  documentReady: boolean;
  microphoneConnected: boolean;
  systemAudioConnected: boolean;
  outgoingMicrophoneActive?: boolean;
  audioPipelineStatus?: {
    microphone: {
      recording: boolean;
      pcm: boolean;
    };
    system: {
      recording: boolean;
      pcm: boolean;
    };
  };
  networkStats: ConnectionStats | null;
};

export const ConnectionInfo = ({
  role,
  connectionStatus,
  documentReady,
  microphoneConnected,
  systemAudioConnected,
  outgoingMicrophoneActive,
  audioPipelineStatus,
  networkStats,
}: ConnectionInfoProps): JSX.Element => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const dismissOutside = (event: PointerEvent): void => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const dismissWithEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('keydown', dismissWithEscape);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('keydown', dismissWithEscape);
    };
  }, [open]);

  return (
    <div className="connection-info" ref={containerRef}>
      <button
        ref={buttonRef}
        type="button"
        className="info-button"
        aria-label="Connection information"
        aria-expanded={open}
        aria-controls="connection-details"
        onClick={() => setOpen((current) => !current)}
      >
        {'\u24d8'}
      </button>

      {open && (
        <div
          className="info-popover"
          id="connection-details"
          role="region"
          aria-label="Connection details"
        >
          <InfoRow label="Connection" value={connectionStatus} />
          <InfoRow label="Role" value={role} />
          <InfoRow label="Document" value={documentReady ? 'Connected' : 'Waiting'} />
          <InfoRow label="Microphone" value={microphoneConnected ? 'Connected' : 'Not shared'} />
          <InfoRow label="System audio" value={systemAudioConnected ? 'Connected' : 'Not shared'} />

          {typeof outgoingMicrophoneActive === 'boolean' && (
            <InfoRow
              label="Your microphone"
              value={outgoingMicrophoneActive ? 'Sending' : 'Muted'}
            />
          )}

          {audioPipelineStatus && (
            <>
              <InfoRow
                label="Mic recording"
                value={audioPipelineStatus.microphone.recording ? 'Active' : 'Waiting'}
              />
              <InfoRow
                label="Mic PCM"
                value={audioPipelineStatus.microphone.pcm ? '16 kHz active' : 'Waiting'}
              />
              <InfoRow
                label="System recording"
                value={audioPipelineStatus.system.recording ? 'Active' : 'Waiting'}
              />
              <InfoRow
                label="System PCM"
                value={audioPipelineStatus.system.pcm ? '16 kHz active' : 'Waiting'}
              />
            </>
          )}

          {networkStats && (
            <>
              <InfoRow label="Network" value={networkStats.quality} />
              <InfoRow
                label="RTT"
                value={
                  networkStats.roundTripTimeMs === null
                    ? '\u2014'
                    : `${Math.round(networkStats.roundTripTimeMs)} ms`
                }
              />
              <InfoRow
                label="Jitter"
                value={
                  networkStats.jitterMs === null
                    ? '\u2014'
                    : `${Math.round(networkStats.jitterMs)} ms`
                }
              />
              <InfoRow label="Codec" value={networkStats.codec ?? '\u2014'} />
              <InfoRow label="Transport" value={networkStats.protocol ?? '\u2014'} />
              <InfoRow label="Route" value={networkStats.candidateType ?? '\u2014'} />
            </>
          )}
        </div>
      )}
    </div>
  );
};

const InfoRow = ({ label, value }: { label: string; value: string }): JSX.Element => (
  <div className="info-row">
    <span>{label}</span>
    <strong>{value}</strong>
  </div>
);
