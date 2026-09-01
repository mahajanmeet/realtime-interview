# ASR worker

The ASR worker isolates Sherpa ONNX and its native libraries from Electron. It accepts bounded binary PCM frames on stdin and emits newline-delimited JSON transcript results on stdout.

It discards silent PCM frames for transcript emission, treats a two-second spoken pause as an endpoint, and leaves continuous speech in the same segment (up to the model's 300-second safety limit).

## Build prerequisites

Build and install Sherpa ONNX with its C API enabled, then configure this project with the install directory:

```text
cmake -S native/asr-worker -B native/asr-worker/build -DSHERPA_ONNX_ROOT=<sherpa-install>
cmake --build native/asr-worker/build --config Release
```

The Windows build copies the required Sherpa and ONNX Runtime DLLs beside the worker executable.

The official Sherpa installation must provide:

```text
include/sherpa-onnx/c-api/c-api.h
lib/sherpa-onnx-c-api
```

On Windows, place required runtime DLLs beside `asr-worker.exe` or make them available through the worker process environment. On macOS and Linux, ensure the corresponding shared libraries are discoverable at runtime.

During development, the desktop application searches `build/Release` and `build`. `ASR_WORKER_PATH` and `ASR_MODEL_DIR` can override these locations.

Run the protocol and model smoke test with a 16 kHz mono PCM16 WAV:

```text
node native/asr-worker/scripts/smoke-test.mjs <worker> <model-directory> <test.wav>
```

For English BPE models, place `bpe.vocab` beside the ONNX files. If `hotwords.txt` is present, the desktop process supplies both files so Sherpa can encode one technical word or phrase per line.
