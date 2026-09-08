import { useEffect, useRef, useState, type JSX } from 'react';

import type {
  AppRole,
  AsrStatus,
  AudioSource,
  DocumentUpdate,
  ServerSignalMessage,
} from '@interview/shared';

import { ConnectionInfo } from './components/ConnectionInfo';
import { DocumentEditor } from './components/DocumentEditor';
import { TranscriptView } from './components/TranscriptView';
import { IncomingAudioPipeline } from './features/audio/incoming-audio-pipeline';
import { getMicrophoneStream, stopMediaStream } from './features/audio/microphone';
import { getSystemAudioStream } from './features/audio/system-audio';
import { TranscriptStore, type TranscriptEntry } from './features/transcript/transcript-store';
import { TerminologyEngine } from './features/transcript/terminology-engine';
import { interviewVocabulary } from './features/transcript/vocabulary';
import { createSession, createSignalTicket, getApiUrl, joinSession, setApiUrl } from './lib/api';
import { AsrClient } from './lib/asr-client';
import { logger } from './lib/logger';
import { SignalingClient } from './lib/signaling';
import type { ConnectionStats } from './lib/webrtc/connection-stats';
import { RealtimePeer, type LocalAudioStreams } from './lib/webrtc/realtime-peer';
import { getRtcConfiguration } from './lib/webrtc/rtc-config';

const DOCUMENT_SEND_DELAY_MS = 50;
const MAX_DOCUMENT_CHARACTERS = 250_000;

type SessionStatus =
  'idle' | 'waiting' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'failed';
type CaptureStatus = 'idle' | 'starting' | 'ready' | 'error';
type InterviewerMicrophoneStatus = 'off' | 'starting' | 'on' | 'error';
type AudioPipelineStatus = Record<
  AudioSource,
  {
    recording: boolean;
    pcm: boolean;
  }
>;

type ActiveSession = {
  sessionId: string;
  peerToken: string;
};

export const App = (): JSX.Element => {
  const signalingRef = useRef<SignalingClient | null>(null);
  const peerRef = useRef<RealtimePeer | null>(null);
  const sessionRef = useRef<ActiveSession | null>(null);
  const hasConnectedRef = useRef(false);
  const remoteMicrophoneAudioRef = useRef<HTMLAudioElement | null>(null);
  const remoteSystemAudioRef = useRef<HTMLAudioElement | null>(null);
  const systemAudioStreamRef = useRef<MediaStream | null>(null);
  const interviewerMicrophoneStreamRef = useRef<MediaStream | null>(null);
  const incomingAudioPipelinesRef = useRef(
    new Map<AudioSource, { stream: MediaStream; pipeline: IncomingAudioPipeline }>(),
  );
  const incomingAudioPipelineVersionsRef = useRef(new Map<AudioSource, number>());
  const asrClientRef = useRef(new AsrClient());
  const transcriptStoreRef = useRef(new TranscriptStore());
  const terminologyEngineRef = useRef(new TerminologyEngine(interviewVocabulary));
  const documentIdRef = useRef<string>(crypto.randomUUID());
  const revisionRef = useRef(0);
  const sendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [role, setRole] = useState<AppRole | null>(null);
  const [backendUrl, setBackendUrl] = useState(getApiUrl);
  const [joinCode, setJoinCode] = useState('');
  const [displayCode, setDisplayCode] = useState('');
  const [status, setStatus] = useState<SessionStatus>('idle');
  const [hasConnected, setHasConnected] = useState(false);
  const [hasSignalingPeer, setHasSignalingPeer] = useState(false);
  const [documentText, setDocumentText] = useState('');
  const [documentReady, setDocumentReady] = useState(false);
  const [remoteMicrophoneStream, setRemoteMicrophoneStream] = useState<MediaStream | null>(null);
  const [remoteSystemStream, setRemoteSystemStream] = useState<MediaStream | null>(null);
  const [candidateMicrophoneActive, setCandidateMicrophoneActive] = useState(false);
  const [microphoneTestStatus, setMicrophoneTestStatus] = useState<CaptureStatus>('idle');
  const [microphoneEnabled, setMicrophoneEnabled] = useState(true);
  const [systemAudioEnabled, setSystemAudioEnabled] = useState(false);
  const [systemAudioStatus, setSystemAudioStatus] = useState<CaptureStatus>('idle');
  const [interviewerMicrophoneStatus, setInterviewerMicrophoneStatus] =
    useState<InterviewerMicrophoneStatus>('off');
  const [audioPipelineStatus, setAudioPipelineStatus] = useState<AudioPipelineStatus>(() =>
    createEmptyAudioPipelineStatus(),
  );
  const [asrStatus, setAsrStatus] = useState<AsrStatus>({ state: 'stopped' });
  const [transcriptSegments, setTranscriptSegments] = useState<TranscriptEntry[]>([]);
  const [networkStats, setNetworkStats] = useState<ConnectionStats | null>(null);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [setupMode, setSetupMode] = useState<'create' | 'join'>('create');
  const [sessionBusy, setSessionBusy] = useState(false);
  const sessionBusyRef = useRef(false);
  const [copyMessage, setCopyMessage] = useState('');

  const runSessionAction = async (action: () => Promise<void>): Promise<void> => {
    if (sessionBusyRef.current) return;
    sessionBusyRef.current = true;
    setSessionBusy(true);
    try {
      await action();
    } finally {
      sessionBusyRef.current = false;
      setSessionBusy(false);
    }
  };

  const copyInterviewCode = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(displayCode);
      setCopyMessage('Code copied');
    } catch {
      setCopyMessage('Select the code and copy it manually.');
    }
  };

  const saveBackendUrl = (): boolean => {
    try {
      const savedUrl = setApiUrl(backendUrl);
      setBackendUrl(savedUrl);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The backend URL is invalid.');
      return false;
    }
  };

  useEffect(() => {
    return () => {
      if (sendTimerRef.current) {
        clearTimeout(sendTimerRef.current);
      }

      peerRef.current?.close();
      signalingRef.current?.disconnect();
      void asrClientRef.current.stop();

      for (const { pipeline } of incomingAudioPipelinesRef.current.values()) {
        void pipeline.stop();
      }

      incomingAudioPipelinesRef.current.clear();

      if (systemAudioStreamRef.current) {
        stopMediaStream(systemAudioStreamRef.current);
      }

      if (interviewerMicrophoneStreamRef.current) {
        stopMediaStream(interviewerMicrophoneStreamRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const asrClient = asrClientRef.current;
    const removeResultHandler = asrClient.onResult((result) => {
      const activeRole = role;

      if (!activeRole) {
        return;
      }

      const normalized = terminologyEngineRef.current.normalize(
        result.text,
        transcriptStoreRef.current.recentFinalText(activeRole, result.source),
      );

      const segment: TranscriptEntry = {
        id: result.segmentId,
        source: result.source,
        startMs: result.startMs,
        endMs: result.endMs,
        text: normalized.text,
        rawText: result.text,
        status: result.type,
        speaker: activeRole,
      };

      transcriptStoreRef.current.upsert(segment);
      setTranscriptSegments(transcriptStoreRef.current.all());

      try {
        signalingRef.current?.send({
          type: 'transcript-segment',
          segment: {
            id: segment.id,
            source: segment.source,
            startMs: segment.startMs,
            endMs: segment.endMs,
            text: segment.text,
            rawText: segment.rawText,
            status: segment.status,
          },
        });
      } catch (cause) {
        logger.warn('Transcript segment will remain local until signaling reconnects.', {
          error: cause instanceof Error ? cause.message : 'Unknown error',
        });
      }
    });
    const removeStatusHandler = asrClient.onStatus(setAsrStatus);

    return () => {
      removeResultHandler();
      removeStatusHandler();
    };
  }, [role]);

  useEffect(() => {
    playRemoteAudio(remoteMicrophoneAudioRef.current, remoteMicrophoneStream, setError);
  }, [remoteMicrophoneStream]);

  useEffect(() => {
    playRemoteAudio(remoteSystemAudioRef.current, remoteSystemStream, setError);
  }, [remoteSystemStream]);

  useEffect(() => {
    if (status !== 'connected') {
      setNetworkStats(null);
      return;
    }

    const collectStats = (): void => {
      const peer = peerRef.current;

      if (!peer) {
        return;
      }

      void peer
        .getConnectionStats()
        .then(setNetworkStats)
        .catch((cause: unknown) => {
          logger.warn('Could not collect WebRTC diagnostics.', {
            error: cause instanceof Error ? cause.message : 'Unknown error',
          });
        });
    };

    collectStats();
    const interval = window.setInterval(collectStats, 2000);

    return () => {
      window.clearInterval(interval);
    };
  }, [status]);

  const resetDocument = (): void => {
    if (sendTimerRef.current) {
      clearTimeout(sendTimerRef.current);
      sendTimerRef.current = null;
    }

    documentIdRef.current = crypto.randomUUID();
    revisionRef.current = 0;
    setDocumentText('');
    setDocumentReady(false);
  };

  const resetSystemAudio = (): void => {
    if (systemAudioStreamRef.current) {
      stopMediaStream(systemAudioStreamRef.current);
      systemAudioStreamRef.current = null;
    }

    setSystemAudioStatus('idle');
    setSystemAudioEnabled(false);
  };

  const reconnectSignaling = async (): Promise<string> => {
    const session = sessionRef.current;

    if (!session) {
      throw new Error('Active session credentials are unavailable.');
    }

    logger.info('Refreshing signaling ticket.');
    return createSignalTicket(session.sessionId, session.peerToken);
  };

  const updateAudioPipelineStatus = (
    source: AudioSource,
    update: Partial<AudioPipelineStatus[AudioSource]>,
  ): void => {
    setAudioPipelineStatus((current) => ({
      ...current,
      [source]: {
        ...current[source],
        ...update,
      },
    }));
  };

  const startIncomingAudioPipeline = async (
    source: AudioSource,
    stream: MediaStream,
  ): Promise<void> => {
    const sessionId = sessionRef.current?.sessionId;

    if (!sessionId) {
      setError('Recording could not start because the session identifier is unavailable.');
      return;
    }

    const version = (incomingAudioPipelineVersionsRef.current.get(source) ?? 0) + 1;
    incomingAudioPipelineVersionsRef.current.set(source, version);

    const previous = incomingAudioPipelinesRef.current.get(source);

    if (previous) {
      incomingAudioPipelinesRef.current.delete(source);
      await previous.pipeline.stop().catch((cause: unknown) => {
        logger.warn('Could not stop the previous incoming audio pipeline.', {
          source,
          error: cause instanceof Error ? cause.message : 'Unknown error',
        });
      });
    }

    if (incomingAudioPipelineVersionsRef.current.get(source) !== version) {
      return;
    }

    updateAudioPipelineStatus(source, { recording: false, pcm: false });

    const pipeline = new IncomingAudioPipeline(sessionId, source, {
      onRecordingStarted: (activeSource) => {
        if (incomingAudioPipelinesRef.current.get(activeSource)?.pipeline !== pipeline) {
          return;
        }

        updateAudioPipelineStatus(activeSource, { recording: true });
      },
      onPcmStarted: (activeSource) => {
        if (incomingAudioPipelinesRef.current.get(activeSource)?.pipeline !== pipeline) {
          return;
        }

        updateAudioPipelineStatus(activeSource, { pcm: true });
      },
      onPcmChunk: (activeSource, samples) => {
        if (incomingAudioPipelinesRef.current.get(activeSource)?.pipeline !== pipeline) {
          return;
        }

        asrClientRef.current.sendAudio(activeSource, samples);
      },
      onError: (activeSource, pipelineError) => {
        if (incomingAudioPipelinesRef.current.get(activeSource)?.pipeline !== pipeline) {
          return;
        }

        logger.error('Incoming audio capture failed.', {
          source: activeSource,
          error: pipelineError.message,
        });
        setError(`${getAudioSourceLabel(activeSource)} capture failed: ${pipelineError.message}`);
      },
    });

    incomingAudioPipelinesRef.current.set(source, { stream, pipeline });

    try {
      await pipeline.start(stream);

      if (incomingAudioPipelineVersionsRef.current.get(source) !== version) {
        await pipeline.stop();
      }
    } catch {
      const active = incomingAudioPipelinesRef.current.get(source);

      if (active?.pipeline === pipeline) {
        incomingAudioPipelinesRef.current.delete(source);
        updateAudioPipelineStatus(source, { recording: false, pcm: false });
      }
    }
  };

  const stopIncomingAudioPipeline = async (
    source: AudioSource,
    stream?: MediaStream,
  ): Promise<void> => {
    const active = incomingAudioPipelinesRef.current.get(source);

    if (!active || (stream && active.stream !== stream)) {
      return;
    }

    incomingAudioPipelineVersionsRef.current.set(
      source,
      (incomingAudioPipelineVersionsRef.current.get(source) ?? 0) + 1,
    );
    incomingAudioPipelinesRef.current.delete(source);
    updateAudioPipelineStatus(source, { recording: false, pcm: false });
    asrClientRef.current.reset(source);

    await active.pipeline.stop().catch((cause: unknown) => {
      const pipelineError =
        cause instanceof Error ? cause : new Error(`Could not stop ${source} capture.`);
      logger.warn('Could not stop incoming audio capture.', {
        source,
        error: pipelineError.message,
      });
      setError(`${getAudioSourceLabel(source)} recording could not be finalized.`);
    });
  };

  const handleRemoteAudioTrack = (
    appRole: AppRole,
    source: AudioSource,
    stream: MediaStream,
  ): void => {
    const track = stream.getAudioTracks()[0];
    const updateStream = source === 'system' ? setRemoteSystemStream : setRemoteMicrophoneStream;

    updateStream(stream);

    track?.addEventListener(
      'ended',
      () => {
        updateStream((current) => (current === stream ? null : current));
      },
      { once: true },
    );
  };

  const startLocalTranscriptPipeline = (source: AudioSource, stream: MediaStream): void => {
    void startIncomingAudioPipeline(source, stream);

    stream.getAudioTracks()[0]?.addEventListener(
      'ended',
      () => {
        void stopIncomingAudioPipeline(source, stream);
      },
      { once: true },
    );
  };

  const handleRealtimeError = (cause: unknown): void => {
    const message = cause instanceof Error ? cause.message : 'Realtime connection failed.';

    logger.error('Realtime connection failed.', { error: message });
    setError(message);
    setStatus('failed');
  };

  const startRealtime = async (
    appRole: AppRole,
    signalTicket: string,
    localAudio?: LocalAudioStreams,
  ): Promise<void> => {
    peerRef.current?.close();
    signalingRef.current?.disconnect();

    const session = sessionRef.current;

    if (!session) {
      throw new Error('Active session credentials are unavailable.');
    }

    const rtcConfiguration = await getRtcConfiguration(session.sessionId, session.peerToken);
    let peer: RealtimePeer;

    const signaling = new SignalingClient({
      onOpen: () => {
        setStatus(hasConnectedRef.current ? 'connected' : 'waiting');
      },
      onClose: () => {
        setStatus('reconnecting');
      },
      onReconnecting: () => {
        setStatus('reconnecting');
      },
      onReconnectRequested: reconnectSignaling,
      onMessage: (message: ServerSignalMessage) => {
        if (message.type === 'peer-connected') {
          setHasSignalingPeer(true);
          setStatus(hasConnectedRef.current ? 'connected' : 'connecting');

          if (appRole === 'interviewer') {
            const negotiate = hasConnectedRef.current ? peer.restartIce() : peer.startOffer();
            void negotiate.catch(handleRealtimeError);
          }

          return;
        }

        if (message.type === 'peer-disconnected') {
          setHasSignalingPeer(false);
          setStatus(hasConnectedRef.current ? 'reconnecting' : 'disconnected');
          return;
        }

        if (message.type === 'transcript-segment') {
          transcriptStoreRef.current.upsert({
            ...message.segment,
            speaker: message.speaker,
          });
          setTranscriptSegments(transcriptStoreRef.current.all());
          return;
        }

        if (message.type === 'error') {
          setError(message.message);
          return;
        }

        void peer.handleSignal(message).catch(handleRealtimeError);
      },
    });

    peer = new RealtimePeer({
      role: appRole,
      signaling,
      rtcConfiguration,
      localAudio,
      callbacks: {
        onConnectionState: (connectionState) => {
          if (connectionState === 'connected') {
            hasConnectedRef.current = true;
            setStatus('connected');
            setHasConnected(true);
            return;
          }

          if (connectionState === 'failed') {
            setStatus('failed');
            setError(
              'The peer audio connection could not be established. Live transcription and text sync remain active; configure TURN only if you also need remote live audio.',
            );
            return;
          }

          if (connectionState === 'disconnected') {
            setStatus('reconnecting');
            return;
          }

          if (connectionState === 'closed') {
            setStatus('disconnected');
          }
        },
        onDocumentUpdate: (update: DocumentUpdate) => {
          if (update.revision < revisionRef.current) {
            return;
          }

          documentIdRef.current = update.documentId;
          revisionRef.current = update.revision;
          setDocumentText(update.text);
        },
        onDocumentReady: setDocumentReady,
        onRemoteAudioTrack: (source, stream) => {
          handleRemoteAudioTrack(appRole, source, stream);
        },
      },
    });

    signalingRef.current = signaling;
    peerRef.current = peer;
    signaling.connect(signalTicket);
  };

  const handleCreate = async (): Promise<void> => {
    try {
      setError('');
      setWarning('');
      if (!saveBackendUrl()) {
        return;
      }
      hasConnectedRef.current = false;
      setHasConnected(false);
      setRemoteMicrophoneStream(null);
      setRemoteSystemStream(null);
      setCandidateMicrophoneActive(false);
      setHasSignalingPeer(false);
      resetSystemAudio();
      resetDocument();
      transcriptStoreRef.current.clear();
      setTranscriptSegments([]);
      setAsrStatus({ state: 'starting' });

      const session = await createSession();
      sessionRef.current = { sessionId: session.sessionId, peerToken: session.peerToken };

      setRole('interviewer');
      setDisplayCode(session.code);
      await startRealtime('interviewer', session.signalTicket);

      void asrClientRef.current.start().catch((cause: unknown) => {
        const message =
          cause instanceof Error ? cause.message : 'Local transcription could not start.';
        setAsrStatus({ state: 'error', message });
        logger.warn('Local transcription could not start.', { error: message });
      });
    } catch (cause) {
      handleRealtimeError(cause);
    }
  };

  const handleSystemAudioToggle = async (): Promise<void> => {
    if (systemAudioStreamRef.current) {
      resetSystemAudio();
      setError('');
      return;
    }

    try {
      setError('');
      setSystemAudioStatus('starting');
      const { stream, track } = await getSystemAudioStream();

      systemAudioStreamRef.current = stream;
      setSystemAudioStatus('ready');
      setSystemAudioEnabled(true);
      track.addEventListener(
        'ended',
        () => {
          if (systemAudioStreamRef.current === stream) {
            systemAudioStreamRef.current = null;
            setSystemAudioStatus('idle');
            setSystemAudioEnabled(false);
          }
        },
        { once: true },
      );
    } catch (cause) {
      setSystemAudioStatus('error');
      setError(cause instanceof Error ? cause.message : 'Could not capture system audio.');
    }
  };

  const handleSystemAudioSelection = async (enabled: boolean): Promise<void> => {
    if (!enabled) {
      resetSystemAudio();
      setError('');
      return;
    }

    await handleSystemAudioToggle();
  };

  const handleMicrophoneTest = async (): Promise<void> => {
    let stream: MediaStream | null = null;

    try {
      setError('');
      setMicrophoneTestStatus('starting');
      stream = await getMicrophoneStream();

      const track = stream.getAudioTracks()[0];

      if (!track || track.readyState !== 'live') {
        throw new Error('The microphone did not provide a live audio track.');
      }

      setMicrophoneTestStatus('ready');
    } catch (cause) {
      setMicrophoneTestStatus('error');
      setError(cause instanceof Error ? cause.message : 'Could not test the microphone.');
    } finally {
      if (stream) {
        stopMediaStream(stream);
      }
    }
  };

  const handleJoin = async (): Promise<void> => {
    let microphone: MediaStream | undefined;
    let microphoneWarning = '';

    try {
      setError('');
      setWarning('');
      if (!saveBackendUrl()) {
        return;
      }
      const normalizedCode = joinCode.replace(/\D/g, '');

      if (normalizedCode.length !== 6) {
        setError('Enter the 6-digit interview code.');
        return;
      }

      const systemAudio = systemAudioEnabled ? systemAudioStreamRef.current : null;

      if (!microphoneEnabled && !systemAudio) {
        setError('Turn on microphone or system audio before joining.');
        return;
      }

      if (microphoneEnabled) {
        try {
          microphone = await getMicrophoneStream();
          setCandidateMicrophoneActive(true);
          microphone.getAudioTracks()[0]?.addEventListener(
            'ended',
            () => {
              setCandidateMicrophoneActive(false);
            },
            { once: true },
          );
        } catch (cause) {
          const message =
            cause instanceof Error ? cause.message : 'Could not access the microphone.';
          microphoneWarning = `${message} You can continue without microphone audio.`;
          setCandidateMicrophoneActive(false);
        }
      } else {
        setCandidateMicrophoneActive(false);
      }

      const session = await joinSession(normalizedCode);
      sessionRef.current = { sessionId: session.sessionId, peerToken: session.peerToken };

      setRole('candidate');
      hasConnectedRef.current = false;
      setHasConnected(false);
      setHasSignalingPeer(false);
      setRemoteMicrophoneStream(null);
      setRemoteSystemStream(null);
      setWarning(microphoneWarning);
      resetDocument();
      await startRealtime('candidate', session.signalTicket, {
        microphone,
        system: systemAudio ?? undefined,
      });

      void asrClientRef.current.start().catch((cause: unknown) => {
        const message =
          cause instanceof Error ? cause.message : 'Local transcription could not start.';
        setAsrStatus({ state: 'error', message });
        logger.warn('Local transcription could not start.', { error: message });
      });

      if (microphone) {
        startLocalTranscriptPipeline('microphone', microphone);
      }

      if (systemAudio) {
        startLocalTranscriptPipeline('system', systemAudio);
      }

      microphone = undefined;
    } catch (cause) {
      if (microphone) {
        stopMediaStream(microphone);
        setCandidateMicrophoneActive(false);
      }

      resetSystemAudio();

      handleRealtimeError(cause);
    }
  };

  const handleInterviewerMicrophoneToggle = async (): Promise<void> => {
    const peer = peerRef.current;

    if (!peer || interviewerMicrophoneStatus === 'starting') {
      return;
    }

    if (interviewerMicrophoneStatus === 'on') {
      try {
        setInterviewerMicrophoneStatus('starting');
        await peer.setInterviewerMicrophone(null);
        interviewerMicrophoneStreamRef.current = null;
        setInterviewerMicrophoneStatus('off');
      } catch (cause) {
        setInterviewerMicrophoneStatus('error');
        setError(cause instanceof Error ? cause.message : 'Could not stop microphone sharing.');
      }

      return;
    }

    let stream: MediaStream | null = null;

    try {
      setError('');
      setInterviewerMicrophoneStatus('starting');
      stream = await getMicrophoneStream();
      await peer.setInterviewerMicrophone(stream);

      interviewerMicrophoneStreamRef.current = stream;
      startLocalTranscriptPipeline('microphone', stream);
      setInterviewerMicrophoneStatus('on');
      const activeStream = stream;

      stream.getAudioTracks()[0]?.addEventListener(
        'ended',
        () => {
          if (interviewerMicrophoneStreamRef.current !== activeStream) {
            return;
          }

          interviewerMicrophoneStreamRef.current = null;
          setInterviewerMicrophoneStatus('off');
          void peer.setInterviewerMicrophone(null).catch((cause: unknown) => {
            logger.warn('Could not clear the ended interviewer microphone track.', {
              error: cause instanceof Error ? cause.message : 'Unknown error',
            });
          });
        },
        { once: true },
      );

      stream = null;
    } catch (cause) {
      if (stream) {
        stopMediaStream(stream);
      }

      interviewerMicrophoneStreamRef.current = null;
      setInterviewerMicrophoneStatus('error');
      setError(cause instanceof Error ? cause.message : 'Could not start microphone sharing.');
    }
  };

  const handleDocumentChange = (value: string): void => {
    if (value.length > MAX_DOCUMENT_CHARACTERS) {
      setError('Document cannot exceed 250,000 characters.');
      return;
    }

    setError('');
    setDocumentText(value);

    if (!role) {
      return;
    }

    if (sendTimerRef.current) {
      clearTimeout(sendTimerRef.current);
    }

    sendTimerRef.current = setTimeout(() => {
      sendTimerRef.current = null;
      const peer = peerRef.current;

      if (!peer) {
        return;
      }

      revisionRef.current += 1;
      peer.sendDocumentUpdate({
        type: 'document-update',
        documentId: documentIdRef.current,
        revision: revisionRef.current,
        text: value,
        updatedBy: role,
        updatedAt: Date.now(),
      });
    }, DOCUMENT_SEND_DELAY_MS);
  };

  const connectionStatusLabel = status === 'failed' ? 'Connection lost' : status;
  const microphoneConnected =
    role === 'interviewer' ? Boolean(remoteMicrophoneStream) : candidateMicrophoneActive;
  const systemAudioConnected =
    role === 'interviewer' ? Boolean(remoteSystemStream) : systemAudioStatus === 'ready';

  if (role && hasSignalingPeer) {
    return (
      <main className="workspace">
        <header className="workspace-header">
          <div className="workspace-brand">
            <span className="brand-mark" aria-hidden="true">
              ri
            </span>
            <div>
              <h1 className="workspace-title">Realtime Interview</h1>
              <span className="workspace-subtitle">
                {role === 'interviewer' ? 'Interviewer' : 'Candidate'} workspace
              </span>
            </div>
          </div>

          <div className="workspace-header-actions">
            <div className="source-statuses" aria-label="Audio source status">
              <AudioSourceStatus
                label={role === 'interviewer' ? 'Candidate mic' : 'Your mic'}
                active={microphoneConnected}
              />
              <AudioSourceStatus
                label={role === 'interviewer' ? 'Candidate system' : 'Your system'}
                active={systemAudioConnected}
              />
            </div>

            {role === 'interviewer' && (
              <button
                type="button"
                className={`mic-toggle ${interviewerMicrophoneStatus === 'on' ? 'active' : ''}`}
                aria-label={
                  interviewerMicrophoneStatus === 'on'
                    ? 'Stop sending your microphone'
                    : 'Send your microphone'
                }
                aria-pressed={interviewerMicrophoneStatus === 'on'}
                title={
                  interviewerMicrophoneStatus === 'on'
                    ? 'Stop sending your microphone'
                    : 'Send your microphone'
                }
                disabled={interviewerMicrophoneStatus === 'starting'}
                onClick={() => {
                  void handleInterviewerMicrophoneToggle();
                }}
              >
                <MicrophoneIcon muted={interviewerMicrophoneStatus !== 'on'} />
                <span>
                  {interviewerMicrophoneStatus === 'starting'
                    ? 'Starting...'
                    : interviewerMicrophoneStatus === 'on'
                      ? 'Mute mic'
                      : 'Unmute mic'}
                </span>
              </button>
            )}

            <ConnectionInfo
              role={role}
              connectionStatus={connectionStatusLabel}
              documentReady={documentReady}
              microphoneConnected={microphoneConnected}
              systemAudioConnected={systemAudioConnected}
              outgoingMicrophoneActive={
                role === 'interviewer' ? interviewerMicrophoneStatus === 'on' : undefined
              }
              audioPipelineStatus={role === 'interviewer' ? audioPipelineStatus : undefined}
              networkStats={networkStats}
            />
          </div>
        </header>

        {(error || warning) && (
          <div className="workspace-notices">
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            {warning && (
              <p className="warning" role="status">
                {warning}
              </p>
            )}
          </div>
        )}

        <div className="workspace-content">
          <DocumentEditor
            value={documentText}
            connected={documentReady}
            onChange={handleDocumentChange}
          />

          <TranscriptView segments={transcriptSegments} asrStatus={asrStatus} />
        </div>

        <audio ref={remoteMicrophoneAudioRef} autoPlay />
        {role === 'interviewer' && <audio ref={remoteSystemAudioRef} autoPlay />}
      </main>
    );
  }

  return (
    <main className="page">
      <section className="card">
        <header className="welcome-header">
          <span className="brand-mark" aria-hidden="true">
            ri
          </span>
          <span className="eyebrow">Realtime Interview</span>
          <h1>{role ? 'Your interview room' : 'Make room for a great conversation.'}</h1>
          <p className="welcome-description">
            {role
              ? 'Keep this window open while your participant connects.'
              : 'Shared notes and live transcripts, together in one focused workspace.'}
          </p>
        </header>

        {!role && (
          <>
            <details className="connection-settings">
              <summary>
                Connection settings <span>Server address</span>
              </summary>
              <section className="backend-setup" aria-labelledby="backend-setup-title">
                <h2 id="backend-setup-title">Backend address</h2>
                <label htmlFor="backend-url">Use the same address on both devices</label>
                <input
                  id="backend-url"
                  value={backendUrl}
                  inputMode="url"
                  spellCheck={false}
                  autoCapitalize="none"
                  disabled={sessionBusy}
                  placeholder="https://your-service.onrender.com"
                  onChange={(event) => setBackendUrl(event.target.value)}
                  onBlur={saveBackendUrl}
                />
              </section>
            </details>

            <div
              className="setup-switch"
              role="group"
              aria-label="Choose how to enter an interview"
            >
              <button
                type="button"
                aria-pressed={setupMode === 'create'}
                disabled={sessionBusy}
                onClick={() => setSetupMode('create')}
              >
                Create interview
              </button>
              <button
                type="button"
                aria-pressed={setupMode === 'join'}
                disabled={sessionBusy}
                onClick={() => setSetupMode('join')}
              >
                Join interview
              </button>
            </div>

            {setupMode === 'create' ? (
              <section className="create-panel">
                <span className="eyebrow">For interviewers</span>
                <h2>Start a new conversation</h2>
                <p>
                  Get a six-digit invitation code to share with your candidate. Your microphone
                  starts muted.
                </p>
                <button
                  type="button"
                  className="primary-button"
                  disabled={sessionBusy}
                  onClick={() => void runSessionAction(handleCreate)}
                >
                  {sessionBusy ? 'Creating your room...' : 'Create interview room'}
                </button>
              </section>
            ) : (
              <form
                className="join-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void runSessionAction(handleJoin);
                }}
              >
                <label className="field-label" htmlFor="interview-code">
                  Interview code
                </label>
                <input
                  id="interview-code"
                  className="code-input"
                  value={joinCode}
                  inputMode="numeric"
                  maxLength={7}
                  autoComplete="off"
                  aria-describedby="code-help"
                  disabled={sessionBusy}
                  placeholder="000 000"
                  onChange={(event) => setJoinCode(event.target.value)}
                />
                <p className="field-help" id="code-help">
                  Enter the six-digit code shared by your interviewer.
                </p>

                <fieldset className="audio-fieldset" disabled={sessionBusy}>
                  <section className="audio-setup" aria-labelledby="audio-setup-title">
                    <h2 id="audio-setup-title">Audio setup</h2>

                    <div className="audio-source-row">
                      <div>
                        <strong>Microphone</strong>
                        <span>{getMicrophoneSetupMessage(microphoneTestStatus)}</span>
                      </div>
                      <div className="audio-source-actions">
                        <AudioSetupToggle
                          label="Microphone"
                          enabled={microphoneEnabled}
                          onChange={setMicrophoneEnabled}
                        />
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={!microphoneEnabled || microphoneTestStatus === 'starting'}
                          onClick={() => void handleMicrophoneTest()}
                        >
                          {getMicrophoneTestButtonLabel(microphoneTestStatus)}
                        </button>
                      </div>
                    </div>

                    <div className="audio-source-row">
                      <div>
                        <strong>System audio</strong>
                        <span>Optional: capture audio playing on your computer</span>
                      </div>
                      <AudioSetupToggle
                        label="System audio"
                        enabled={systemAudioEnabled}
                        disabled={systemAudioStatus === 'starting'}
                        onChange={(enabled) => {
                          void handleSystemAudioSelection(enabled);
                        }}
                      />
                    </div>
                  </section>
                </fieldset>

                <button
                  type="submit"
                  className="primary-button"
                  disabled={sessionBusy || joinCode.replace(/\D/g, '').length !== 6}
                >
                  {sessionBusy ? 'Joining your interview...' : 'Join interview'}
                </button>
              </form>
            )}
            <p className="setup-footer">
              Audio is transcribed on your device. Share only the sources you choose.
            </p>
          </>
        )}

        {role === 'interviewer' && displayCode && (
          <section className="waiting-panel">
            <p className="eyebrow">Share this invitation code</p>
            <h2 className="invitation-code">
              {displayCode.slice(0, 3)} {displayCode.slice(3)}
            </h2>
            <button
              type="button"
              className="secondary-button"
              onClick={() => void copyInterviewCode()}
            >
              Copy invitation code
            </button>
            <p className="field-help" role="status">
              {copyMessage || 'Your candidate selects Join interview and enters this code.'}
            </p>
            <p className="waiting-status">
              <span className="source-dot" aria-hidden="true" />
              Waiting for your candidate
            </p>
          </section>
        )}

        {role === 'candidate' && <p className="muted">Connecting to the interview...</p>}

        {role && (
          <section className="status">
            Role: <strong>{role}</strong>
            <br />
            Connection: <strong>{status}</strong>
          </section>
        )}

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {warning && (
          <p className="warning" role="status">
            {warning}
          </p>
        )}
      </section>
    </main>
  );
};

const playRemoteAudio = (
  audio: HTMLAudioElement | null,
  stream: MediaStream | null,
  setError: (message: string) => void,
): void => {
  if (!audio) {
    return;
  }

  audio.srcObject = stream;

  if (stream) {
    void audio.play().catch(() => {
      setError('Remote audio is available but playback could not start.');
    });
  }
};

const AudioSourceStatus = ({ label, active }: { label: string; active: boolean }): JSX.Element => (
  <span className="source-status">
    <span className={`source-dot ${active ? 'active' : ''}`} aria-hidden="true" />
    {label}
  </span>
);

type AudioSetupToggleProps = {
  label: string;
  enabled: boolean;
  disabled?: boolean;
  onChange(enabled: boolean): void;
};

const AudioSetupToggle = ({
  label,
  enabled,
  disabled = false,
  onChange,
}: AudioSetupToggleProps): JSX.Element => (
  <label className="source-toggle">
    <input
      type="checkbox"
      checked={enabled}
      disabled={disabled}
      aria-label={`${label} ${enabled ? 'on' : 'off'}`}
      onChange={(event) => onChange(event.target.checked)}
    />
    <span className="source-toggle-track" aria-hidden="true">
      <span className="source-toggle-thumb" />
    </span>
    <span>{enabled ? 'On' : 'Off'}</span>
  </label>
);

const MicrophoneIcon = ({ muted }: { muted: boolean }): JSX.Element => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z" />
    <path d="M18 11a6 6 0 0 1-12 0M12 17v4M9 21h6" />
    {muted && <path className="mic-slash" d="m4 4 16 16" />}
  </svg>
);

const getSystemAudioButtonLabel = (status: CaptureStatus): string => {
  switch (status) {
    case 'starting':
      return 'Starting...';
    case 'ready':
      return 'Stop sharing';
    case 'error':
      return 'Try again';
    default:
      return 'Share system audio';
  }
};

const getMicrophoneTestButtonLabel = (status: CaptureStatus): string => {
  switch (status) {
    case 'starting':
      return 'Testing...';
    case 'ready':
      return 'Mic ready';
    case 'error':
      return 'Try again';
    default:
      return 'Test microphone';
  }
};

const getMicrophoneSetupMessage = (status: CaptureStatus): string => {
  switch (status) {
    case 'ready':
      return 'Permission and live audio track confirmed';
    case 'error':
      return 'Microphone test failed; see the message below';
    default:
      return 'Test it now, or it will be requested when you join';
  }
};

const createEmptyAudioPipelineStatus = (): AudioPipelineStatus => ({
  microphone: {
    recording: false,
    pcm: false,
  },
  system: {
    recording: false,
    pcm: false,
  },
});

const getAudioSourceLabel = (source: AudioSource): string =>
  source === 'microphone' ? 'Microphone' : 'System audio';
