export const PCM_SAMPLE_RATE = 16_000;
export const PCM_CHUNK_SAMPLES = 640;

export type PcmChunkHandler = (samples: Float32Array) => void;

export class PcmTap {
  private context: AudioContext | null = null;

  private source: MediaStreamAudioSourceNode | null = null;

  private node: AudioWorkletNode | null = null;

  private silentOutput: GainNode | null = null;

  async start(stream: MediaStream, onChunk: PcmChunkHandler): Promise<void> {
    if (this.context) {
      throw new Error('PCM capture is already active.');
    }

    const context = new AudioContext({
      sampleRate: PCM_SAMPLE_RATE,
      latencyHint: 'interactive',
    });

    try {
      if (context.sampleRate !== PCM_SAMPLE_RATE) {
        throw new Error(
          `PCM capture requires ${PCM_SAMPLE_RATE} Hz audio; received ${context.sampleRate} Hz.`,
        );
      }

      await context.audioWorklet.addModule(new URL('./pcm-worklet.js', import.meta.url));

      const source = context.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(context, 'pcm-capture');
      const silentOutput = context.createGain();

      silentOutput.gain.value = 0;
      node.port.onmessage = (event: MessageEvent<unknown>) => {
        if (event.data instanceof Float32Array) {
          onChunk(event.data);
        }
      };

      source.connect(node);

      // A zero-gain destination keeps the worklet graph processing without
      // duplicating the separate realtime playback path.
      node.connect(silentOutput);
      silentOutput.connect(context.destination);

      if (context.state === 'suspended') {
        await context.resume();
      }

      this.context = context;
      this.source = source;
      this.node = node;
      this.silentOutput = silentOutput;
    } catch (cause) {
      await context.close();
      throw cause;
    }
  }

  async stop(): Promise<void> {
    this.source?.disconnect();
    this.node?.disconnect();
    this.silentOutput?.disconnect();
    this.node?.port.close();

    await this.context?.close();

    this.context = null;
    this.source = null;
    this.node = null;
    this.silentOutput = null;
  }
}
