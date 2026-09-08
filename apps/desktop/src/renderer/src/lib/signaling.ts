import {
  ServerSignalMessageSchema,
  type ClientSignalMessage,
  type ServerSignalMessage,
} from '@interview/shared';

import { getApiUrl } from './api';
import { logger } from './logger';
import { TranscriptOutbox } from './transcript-outbox';

type SignalingCallbacks = {
  onMessage(message: ServerSignalMessage): void;
  onOpen(): void;
  onClose(): void;
  onReconnecting(): void;
  onReconnectRequested(): Promise<string>;
};

export class SignalingClient {
  private socket: WebSocket | null = null;

  private reconnectTimer: number | null = null;

  private manuallyClosed = false;

  private reconnectAttempts = 0;
  private readonly transcripts = new TranscriptOutbox();
  private transcriptTimer: ReturnType<typeof setInterval> | null = null;
  private peerPresent = false;

  constructor(private readonly callbacks: SignalingCallbacks) {}

  connect(signalTicket: string): void {
    this.manuallyClosed = false;
    this.clearReconnectTimer();

    const previousSocket = this.socket;

    this.socket = null;
    previousSocket?.close();

    this.openSocket(signalTicket);
  }

  send(message: ClientSignalMessage): void {
    if (message.type === 'transcript-segment') {
      this.transcripts.enqueue(message);
      if (message.segment.status === 'final') this.flushTranscripts();
      return;
    }
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('Signaling connection is not open.');
    }

    this.socket.send(JSON.stringify(message));
  }

  disconnect(): void {
    this.manuallyClosed = true;
    this.clearReconnectTimer();
    if (this.transcriptTimer) clearInterval(this.transcriptTimer);
    this.transcriptTimer = null;
    this.peerPresent = false;

    const socket = this.socket;

    this.socket = null;
    socket?.close();
  }

  private openSocket(signalTicket: string): void {
    if (this.manuallyClosed) {
      return;
    }

    const apiUrl = new URL(getApiUrl());
    const protocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${apiUrl.host}/ws` + `?ticket=${encodeURIComponent(signalTicket)}`;
    const socket = new WebSocket(url);

    this.socket = socket;
    this.peerPresent = false;
    if (this.transcriptTimer) clearInterval(this.transcriptTimer);
    this.transcriptTimer = setInterval(() => this.flushTranscripts(), 100);
    const openTimeout = setTimeout(() => {
      if (this.socket === socket && socket.readyState === WebSocket.CONNECTING) socket.close();
    }, 15_000);

    socket.addEventListener('open', () => {
      if (this.socket !== socket) {
        return;
      }

      this.reconnectAttempts = 0;
      clearTimeout(openTimeout);
      logger.info('Signaling connection opened.');
      this.callbacks.onOpen();
    });

    socket.addEventListener('message', (event) => {
      if (this.socket !== socket) return;
      let decoded: unknown;

      try {
        decoded = JSON.parse(String(event.data));
      } catch {
        logger.warn('Ignored malformed signaling message.');
        return;
      }

      const parsed = ServerSignalMessageSchema.safeParse(decoded);

      if (!parsed.success) {
        logger.warn('Ignored invalid signaling message.');
        return;
      }

      if (parsed.data.type === 'peer-connected') {
        this.peerPresent = true;
        this.transcripts.replay();
        this.flushTranscripts();
      } else if (parsed.data.type === 'peer-disconnected') {
        this.peerPresent = false;
      }
      this.callbacks.onMessage(parsed.data);
    });

    socket.addEventListener('close', () => {
      clearTimeout(openTimeout);
      if (this.socket !== socket) {
        return;
      }

      this.socket = null;
      this.peerPresent = false;
      logger.warn('Signaling connection closed.');
      this.callbacks.onClose();

      if (!this.manuallyClosed) {
        this.scheduleReconnect();
      }
    });
  }

  private scheduleReconnect(): void {
    if (this.manuallyClosed || this.reconnectTimer !== null) {
      return;
    }

    this.callbacks.onReconnecting();

    const delay = Math.min(500 * 2 ** this.reconnectAttempts, 10_000) + Math.random() * 250;

    this.reconnectAttempts += 1;

    logger.info('Scheduling signaling reconnect.', {
      attempt: this.reconnectAttempts,
      delayMs: delay,
    });

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      void this.refreshTicketAndReconnect();
    }, delay);
  }

  private async refreshTicketAndReconnect(): Promise<void> {
    try {
      const signalTicket = await this.callbacks.onReconnectRequested();

      if (this.manuallyClosed) {
        return;
      }

      this.openSocket(signalTicket);
    } catch (cause) {
      logger.warn('Signaling reconnect attempt failed.', {
        error: cause instanceof Error ? cause.message : 'Unknown error',
      });

      this.scheduleReconnect();
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer === null) {
      return;
    }

    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private flushTranscripts(): void {
    if (!this.peerPresent) return;
    this.transcripts.flush(performance.now(), (wire) => {
      if (
        !this.socket ||
        this.socket.readyState !== WebSocket.OPEN ||
        this.socket.bufferedAmount > 16 * 1024
      )
        return false;
      try {
        this.socket.send(wire);
        return true;
      } catch {
        return false;
      }
    });
  }
}
