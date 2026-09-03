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
  /** disclosure weight of bank questions (see bank.ts); follow-ups/probes are exempt from gating. */
  intensity?: 'low' | 'medium' | 'high';
  /** the answer this follow-up / probe grew out of — what the thread rules key on. */
  parentAnswerId?: string | null;
}

export interface PickerState {
  coverage: Record<InterviewCategory, CategoryCoverage>;
  /** mean(1 − trait confidence) per category; 1 when the category has no traits yet. */
  uncertainty: Record<InterviewCategory, number>;
  /** categories of the last answered questions, most recent first (≤3 considered). */
  recentCategories: InterviewCategory[];
  /** facets of questions skipped within the last 10 answers. */
  recentSkippedFacets: string[];
  /** ids of the last answers (skips included — a skip is still a turn), most recent first, ≤12. */
  recentAnswerIds?: string[];
  /** text of the last questions actually put to the person, most recent first, ≤6. */
  recentQuestionTexts?: string[];
}

// ── thread rules ─────────────────────────────────────────────────────────────
// "I give it one answer and it keeps asking about it" was three bugs stacked:
// follow-ups saved with no link to their answer, a depth guard reading a field
// nothing wrote, and no notion of "not right now". These rules are the fix.

/** A follow-up may not come back until this many other turns have passed since its parent answer. */
export const FOLLOW_UP_COOLDOWN = 2;
/** A contradiction probe waits at least this many turns (it references the answer directly). */
export const PROBE_COOLDOWN = 1;
/** Follow-ups whose parent is older than this many turns are stale — the moment has passed. */
export const FOLLOW_UP_MAX_AGE = 12;
/** Distinctive-word overlap at or above this is a rephrase, not a new question. */
export const CIRCLE_THRESHOLD = 0.5;

const STOP = new Set(['tell', 'about', 'time', 'when', 'what', 'that', 'this', 'with', 'your', 'you', 'were', 'there', 'have',
  'from', 'they', 'them', 'then', 'than', 'ever', 'last', 'recent', 'specific', 'actually', 'really', 'someone', 'something',
  'being', 'which', 'their', 'would', 'could', 'should', 'made', 'make', 'felt', 'feel', 'into', 'like', 'just', 'most',
  'more', 'some', 'does', 'did', 'how', 'why', 'who', 'the', 'and', 'for', 'was', 'one', 'out', 'has', 'had', 'been',
  'much', 'many', 'still', 'again', 'other', 'another', 'where', 'ago', 'back', 'since', 'after', 'before', 'happened',
  'moment', 'think', 'thought', 'want', 'wanted', 'know', 'knew', 'thing', 'things', 'people', 'person', 'yourself']);

/** The words that carry a question's topic — lowercase, ≥4 letters, minus filler. */
export function distinctiveTokens(text: string): Set<string> {
  return new Set(text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 4 && !STOP.has(w)));
}

/** Overlap coefficient over distinctive words: 1 = one question's topic words are all inside the other's. */
export function questionOverlap(a: string, b: string): number {
  const A = distinctiveTokens(a), B = distinctiveTokens(b);
  if (A.size < 2 || B.size < 2) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / Math.min(A.size, B.size);
}

/** Not right now: a follow-up needs breathing room after its parent; a stale one is retired upstream. */
export function threadEligible(c: Candidate, s: PickerState): boolean {
  if (c.kind === 'behavioural' || !c.parentAnswerId) return true;
  const recent = s.recentAnswerIds ?? [];
  const age = recent.indexOf(c.parentAnswerId);
  if (age === -1) return c.kind === 'contradiction'; // a probe's parent may be old; a follow-up's must be recent
  const cooldown = c.kind === 'contradiction' ? PROBE_COOLDOWN : FOLLOW_UP_COOLDOWN;
  return age >= cooldown && age < FOLLOW_UP_MAX_AGE;
}

/** Would this read as the same question again? (Compared with what was actually asked lately.) */
export function circles(c: Candidate, s: PickerState): boolean {
  return (s.recentQuestionTexts ?? []).some((t) => questionOverlap(c.text, t) >= CIRCLE_THRESHOLD);
}

const IMPORTANT: ReadonlySet<InterviewCategory> = new Set(['identity', 'values', 'decision_making']);

export function scoreCandidate(c: Candidate, s: PickerState): number {
  const cov = s.coverage[c.category];
  const coverageGap = 1 - (cov?.coverage ?? 0);
  const uncertainty = s.uncertainty[c.category] ?? 1;
  const infoGain = c.facet ? 1 - (cov?.facets[c.facet] ?? 0) : 0.5;
  const importanceBonus = IMPORTANT.has(c.category) && (cov?.answered ?? 0) < 3 ? 0.15 : 0;
  // Contradiction probes outrank everything a bank question can score (max ≈1.95):
  // an open tension is the single most informative thing to ask about.
  const kindBonus = c.kind === 'follow_up' ? 0.35 + 0.55 * Math.min(1, Math.max(0, c.priority))
    : c.kind === 'contradiction' ? 1.2 : 0;
  const last = s.recentCategories[0];
  const rotation = (c.kind === 'behavioural' && last === c.category ? 0.5 : 0)
    + (c.kind === 'behavioural' && last !== c.category && s.recentCategories.slice(0, 3).includes(c.category) ? 0.2 : 0);
  const skipPenalty = c.facet && s.recentSkippedFacets.includes(c.facet) ? 1 : 0;
  return 0.9 * coverageGap + 0.5 * uncertainty + 0.4 * infoGain + importanceBonus + kindBonus - rotation - skipPenalty;
}

const keyOf = (c: Candidate) => c.bankKey ?? c.id ?? c.text;

/** Gradual escalation (McAdams-style): the interview earns the right to ask
 *  heavy questions. Behavioural candidates are gated by total answers so far —
 *  high (regret/loss/shame) waits for 10, medium for 2; follow-ups and
 *  contradiction probes continue existing threads and are never gated. If the
 *  gate would empty the pool, it opens (the interview must never stall). */
function escalationPool(candidates: Candidate[], s: PickerState): Candidate[] {
  const answeredTotal = Object.values(s.coverage).reduce((a, c) => a + (c?.answered ?? 0), 0);
  const eligible = candidates.filter((c) => c.kind !== 'behavioural'
    || ((c.intensity ?? 'medium') === 'high' ? answeredTotal >= 10
      : (c.intensity ?? 'medium') === 'medium' ? answeredTotal >= 2
      : true));
  return eligible.length ? eligible : candidates;
}

/** Highest score wins; ties break to the category with fewer answers, then lexicographically — never randomly. */
export function pickNext(candidates: Candidate[], s: PickerState): Candidate | null {
  if (!candidates.length) return null;
  // Thread rules first, then the rephrase guard; each layer falls back rather than stalling.
  const inThread = candidates.filter((c) => threadEligible(c, s));
  const fresh = inThread.filter((c) => !circles(c, s));
  const pool = fresh.length ? fresh : inThread.length ? inThread : candidates;
  const scored = escalationPool(pool, s).map((c) => ({ c, score: scoreCandidate(c, s) }));
  scored.sort((a, b) =>
    b.score - a.score
    || (s.coverage[a.c.category]?.answered ?? 0) - (s.coverage[b.c.category]?.answered ?? 0)
    || (keyOf(a.c) < keyOf(b.c) ? -1 : keyOf(a.c) > keyOf(b.c) ? 1 : 0));
  return scored[0]!.c;
}
