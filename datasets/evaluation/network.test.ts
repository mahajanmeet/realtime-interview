import assert from 'node:assert/strict';
import test from 'node:test';
import { TranscriptOutbox } from '../../apps/desktop/src/renderer/src/lib/transcript-outbox.ts';
import { SessionService } from '../../apps/server/src/sessions/session-service.ts';
import { DocumentChannel } from '../../apps/desktop/src/renderer/src/features/document/document-channel.ts';
import { TranscriptStore } from '../../apps/desktop/src/renderer/src/features/transcript/transcript-store.ts';

const message = (id: string, text: string, status: 'partial' | 'final' = 'partial') => ({
  type: 'transcript-segment' as const,
  segment: {
    id,
    text,
    rawText: text,
    status,
    source: 'microphone' as const,
    startMs: 0,
    endMs: null,
  },
});

test('coalesces hypotheses and removes duplicated raw text from network traffic', () => {
  const outbox = new TranscriptOutbox();
  for (let i = 0; i < 100; i++) outbox.enqueue(message('one', `word ${i}`));
  const sent: string[] = [];
  outbox.flush(100, (wire) => {
    sent.push(wire);
    return true;
  });
  assert.equal(sent.length, 1);
  assert.equal(JSON.parse(sent[0]!).segment.text, 'word 99');
  assert.equal(JSON.parse(sent[0]!).segment.rawText, undefined);
});

test('retains blocked updates and replays recent final snapshots after reconnect', () => {
  const outbox = new TranscriptOutbox();
  outbox.enqueue(message('one', 'Completed.', 'final'));
  outbox.enqueue(message('one', 'stale'));
  outbox.flush(100, () => false);
  const sent: string[] = [];
  const send = (wire: string) => {
    sent.push(wire);
    return true;
  };
  outbox.flush(200, send);
  outbox.flush(300, send);
  assert.equal(sent.length, 1);
  outbox.replay();
  outbox.flush(400, send);
  assert.equal(sent.length, 2);
  assert.equal(JSON.parse(sent[1]!).segment.text, 'Completed.');
});

test('bounds payload traffic under sustained two-source congestion', () => {
  const outbox = new TranscriptOutbox();
  let bytes = 0;
  const counts = new Map<string, number>();
  for (let tick = 1; tick <= 600; tick++) {
    outbox.enqueue(message('mic', `${tick} ${'word '.repeat(2000)}`));
    outbox.enqueue(message('system', `${tick} ${'text '.repeat(2000)}`));
    outbox.flush(tick * 100, (wire) => {
      bytes += new TextEncoder().encode(wire).length;
      const id = JSON.parse(wire).segment.id as string;
      counts.set(id, (counts.get(id) ?? 0) + 1);
      return true;
    });
  }
  assert.ok(bytes <= 65536 + 60 * 16384, `Exceeded budget: ${bytes}`);
  assert.ok(bytes > 800_000, 'Must make progress, not stall');
  assert.ok((counts.get('mic') ?? 0) > 30, 'Microphone must not starve');
  assert.ok((counts.get('system') ?? 0) > 30, 'System audio must not starve');
});

test('bounds reconnect history and protects final transcript from delayed partials', () => {
  const outbox = new TranscriptOutbox();
  for (let i = 0; i < 300; i++) outbox.enqueue(message(String(i), 'Done.', 'final'));
  const sent: string[] = [];
  outbox.flush(100, (wire) => {
    sent.push(wire);
    return true;
  });
  assert.equal(sent.length, 256);
  assert.ok(!sent.some((wire) => JSON.parse(wire).segment.id === '0'));
  const store = new TranscriptStore();
  store.upsert({ ...message('one', 'Done.', 'final').segment, speaker: 'candidate' });
  store.upsert({ ...message('one', 'Old partial').segment, speaker: 'candidate' });
  assert.equal(store.all()[0]?.text, 'Done.');
});

test('retains latest notes while congested and retries on channel open', () => {
  class FakeChannel extends EventTarget {
    label = 'document';
    readyState = 'open';
    bufferedAmount = 20_000;
    sent: string[] = [];
    send(wire: string) {
      this.sent.push(wire);
    }
    close() {
      this.readyState = 'closed';
    }
  }
  const transport = new FakeChannel();
  const channel = new DocumentChannel({ onUpdate() {}, onOpen() {}, onClose() {} });
  channel.accept(transport as unknown as RTCDataChannel);
  try {
    const update = {
      type: 'document-update' as const,
      documentId: 'e13861b4-cd03-4925-a5e6-9d2c291d8a37',
      revision: 1,
      text: 'First',
      updatedBy: 'candidate' as const,
      updatedAt: 1,
    };
    channel.send(update);
    channel.send({ ...update, revision: 2, text: 'Latest' });
    assert.equal(transport.sent.length, 0);
    transport.bufferedAmount = 0;
    transport.dispatchEvent(new Event('open'));
    assert.equal(transport.sent.length, 1);
    assert.equal(JSON.parse(transport.sent[0]!).text, 'Latest');
  } finally {
    channel.close();
  }
});

test('joined interview allows a reconnect five hours later', () => {
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  try {
    const sessions = new SessionService();
    const host = sessions.createSession();
    const guest = sessions.joinSession(host.code);
    now += 5 * 60 * 60 * 1000;
    assert.ok(sessions.issueSignalTicket(host.sessionId, host.peerToken));
    assert.ok(sessions.issueSignalTicket(guest.sessionId, guest.peerToken));
  } finally {
    Date.now = originalNow;
  }
});
