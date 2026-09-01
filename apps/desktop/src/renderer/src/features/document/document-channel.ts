import { DocumentUpdateSchema, type DocumentUpdate } from '@interview/shared';

type DocumentChannelCallbacks = {
  onUpdate(update: DocumentUpdate): void;
  onOpen(): void;
  onClose(): void;
};

const CHANNEL_NAME = 'document';

const MAX_BUFFERED_BYTES = 512 * 1024;

export class DocumentChannel {
  private channel: RTCDataChannel | null = null;

  constructor(private readonly callbacks: DocumentChannelCallbacks) {}

  create(peerConnection: RTCPeerConnection): void {
    const channel = peerConnection.createDataChannel(CHANNEL_NAME, {
      ordered: true,
    });

    this.bind(channel);
  }

  accept(channel: RTCDataChannel): void {
    if (channel.label !== CHANNEL_NAME) {
      channel.close();
      return;
    }

    this.bind(channel);
  }

  send(update: DocumentUpdate): void {
    if (!this.channel || this.channel.readyState !== 'open') {
      return;
    }

    if (this.channel.bufferedAmount > MAX_BUFFERED_BYTES) {
      return;
    }

    this.channel.send(JSON.stringify(update));
  }

  close(): void {
    this.channel?.close();
    this.channel = null;
  }

  private bind(channel: RTCDataChannel): void {
    this.channel?.close();

    this.channel = channel;

    channel.addEventListener('open', () => {
      this.callbacks.onOpen();
    });

    channel.addEventListener('close', () => {
      this.callbacks.onClose();
    });

    channel.addEventListener('message', (event) => {
      let decoded: unknown;

      try {
        decoded = JSON.parse(String(event.data));
      } catch {
        return;
      }

      const result = DocumentUpdateSchema.safeParse(decoded);

      if (!result.success) {
        return;
      }

      this.callbacks.onUpdate(result.data);
    });
  }
}
