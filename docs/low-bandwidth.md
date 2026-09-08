# Low-bandwidth operation

The desktop app targets speech/transcript use on approximately 1 Mbps connections.
This is a design target, not a measured end-to-end latency guarantee.

- Speech recognition runs locally; audio is not uploaded for recognition.
- Transcript partials coalesce on a 100 ms timer. Final results attempt an
  immediate send when the connection and budget permit.
- Transcript JSON is budgeted to 16 KiB/s with an initial burst of 64 KiB.
  TCP/TLS overhead and other traffic are additional.
- Remote audio requests a 32 kbps payload cap per outgoing audio track.
  Unsupported runtimes log a warning. This does not alter local ASR input.
- Notes edits debounce for 200 ms and retain the latest pending snapshot while
  the data channel is congested. Large notes still use full snapshots and can
  exceed transport message limits; they are not covered by the transcript budget.
- The server checks WebSocket liveness every 15 seconds. A broken connection can
  take roughly 30 seconds to detect. Reconnect uses backoff and jitter.
- Reconnect replays up to 256 recent transcript snapshots, limited to 2 MiB.
  Older snapshots may be evicted during long outages. There is no delivery ACK
  or durable transcript replay across application restarts.
- Invitations expire after 30 minutes. Joined session credentials remain valid
  for eight hours from joining. Backend sessions are in memory: restarting or
  redeploying the server requires a new interview.

## Test the updated build

1. Deploy the updated backend and install the rebuilt desktop app on both devices.
2. Configure the same HTTPS backend URL on both devices; create and join a room.
3. First test microphone transcription alone, then enable system audio separately.
4. Use router/OS bandwidth shaping to limit each device to 1 Mbps upload and
   download. Browser DevTools throttling alone does not test native capture or
   all WebRTC traffic. Speak continuously and verify both sources keep updating.
5. Disconnect one device for 10–20 seconds, reconnect, and verify recent transcript
   segments catch up without duplicate cards. Test notes while the channel is busy.
6. Measure when speech occurs, when local text appears, and when remote text
   appears. Report these separately to distinguish ASR latency from network delay.

Disable remote audio if only text is needed. Remote WebRTC audio/notes still need
a viable direct route or TURN; these changes do not bypass restrictive networks.
Transcript relay uses TLS to the backend, not end-to-end encryption against it.
