/**
 * Coverage math — pure and deterministic, so "how well do we know you" is a
 * function of the data, never vibes. A category's coverage blends how many of
 * its facets have real answers with how many knowledge items it produced, and
 * an open contradiction caps it (we do NOT claim to know an area whose story
 * currently conflicts).
 */
import { INTERVIEW_CATEGORIES, type InterviewCategory } from '@opersona/shared';
import { CATEGORY_FACETS } from './bank.js';

export type AnswerQuality = 'substantive' | 'thin' | 'off_topic' | 'refusal';

export interface CoverageAnswer {
  category: InterviewCategory;
  facet: string | null;
  /** null = extraction still pending — counts as substantive until judged. */
  quality: AnswerQuality | null;
  skipped: boolean;
}

export interface CoverageItems {
  /** knowledge items (traits + rules + memories, not retired/disputed) per category and tier */
  explicit: number;
  inferred: number;
}

export interface CategoryCoverage {
  category: InterviewCategory;
  coverage: number;
  facets: Record<string, number>;
  answered: number;
  openContradictions: number;
  /** true while there is too little data for the % to mean anything */
  justStarted: boolean;
}

export const ANSWER_WEIGHT: Record<AnswerQuality, number> = { substantive: 1, thin: 0.5, off_topic: 0, refusal: 0 };
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function computeCoverage(input: {
  category: InterviewCategory;
  answers: CoverageAnswer[];              // answers for THIS category only
  items: CoverageItems;
  openContradictions: number;
}): CategoryCoverage {
  const facets = CATEGORY_FACETS[input.category];
  const weightByFacet: Record<string, number> = Object.fromEntries(facets.map((f) => [f, 0]));
  let answered = 0;
  for (const a of input.answers) {
    if (a.skipped) continue;
    answered++;
    const w = a.quality == null ? 1 : ANSWER_WEIGHT[a.quality];
    if (a.facet && a.facet in weightByFacet) weightByFacet[a.facet] = (weightByFacet[a.facet] ?? 0) + w;
  }
  const facetScores: Record<string, number> = Object.fromEntries(
    facets.map((f) => [f, clamp01(Math.min(1, (weightByFacet[f] ?? 0) / 2))]),
  );
  const facetMean = facets.length ? facets.reduce((s, f) => s + facetScores[f]!, 0) / facets.length : 0;
  const itemScore = clamp01((input.items.explicit + 0.5 * input.items.inferred) / 8);
  const raw = clamp01(0.75 * facetMean + 0.25 * itemScore) * (input.openContradictions > 0 ? 0.85 : 1);
  return {
    category: input.category,
    coverage: clamp01(raw),
    facets: facetScores,
    answered,
    openContradictions: input.openContradictions,
    justStarted: answered < 2,
  };
}

export function computeAllCoverage(perCategory: Record<InterviewCategory, {
  answers: CoverageAnswer[]; items: CoverageItems; openContradictions: number;
}>): CategoryCoverage[] {
  return INTERVIEW_CATEGORIES.map((category) => computeCoverage({ category, ...perCategory[category] }));
}
