import {
  ServerSignalMessageSchema,
  type ClientSignalMessage,
  type ServerSignalMessage,
} from '@interview/shared';

import { getApiUrl } from './api';
import { logger } from './logger';

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
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('Signaling connection is not open.');
    }

    this.socket.send(JSON.stringify(message));
  }

  disconnect(): void {
    this.manuallyClosed = true;
    this.clearReconnectTimer();

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

    socket.addEventListener('open', () => {
      if (this.socket !== socket) {
        return;
      }

      this.reconnectAttempts = 0;
      logger.info('Signaling connection opened.');
      this.callbacks.onOpen();
    });

    socket.addEventListener('message', (event) => {
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

      this.callbacks.onMessage(parsed.data);
    });

    socket.addEventListener('close', () => {
      if (this.socket !== socket) {
        return;
      }

      this.socket = null;
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

    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 10_000);

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
}
