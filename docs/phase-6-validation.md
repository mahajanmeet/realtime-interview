# Phase 6 Validation

Phase 7 must remain blocked until this checklist passes on representative Windows and macOS machines.

## Recording location

Recordings are written by the Electron main process under:

```text
<Electron userData>/recordings/<session-id>/microphone.webm
<Electron userData>/recordings/<session-id>/system.webm
```

The renderer sends approximately one Opus/WebM chunk per second. It never receives direct filesystem access.

## Functional checks

- [ ] Microphone and system recordings are created as separate files.
- [ ] Each file contains only its expected source.
- [ ] Both files remain playable after a normal application close.
- [ ] Realtime playback continues while both sources are recording.
- [ ] The connection information panel shows recording as active for each received source.
- [ ] The connection information panel shows 16 kHz PCM as active for each received source.
- [ ] Each first PCM diagnostic reports 640 samples (40 ms at 16 kHz).
- [ ] Stopping either source finalizes its corresponding recording.
- [ ] Invalid IPC session IDs, sources, empty chunks, and chunks larger than 16 MiB are rejected.

## Endurance checks

- [ ] Run microphone-only capture for at least 30 minutes.
- [ ] Run system-only capture for at least 30 minutes.
- [ ] Run simultaneous microphone and system capture for at least 30 minutes.
- [ ] Record starting and ending RAM/CPU values in `performance-baseline.md`.
- [ ] Confirm memory does not grow continuously.
- [ ] Confirm no audio dropouts or document synchronization failures.
- [ ] Confirm both final WebM files play through their complete duration.

## Platform matrix

- [ ] Windows candidate to Windows interviewer.
- [ ] Windows candidate to macOS interviewer.
- [ ] macOS candidate to Windows interviewer.
- [ ] macOS candidate to macOS interviewer.
- [ ] P2P route.
- [ ] TURN-forced relay route.
