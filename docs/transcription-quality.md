# Transcription quality

The streaming recognizer uses the installed Sherpa English Zipformer model.
Model weights have not changed in this update. Technical vocabulary hints can
help decoding but do not guarantee recognition of unfamiliar technologies.

The worker now uses the latest nonempty decoder result at endpoint/stop instead
of always keeping the last partial. Silence without detected speech is still
suppressed. Pause timing remains unchanged.

The renderer formats uppercase hypotheses into sentence case, preserves known
technology names, and adds a full stop to finalized utterances. Existing
punctuation is preserved. It does not invent clause boundaries, commas, or
question marks in unpunctuated continuous speech. Raw recognizer output remains
in `rawText`; domain aliases are corrected only when matching context exists.

## Repeatable accuracy check

1. Install the updated desktop build on the device capturing the audio.
2. For a reference video, use system audio only and disable the microphone to
   avoid capturing speaker playback twice. Keep the video at normal speed.
3. Use the same 30–60 second excerpt before and after each model/config change.
4. Compare final text with a manually verified reference transcript. Measure
   word error rate and technical-term error rate separately; casing alone is
   not an accuracy improvement.
5. Check live latency and CPU usage with both capture streams enabled on the
   lowest-spec supported device before increasing decoder/model complexity.

The supplied YouTube reference could not be fetched during implementation.
No accuracy or latency benchmark on that recording has been claimed.

## Checks

`npm run test:transcription` covers text formatting and context-sensitive aliases.
`native/asr-worker/scripts/smoke-test.mjs` checks actual decoding, silence, pause
separation, and both input sources with a 16 kHz mono PCM16 WAV. It is a runtime
smoke test, not a cross-domain accuracy benchmark.
