# Phase 7 Validation

## Native setup

1. Install a pinned Sherpa ONNX release with the C API enabled.
2. Build `native/asr-worker` by following its README.
3. Place a compatible streaming Zipformer Transducer model in `native/asr-worker/models`.
4. Start the desktop application and create an interview.
5. Confirm the transcript panel changes from `Starting` to `Live`.

When the native worker or model is absent, the transcript panel should show `Unavailable`; WebRTC, recording, document editing, and audio playback must continue normally.

## Functional checks

- [ ] Candidate microphone produces partial transcript segments.
- [ ] Final results replace their matching partial segments.
- [ ] System audio produces independently labeled transcript segments.
- [ ] Microphone and system audio work simultaneously.
- [ ] Transcript timestamps increase correctly.
- [ ] Realtime playback does not stutter while ASR is decoding.
- [ ] Document editing remains responsive.
- [ ] Worker CPU inference uses two threads.
- [ ] No transcript text, PCM, credentials, or SDP is written to application logs.

## Recovery checks

- [ ] Terminating `asr-worker` changes the state to `Restarting`.
- [ ] The WebRTC call and recording remain active while the worker is down.
- [ ] The worker restarts with exponential backoff.
- [ ] Transcription resumes without rejoining the call.
- [ ] Segments created after a restart do not overwrite earlier segments.
- [ ] At most 2 MiB of PCM is retained while the worker is unavailable or backpressured.

## Endurance checks

- [ ] Run microphone-only transcription for at least 30 minutes.
- [ ] Run system-only transcription for at least 30 minutes.
- [ ] Run both sources for at least 30 minutes.
- [ ] Record CPU, RAM, ASR lag, and realtime factor.
- [ ] Confirm there is no continuously increasing memory usage.
- [ ] Confirm the worker remains close to realtime on minimum target hardware.
