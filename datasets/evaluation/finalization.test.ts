import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { FinalizationManager } from '../../apps/desktop/src/main/asr/finalization-manager.ts';
import type {
  FinalizeRequest,
  FinalTranscriber,
} from '../../apps/desktop/src/main/asr/final-transcriber.ts';

test('persists finalization state and reconciles live text by timestamp', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'interview-finalization-'));
  const stateFile = join(directory, 'jobs.json');
  const sessionId = crypto.randomUUID();
  let resolveComplete: (() => void) | undefined;
  const completed = new Promise<void>((resolve) => {
    resolveComplete = resolve;
  });
  const transcriber: FinalTranscriber = {
    transcribe: async (_request: FinalizeRequest) => ({
      segments: [{ startMs: 0, endMs: 2_000, text: 'We use PostgreSQL.' }],
    }),
  };
  const manager = new FinalizationManager({
    stateFile,
    transcriber,
    onUpdate: (job) => {
      if (job.state === 'complete') {
        resolveComplete?.();
      }
    },
  });

  try {
    await manager.initialize();
    await manager.enqueue(
      { sessionId, source: 'microphone', filePath: join(directory, 'microphone.webm') },
      [
        {
          id: 'live-1',
          source: 'microphone',
          startMs: 0,
          endMs: 2_000,
          text: 'We use PostgreSQL.',
          rawText: 'WE USE POSTGRESQL',
          status: 'final',
        },
      ],
    );
    await completed;

    const [job] = manager.all();
    assert.equal(job?.state, 'complete');
    assert.equal(job?.finalSegments[0]?.liveText, 'WE USE POSTGRESQL');
    assert.equal(job?.finalSegments[0]?.finalText, 'We use PostgreSQL.');
    assert.equal(job?.finalSegments[0]?.confidence, 'high');

    const saved = JSON.parse(await readFile(stateFile, 'utf8'));
    assert.equal(saved.jobs[0].state, 'complete');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('recovers an interrupted processing job as pending', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'interview-finalization-'));
  const stateFile = join(directory, 'jobs.json');
  const sessionId = crypto.randomUUID();

  try {
    await writeFile(
      stateFile,
      JSON.stringify({
        version: 1,
        jobs: [
          {
            id: `${sessionId}:system`,
            request: {
              sessionId,
              source: 'system',
              filePath: join(directory, 'system.webm'),
            },
            state: 'processing',
            attempts: 1,
            updatedAt: Date.now(),
            liveSegments: [],
            finalSegments: [],
          },
        ],
      }),
      'utf8',
    );

    const manager = new FinalizationManager({
      stateFile,
      transcriber: {
        transcribe: async () => ({ segments: [] }),
      },
    });

    await manager.initialize();

    assert.equal(manager.all()[0]?.state, 'pending');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
