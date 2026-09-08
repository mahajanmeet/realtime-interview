import { DocumentUpdateSchema, type DocumentUpdate } from '@interview/shared';

type DocumentChannelCallbacks = {
  onUpdate(update: DocumentUpdate): void;
  onOpen(): void;
  onClose(): void;
};

const CHANNEL_NAME = 'document';

const MAX_BUFFERED_BYTES = 16 * 1024;

export class DocumentChannel {
  private channel: RTCDataChannel | null = null;
  private pending: DocumentUpdate | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

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
    this.pending = update;
    this.flush();
  }

  private flush(): void {
    if (!this.pending) return;
    if (!this.channel || this.channel.readyState !== 'open') {
      return;
    }

    if (this.channel.bufferedAmount > MAX_BUFFERED_BYTES) {
      return;
    }

    // Never silently discard the latest edit when the buffer is full.
    // Large-document chunking is a separate protocol change; this keeps the
    // existing wire format compatible with installed clients.
    try {
      this.channel.send(JSON.stringify(this.pending));
      this.pending = null;
    } catch {
      // Retain the latest snapshot until the transport can send again.
    }
  }

  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.pending = null;
    this.channel?.close();
    this.channel = null;
  }

  private bind(channel: RTCDataChannel): void {
    this.channel?.close();

    this.channel = channel;
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.flush(), 200);

    channel.addEventListener('open', () => {
      this.callbacks.onOpen();
      this.flush();
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
