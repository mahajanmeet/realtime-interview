import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateTranscriptAccuracy } from '../../apps/desktop/src/renderer/src/features/transcript/accuracy-evaluator.ts';
import { TerminologyEngine } from '../../apps/desktop/src/renderer/src/features/transcript/terminology-engine.ts';
import { interviewVocabulary } from '../../apps/desktop/src/renderer/src/features/transcript/vocabulary.ts';

const engine = new TerminologyEngine(interviewVocabulary);

test('normalizes a technical alias when domain context is present', () => {
  const result = engine.normalize(
    'We use post grass sequel for storage.',
    'The service writes each account to a relational database.',
  );

  assert.equal(result.text, 'We use PostgreSQL for storage.');
  assert.deepEqual(result.corrections, [
    { alias: 'post grass sequel', canonical: 'PostgreSQL' },
  ]);
});

test('does not normalize an ambiguous alias without technical context', () => {
  const result = engine.normalize('The sequel was better.', 'We discussed the film series.');

  assert.equal(result.text, 'The sequel was better.');
  assert.deepEqual(result.corrections, []);
});

test('does not rewrite the meaning of a candidate claim', () => {
  const result = engine.normalize('Redis is relational.', 'We use Redis as a database.');

  assert.equal(result.text, 'Redis is relational.');
});

test('calculates word and technical-term errors independently', () => {
  const metrics = evaluateTranscriptAccuracy(
    'We use PostgreSQL for the database.',
    'We use post grass sequel for the database.',
    ['PostgreSQL'],
  );

  assert.equal(metrics.totalWords, 6);
  assert.equal(metrics.wordErrors, 3);
  assert.equal(metrics.technicalTerms, 1);
  assert.equal(metrics.technicalTermErrors, 1);
  assert.equal(metrics.technicalTermErrorRate, 1);
});
