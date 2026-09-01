import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const [workerArgument, modelArgument, wavArgument] = process.argv.slice(2);

if (!workerArgument || !modelArgument || !wavArgument) {
  console.error('Usage: node smoke-test.mjs <worker> <model-directory> <mono-pcm16.wav>');
  process.exit(2);
}

const worker = resolve(workerArgument);
const modelDirectory = resolve(modelArgument);
const wavPath = resolve(wavArgument);
const model = {
  encoder: join(modelDirectory, 'encoder.onnx'),
  decoder: join(modelDirectory, 'decoder.onnx'),
  joiner: join(modelDirectory, 'joiner.onnx'),
  tokens: join(modelDirectory, 'tokens.txt'),
  bpeVocabulary: join(modelDirectory, 'bpe.vocab'),
  hotwords: join(modelDirectory, 'hotwords.txt'),
};

for (const path of [worker, wavPath, model.encoder, model.decoder, model.joiner, model.tokens]) {
  if (!existsSync(path)) {
    console.error(`Missing smoke-test input: ${path}`);
    process.exit(2);
  }
}

const samples = decodePcm16Wave(readFileSync(wavPath));
const leadingSilence = new Float32Array(16_000 * 3);
const trailingSilence = new Float32Array(16_000 * 3);
const argumentsList = [
  `--encoder=${model.encoder}`,
  `--decoder=${model.decoder}`,
  `--joiner=${model.joiner}`,
  `--tokens=${model.tokens}`,
  '--threads=2',
  '--provider=cpu',
  '--decoding-method=modified_beam_search',
];

if (existsSync(model.bpeVocabulary) && existsSync(model.hotwords)) {
  argumentsList.push(
    `--bpe-vocab=${model.bpeVocabulary}`,
    `--hotwords=${model.hotwords}`,
    '--hotwords-score=1.5',
  );
}

const child = spawn(worker, argumentsList, {
  cwd: dirname(worker),
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
});
const output = [];
let stdout = '';
let stderr = '';
let stdinError = null;

child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  stdout += chunk;
  const lines = stdout.split('\n');
  stdout = lines.pop() ?? '';

  for (const line of lines.map((value) => value.trim()).filter(Boolean)) {
    const message = JSON.parse(line);
    output.push(message);
    console.log(line);
  }
});

child.stderr.setEncoding('utf8');
child.stderr.on('data', (chunk) => {
  stderr += chunk;
});

child.stdin.on('error', (error) => {
  stdinError = error;
});

child.stdin.write(controlFrame(1, 1));
child.stdin.write(controlFrame(1, 2));

for (const audio of [leadingSilence, samples, trailingSilence, samples, trailingSilence]) {
  for (let offset = 0; offset < audio.length; offset += 640) {
    const chunk = audio.subarray(offset, Math.min(offset + 640, audio.length));
    child.stdin.write(audioFrame(chunk, 1));
    child.stdin.write(audioFrame(chunk, 2));
  }
}

child.stdin.write(controlFrame(3, 1));
child.stdin.write(controlFrame(3, 2));
child.stdin.write(controlFrame(4, 1));
child.stdin.end();

const timeout = setTimeout(() => child.kill(), 60_000);
const exitCode = await new Promise((resolveExit, rejectExit) => {
  child.once('error', rejectExit);
  child.once('exit', (code) => resolveExit(code));
});

clearTimeout(timeout);

if (stderr.trim()) {
  console.error(stderr.trim());
}

const ready = output.some((message) => message.type === 'status' && message.state === 'ready');
const microphoneFinals = output.filter(
  (message) => message.type === 'final' && message.source === 'microphone' && message.text?.trim(),
);
const systemFinals = output.filter(
  (message) => message.type === 'final' && message.source === 'system' && message.text?.trim(),
);
const microphoneFinal = microphoneFinals[0];
const systemFinal = systemFinals[0];

if (
  exitCode !== 0 ||
  stdinError ||
  !ready ||
  microphoneFinals.length !== 2 ||
  systemFinals.length !== 2 ||
  !hasSeparatedTimestamps(microphoneFinals) ||
  !hasSeparatedTimestamps(systemFinals)
) {
  console.error(
    `ASR smoke test failed (exit=${exitCode}, ready=${ready}, microphone=${Boolean(microphoneFinal)}, system=${Boolean(systemFinal)}).`,
  );
  process.exit(1);
}

console.log(`ASR microphone smoke test passed: ${microphoneFinal.text}`);
console.log(`ASR system-audio smoke test passed: ${systemFinal.text}`);

function hasSeparatedTimestamps(finals) {
  const [first, second] = finals;
  return (
    first?.startMs >= 3_000 &&
    first?.endMs !== null &&
    second?.startMs > first.endMs &&
    second?.endMs !== null
  );
}

function controlFrame(command, source) {
  const frame = Buffer.alloc(6);
  frame.writeUInt8(command, 0);
  frame.writeUInt8(source, 1);
  return frame;
}

function audioFrame(chunk, source) {
  const frame = Buffer.allocUnsafe(6 + chunk.byteLength);
  frame.writeUInt8(2, 0);
  frame.writeUInt8(source, 1);
  frame.writeUInt32LE(chunk.length, 2);
  Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).copy(frame, 6);
  return frame;
}

function decodePcm16Wave(file) {
  if (file.toString('ascii', 0, 4) !== 'RIFF' || file.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Smoke-test audio must be a RIFF/WAVE file.');
  }

  let format = null;
  let data = null;

  for (let offset = 12; offset + 8 <= file.length; ) {
    const id = file.toString('ascii', offset, offset + 4);
    const length = file.readUInt32LE(offset + 4);
    const start = offset + 8;

    if (id === 'fmt ') {
      format = {
        audioFormat: file.readUInt16LE(start),
        channels: file.readUInt16LE(start + 2),
        sampleRate: file.readUInt32LE(start + 4),
        bitsPerSample: file.readUInt16LE(start + 14),
      };
    } else if (id === 'data') {
      data = file.subarray(start, start + length);
    }

    offset = start + length + (length % 2);
  }

  if (
    !format ||
    !data ||
    format.audioFormat !== 1 ||
    format.channels !== 1 ||
    format.sampleRate !== 16_000 ||
    format.bitsPerSample !== 16
  ) {
    throw new Error('Smoke-test WAV must be 16 kHz, mono, signed PCM16.');
  }

  const result = new Float32Array(data.length / 2);

  for (let index = 0; index < result.length; index += 1) {
    result[index] = data.readInt16LE(index * 2) / 32_768;
  }

  return result;
}
