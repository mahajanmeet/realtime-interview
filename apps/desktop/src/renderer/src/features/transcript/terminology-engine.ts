import type { VocabularyProfile } from './vocabulary';

export type TerminologyCorrection = {
  alias: string;
  canonical: string;
};

export type TerminologyResult = {
  text: string;
  corrections: TerminologyCorrection[];
};

export class TerminologyEngine {
  constructor(private readonly profile: VocabularyProfile) {}

  normalize(text: string, recentContext: string): TerminologyResult {
    let normalized = text;
    const corrections: TerminologyCorrection[] = [];
    const context = `${recentContext} ${text}`.toLowerCase();
    const candidates = this.profile.entries
      .filter((entry) =>
        entry.context.some((term) => containsPhrase(context, term.toLowerCase())),
      )
      .flatMap((entry) => entry.aliases.map((alias) => ({ entry, alias })))
      .sort(
        (left, right) =>
          right.alias.length - left.alias.length || right.entry.weight - left.entry.weight,
      );

    for (const { entry, alias } of candidates) {
      const pattern = new RegExp(`(^|\\W)(${escapeRegExp(alias)})(?=$|\\W)`, 'gi');

      normalized = normalized.replace(pattern, (_match, prefix: string) => {
        corrections.push({ alias, canonical: entry.canonical });
        return `${prefix}${entry.canonical}`;
      });
    }

    return { text: normalized, corrections };
  }
}

const containsPhrase = (text: string, phrase: string): boolean =>
  new RegExp(`(^|\\W)${escapeRegExp(phrase)}(?=$|\\W)`, 'i').test(text);

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
