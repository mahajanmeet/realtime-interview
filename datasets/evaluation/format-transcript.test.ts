import assert from 'node:assert/strict';
import test from 'node:test';
import { formatTranscript } from '../../apps/desktop/src/renderer/src/features/transcript/format-transcript.ts';
import { TerminologyEngine } from '../../apps/desktop/src/renderer/src/features/transcript/terminology-engine.ts';
import { interviewVocabulary } from '../../apps/desktop/src/renderer/src/features/transcript/vocabulary.ts';

test('formats uppercase recognition while preserving technical names', () => {
  assert.equal(
    formatTranscript('I USE PYTORCH AND SQL FOR NLP', true),
    'I use PyTorch and SQL for NLP.',
  );
});
test('does not terminate partial results or invent missing words', () => {
  assert.equal(formatTranscript('A BODY OF TAX', false), 'A body of tax');
  assert.equal(formatTranscript('A BODY OF TAX', true), 'A body of tax.');
});
test('preserves existing mixed case, punctuation, versions and code identifiers', () => {
  assert.equal(
    formatTranscript('We call getUserId with Node.js 24.1. Is that correct?', true),
    'We call getUserId with Node.js 24.1. Is that correct?',
  );
  assert.equal(formatTranscript('USE C++ AND .NET', true), 'Use C++ and .NET.');
});
test('capitalizes sentence starts without breaking technical acronym casing', () => {
  assert.equal(formatTranscript('WE USE JSON. IT IS AN API!', true), 'We use JSON. It is an API!');
  assert.equal(formatTranscript('   ', true), '');
});
test('applies ML aliases only with matching context', () => {
  const engine = new TerminologyEngine(interviewVocabulary);
  assert.equal(
    engine.normalize('We train a model using pie torch', '').text,
    'We train a model using PyTorch',
  );
  assert.equal(engine.normalize('A pie torch', 'cooking dinner').text, 'A pie torch');
});
