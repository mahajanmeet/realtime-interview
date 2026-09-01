class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    this.buffer = [];
    this.targetSamples = 640;
  }

  process(inputs) {
    const channels = inputs[0];

    if (!channels || channels.length === 0 || !channels[0]) {
      return true;
    }

    const frameCount = channels[0].length;

    for (let frame = 0; frame < frameCount; frame += 1) {
      let mixedSample = 0;

      for (let channel = 0; channel < channels.length; channel += 1) {
        mixedSample += channels[channel][frame] ?? 0;
      }

      this.buffer.push(mixedSample / channels.length);
    }

    while (this.buffer.length >= this.targetSamples) {
      const samples = new Float32Array(this.buffer.splice(0, this.targetSamples));

      this.port.postMessage(samples, [samples.buffer]);
    }

    return true;
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor);
