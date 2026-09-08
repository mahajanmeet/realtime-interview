import type {
  AppRole,
  AudioSource,
  ClientSignalMessage,
  DocumentUpdate,
  ServerSignalMessage,
} from '@interview/shared';

import { stopMediaStream } from '../../features/audio/microphone';
import { DocumentChannel } from '../../features/document/document-channel';

import { logger } from '../logger';
import type { SignalingClient } from '../signaling';

import { ConnectionStatsCollector, type ConnectionStats } from './connection-stats';

export type LocalAudioStreams = {
  microphone?: MediaStream;
  system?: MediaStream;
};

type RealtimePeerCallbacks = {
  onConnectionState(state: RTCPeerConnectionState): void;
  onDocumentUpdate(update: DocumentUpdate): void;
  onDocumentReady(ready: boolean): void;
  onRemoteAudioTrack(source: AudioSource, stream: MediaStream): void;
};

type RealtimePeerOptions = {
  role: AppRole;
  signaling: SignalingClient;
  rtcConfiguration: RTCConfiguration;
  localAudio?: LocalAudioStreams;
  callbacks: RealtimePeerCallbacks;
};

export class RealtimePeer {
  private readonly peerConnection: RTCPeerConnection;

  private readonly document: DocumentChannel;

  private readonly statsCollector: ConnectionStatsCollector;

  private readonly localAudio: LocalAudioStreams;

  private readonly pendingIceCandidates: RTCIceCandidateInit[] = [];

  private candidateMicrophoneTransceiver: RTCRtpTransceiver | null = null;

  private candidateSystemTransceiver: RTCRtpTransceiver | null = null;

  private interviewerMicrophoneSender: RTCRtpSender | null = null;

  private interviewerMicrophoneStream: MediaStream | null = null;

  private localTracksAdded = false;

  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: RealtimePeerOptions) {
    this.localAudio = options.localAudio ?? {};

    this.peerConnection = new RTCPeerConnection(options.rtcConfiguration);
    this.statsCollector = new ConnectionStatsCollector(this.peerConnection);

    this.document = new DocumentChannel({
      onUpdate: options.callbacks.onDocumentUpdate,

      onOpen: () => {
        options.callbacks.onDocumentReady(true);
      },

      onClose: () => {
        options.callbacks.onDocumentReady(false);
      },
    });

    this.configurePeerConnection();
  }

  async startOffer(): Promise<void> {
    if (this.options.role !== 'interviewer') {
      throw new Error('Only the interviewer creates the WebRTC offer.');
    }

    const offer = await this.peerConnection.createOffer();

    await this.peerConnection.setLocalDescription(offer);

    if (!offer.sdp) {
      throw new Error('WebRTC offer did not contain SDP.');
    }

    this.sendSignal({
      type: 'offer',
      sdp: offer.sdp,
    });
  }

  async handleSignal(message: ServerSignalMessage): Promise<void> {
    switch (message.type) {
      case 'offer':
        await this.handleOffer(message.sdp);
        return;

      case 'answer':
        await this.handleAnswer(message.sdp);
        return;

      case 'ice-candidate':
        await this.handleIceCandidate(message.candidate);
        return;

      default:
        return;
    }
  }

  sendDocumentUpdate(update: DocumentUpdate): void {
    this.document.send(update);
  }

  async getConnectionStats(): Promise<ConnectionStats> {
    return this.statsCollector.collect();
  }

  async setInterviewerMicrophone(stream: MediaStream | null): Promise<void> {
    if (this.options.role !== 'interviewer' || !this.interviewerMicrophoneSender) {
      throw new Error('Interviewer microphone is not available.');
    }

    const track = stream?.getAudioTracks()[0] ?? null;

    if (stream && !track) {
      throw new Error('The microphone stream did not contain an audio track.');
    }

    const previousStream = this.interviewerMicrophoneStream;

    try {
      await this.interviewerMicrophoneSender.replaceTrack(track);
      this.interviewerMicrophoneStream = stream;

      if (stream) {
        await this.startOffer();
      }
    } catch (cause) {
      if (stream) {
        stopMediaStream(stream);
      }

      await this.interviewerMicrophoneSender.replaceTrack(null);
      this.interviewerMicrophoneStream = null;
      throw cause;
    } finally {
      if (previousStream && previousStream !== stream) {
        stopMediaStream(previousStream);
      }
    }
  }

  async restartIce(): Promise<void> {
    if (this.options.role !== 'interviewer') {
      return;
    }

    if (this.peerConnection.signalingState !== 'stable') {
      logger.warn('Skipped ICE restart while signaling was not stable.', {
        signalingState: this.peerConnection.signalingState,
      });
      return;
    }

    logger.info('Restarting ICE.');

    this.peerConnection.restartIce();

    const offer = await this.peerConnection.createOffer({
      iceRestart: true,
    });

    await this.peerConnection.setLocalDescription(offer);

    if (!offer.sdp) {
      return;
    }

    this.sendSignal({
      type: 'offer',
      sdp: offer.sdp,
    });
  }

  close(): void {
    this.clearDisconnectTimer();
    this.document.close();
    this.peerConnection.close();
    this.stopLocalAudio();

    if (this.interviewerMicrophoneStream) {
      stopMediaStream(this.interviewerMicrophoneStream);
      this.interviewerMicrophoneStream = null;
    }
  }

  private configurePeerConnection(): void {
    this.peerConnection.addEventListener('connectionstatechange', () => {
      const state = this.peerConnection.connectionState;

      logger.info('Peer connection state changed.', {
        state,
      });

      this.options.callbacks.onConnectionState(state);

      if (state === 'connected') {
        this.clearDisconnectTimer();
        return;
      }

      if (state === 'disconnected') {
        this.scheduleRecovery();
        return;
      }

      if (state === 'failed') {
        this.requestIceRestart();
      }
    });

    this.peerConnection.addEventListener('icecandidate', (event) => {
      if (!event.candidate) {
        return;
      }

      const iceCandidate = event.candidate.toJSON();

      this.sendSignal({
        type: 'ice-candidate',

        candidate: {
          ...iceCandidate,
          candidate: iceCandidate.candidate ?? '',
        },
      });
    });

    this.peerConnection.addEventListener('track', (event) => {
      if (event.track.kind !== 'audio') {
        return;
      }

      const stream = event.streams[0] ?? new MediaStream([event.track]);

      if (this.options.role === 'candidate') {
        this.options.callbacks.onRemoteAudioTrack('microphone', stream);
        return;
      }

      const source: AudioSource =
        event.transceiver === this.candidateSystemTransceiver ? 'system' : 'microphone';

      this.options.callbacks.onRemoteAudioTrack(source, stream);
    });

    if (this.options.role === 'interviewer') {
      this.candidateMicrophoneTransceiver = this.peerConnection.addTransceiver('audio', {
        direction: 'sendrecv',
      });
      this.interviewerMicrophoneSender = this.candidateMicrophoneTransceiver.sender;

      this.candidateSystemTransceiver = this.peerConnection.addTransceiver('audio', {
        direction: 'recvonly',
      });

      this.document.create(this.peerConnection);
    } else {
      this.peerConnection.addEventListener('datachannel', (event) => {
        this.document.accept(event.channel);
      });
    }
  }

  private async handleOffer(sdp: string): Promise<void> {
    if (this.options.role !== 'candidate') {
      return;
    }

    await this.peerConnection.setRemoteDescription({
      type: 'offer',
      sdp,
    });

    await this.flushPendingIceCandidates();
    await this.addLocalAudioTracks();

    const answer = await this.peerConnection.createAnswer();

    await this.peerConnection.setLocalDescription(answer);
    await this.limitAudioBitrate();

    if (!answer.sdp) {
      throw new Error('WebRTC answer did not contain SDP.');
    }

    this.sendSignal({
      type: 'answer',
      sdp: answer.sdp,
    });
  }

  private async handleAnswer(sdp: string): Promise<void> {
    if (this.options.role !== 'interviewer') {
      return;
    }

    await this.peerConnection.setRemoteDescription({
      type: 'answer',
      sdp,
    });
    await this.limitAudioBitrate();

    await this.flushPendingIceCandidates();
  }

  private async handleIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.peerConnection.remoteDescription) {
      this.pendingIceCandidates.push(candidate);
      return;
    }

    await this.peerConnection.addIceCandidate(candidate);
  }

  private async flushPendingIceCandidates(): Promise<void> {
    while (this.pendingIceCandidates.length > 0) {
      const candidate = this.pendingIceCandidates.shift();

      if (!candidate) {
        continue;
      }

      await this.peerConnection.addIceCandidate(candidate);
    }
  }

  private async addLocalAudioTracks(): Promise<void> {
    if (this.localTracksAdded) {
      return;
    }

    const audioTransceivers = this.peerConnection
      .getTransceivers()
      .filter((transceiver) => transceiver.receiver.track.kind === 'audio');
    const microphoneTransceiver = audioTransceivers[0];
    const systemTransceiver = audioTransceivers[1];

    if (!microphoneTransceiver || !systemTransceiver) {
      throw new Error('The audio connection did not provide the expected media channels.');
    }

    const microphoneTrack = this.localAudio.microphone?.getAudioTracks()[0] ?? null;
    const systemTrack = this.localAudio.system?.getAudioTracks()[0] ?? null;

    await microphoneTransceiver.sender.replaceTrack(microphoneTrack);
    microphoneTransceiver.direction = microphoneTrack ? 'sendrecv' : 'recvonly';

    await systemTransceiver.sender.replaceTrack(systemTrack);
    systemTransceiver.direction = systemTrack ? 'sendonly' : 'inactive';

    this.localTracksAdded = true;
  }

  private stopLocalAudio(): void {
    if (this.localAudio.microphone) {
      stopMediaStream(this.localAudio.microphone);
    }

    if (this.localAudio.system) {
      stopMediaStream(this.localAudio.system);
    }
  }

  private async limitAudioBitrate(): Promise<void> {
    for (const sender of this.peerConnection.getSenders()) {
      if (sender.track?.kind !== 'audio') continue;
      const parameters = sender.getParameters();
      if (!parameters.encodings?.length) continue;
      for (const encoding of parameters.encodings) encoding.maxBitrate = 32_000;
      try {
        await sender.setParameters(parameters);
      } catch {
        logger.warn('Audio bitrate limit is unsupported by this runtime.');
      }
    }
  }

  private scheduleRecovery(): void {
    this.clearDisconnectTimer();

    this.disconnectTimer = setTimeout(() => {
      if (this.peerConnection.connectionState === 'disconnected') {
        this.requestIceRestart();
      }
    }, 7000);
  }

  private clearDisconnectTimer(): void {
    if (!this.disconnectTimer) {
      return;
    }

    clearTimeout(this.disconnectTimer);
    this.disconnectTimer = null;
  }

  private requestIceRestart(): void {
    void this.restartIce().catch((cause: unknown) => {
      logger.warn('ICE restart failed.', {
        error: cause instanceof Error ? cause.message : 'Unknown error',
      });
    });
  }

  private sendSignal(message: ClientSignalMessage): void {
    this.options.signaling.send(message);
  }
}
