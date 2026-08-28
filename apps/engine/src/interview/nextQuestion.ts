/**
 * The next-question picker — a deterministic scorer, no randomness anywhere:
 * the same knowledge state always yields the same question. It leans toward
 * the least-covered important areas, chases fresh follow-up hooks and open
 * contradictions first, rotates categories so the interview breathes, and
 * respects skips.
 *
 *   score = 0.9·coverageGap + 0.5·uncertainty + 0.4·infoGain
 *         + importanceBonus + kindBonus − rotation − skipPenalty
 */
import type { InterviewCategory } from '@opersona/shared';
import type { CategoryCoverage } from './coverage.js';

export interface Candidate {
  /** DB row id when already materialized; virtual bank candidates carry only bankKey. */
  id?: string;
  bankKey?: string;
  category: InterviewCategory;
  facet: string | null;
  kind: 'behavioural' | 'follow_up' | 'contradiction';
  /** follow-up hook strength 0..1 (stored in the row's priority column). */
  priority: number;
  text: string;
}

export interface PickerState {
  coverage: Record<InterviewCategory, CategoryCoverage>;
  /** mean(1 − trait confidence) per category; 1 when the category has no traits yet. */
  uncertainty: Record<InterviewCategory, number>;
  /** categories of the last answered questions, most recent first (≤3 considered). */
  recentCategories: InterviewCategory[];
  /** facets of questions skipped within the last 10 answers. */
  recentSkippedFacets: string[];
}

const IMPORTANT: ReadonlySet<InterviewCategory> = new Set(['identity', 'values', 'decision_making']);

export function scoreCandidate(c: Candidate, s: PickerState): number {
  const cov = s.coverage[c.category];
  const coverageGap = 1 - (cov?.coverage ?? 0);
  const uncertainty = s.uncertainty[c.category] ?? 1;
  const infoGain = c.facet ? 1 - (cov?.facets[c.facet] ?? 0) : 0.5;
  const importanceBonus = IMPORTANT.has(c.category) && (cov?.answered ?? 0) < 3 ? 0.15 : 0;
  const kindBonus = c.kind === 'follow_up' ? 0.35 + 0.55 * Math.min(1, Math.max(0, c.priority))
    : c.kind === 'contradiction' ? 0.6 : 0;
  const last = s.recentCategories[0];
  const rotation = (c.kind === 'behavioural' && last === c.category ? 0.5 : 0)
    + (c.kind === 'behavioural' && last !== c.category && s.recentCategories.slice(0, 3).includes(c.category) ? 0.2 : 0);
  const skipPenalty = c.facet && s.recentSkippedFacets.includes(c.facet) ? 1 : 0;
  return 0.9 * coverageGap + 0.5 * uncertainty + 0.4 * infoGain + importanceBonus + kindBonus - rotation - skipPenalty;
}

const keyOf = (c: Candidate) => c.bankKey ?? c.id ?? c.text;

/** Highest score wins; ties break to the category with fewer answers, then lexicographically — never randomly. */
export function pickNext(candidates: Candidate[], s: PickerState): Candidate | null {
  if (!candidates.length) return null;
  const scored = candidates.map((c) => ({ c, score: scoreCandidate(c, s) }));
  scored.sort((a, b) =>
    b.score - a.score
    || (s.coverage[a.c.category]?.answered ?? 0) - (s.coverage[b.c.category]?.answered ?? 0)
    || (keyOf(a.c) < keyOf(b.c) ? -1 : keyOf(a.c) > keyOf(b.c) ? 1 : 0));
  return scored[0]!.c;
}
