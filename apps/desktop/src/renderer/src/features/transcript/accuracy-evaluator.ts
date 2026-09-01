export type AccuracyMetrics = {
  totalWords: number;
  wordErrors: number;
  wordErrorRate: number;
  technicalTerms: number;
  technicalTermErrors: number;
  technicalTermErrorRate: number;
};

export const evaluateTranscriptAccuracy = (
  reference: string,
  hypothesis: string,
  technicalTerms: string[],
): AccuracyMetrics => {
  const referenceWords = tokenize(reference);
  const hypothesisWords = tokenize(hypothesis);
  const wordErrors = editDistance(referenceWords, hypothesisWords);
  let referenceTermCount = 0;
  let technicalTermErrors = 0;

  for (const term of new Set(technicalTerms.map((value) => value.trim()).filter(Boolean))) {
    const expectedCount = countPhrase(reference, term);
    const actualCount = countPhrase(hypothesis, term);

    referenceTermCount += expectedCount;
    technicalTermErrors += Math.abs(expectedCount - actualCount);
  }

  return {
    totalWords: referenceWords.length,
    wordErrors,
    wordErrorRate: safeRatio(wordErrors, referenceWords.length),
    technicalTerms: referenceTermCount,
    technicalTermErrors,
    technicalTermErrorRate: safeRatio(technicalTermErrors, referenceTermCount),
  };
};

const tokenize = (text: string): string[] =>
  text
    .toLocaleLowerCase()
    .match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu) ?? [];

const countPhrase = (text: string, phrase: string): number => {
  const haystack = tokenize(text);
  const needle = tokenize(phrase);

  if (needle.length === 0 || haystack.length < needle.length) {
    return 0;
  }

  let matches = 0;

  for (let index = 0; index <= haystack.length - needle.length; index += 1) {
    if (needle.every((word, offset) => word === haystack[index + offset])) {
      matches += 1;
    }
  }

  return matches;
};

const editDistance = (left: string[], right: string[]): number => {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        (current[rightIndex - 1] ?? 0) + 1,
        (previous[rightIndex] ?? 0) + 1,
        (previous[rightIndex - 1] ?? 0) + substitutionCost,
      );
    }

    previous = current;
  }

  return previous[right.length] ?? left.length;
};

const safeRatio = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : numerator / denominator;
