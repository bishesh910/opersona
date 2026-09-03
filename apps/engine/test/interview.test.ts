import { describe, expect, it } from 'vitest';
import { INTERVIEW_CATEGORIES } from '@opersona/shared';
import { BANK, CATEGORY_FACETS, bankFor } from '../src/interview/bank.js';
import { computeCoverage, type CoverageAnswer } from '../src/interview/coverage.js';
import {
  pickNext, scoreCandidate, questionOverlap, threadEligible, circles, FOLLOW_UP_COOLDOWN, FOLLOW_UP_MAX_AGE,
  type Candidate, type PickerState,
} from '../src/interview/nextQuestion.js';
import { sanitizeExtraction, reinforceConfidence, AnswerExtraction, type AnswerExtractionT } from '../src/interview/extractAnswer.js';

// ── bank integrity ───────────────────────────────────────────────────────────
describe('question bank', () => {
  it('covers all 10 categories with one opener per facet', () => {
    for (const cat of INTERVIEW_CATEGORIES) {
      const qs = bankFor(cat);
      expect(qs.length, cat).toBeGreaterThanOrEqual(CATEGORY_FACETS[cat].length);
      const facets = new Set(qs.map((b) => b.facet));
      for (const f of CATEGORY_FACETS[cat]) expect(facets.has(f), `${cat}.${f}`).toBe(true);
    }
  });
  it('bank keys are unique and questions non-empty', () => {
    expect(new Set(BANK.map((b) => b.bankKey)).size).toBe(BANK.length);
    for (const b of BANK) {
      expect(b.text.trim().length).toBeGreaterThan(20);
      expect((CATEGORY_FACETS[b.category] as readonly string[]).includes(b.facet)).toBe(true);
    }
  });
});

// ── coverage math ────────────────────────────────────────────────────────────
const A = (facet: string, quality: CoverageAnswer['quality'], skipped = false): CoverageAnswer =>
  ({ category: 'values', facet, quality, skipped });

describe('computeCoverage', () => {
  it('empty category → 0 and just-started', () => {
    const c = computeCoverage({ category: 'values', answers: [], items: { explicit: 0, inferred: 0 }, openContradictions: 0 });
    expect(c.coverage).toBe(0);
    expect(c.justStarted).toBe(true);
  });
  it('substantive counts full, thin half, off_topic/refusal zero; pending counts as substantive', () => {
    const base = { category: 'values' as const, items: { explicit: 0, inferred: 0 }, openContradictions: 0 };
    const sub = computeCoverage({ ...base, answers: [A('named_values', 'substantive')] });
    const thin = computeCoverage({ ...base, answers: [A('named_values', 'thin')] });
    const off = computeCoverage({ ...base, answers: [A('named_values', 'off_topic')] });
    const pending = computeCoverage({ ...base, answers: [A('named_values', null)] });
    expect(sub.facets.named_values).toBeCloseTo(0.5);
    expect(thin.facets.named_values).toBeCloseTo(0.25);
    expect(off.facets.named_values).toBe(0);
    expect(pending.facets.named_values).toBeCloseTo(0.5);
    expect(sub.coverage).toBeGreaterThan(thin.coverage);
  });
  it('knowledge items raise coverage; explicit counts double the inferred', () => {
    const answers = [A('named_values', 'substantive')];
    const none = computeCoverage({ category: 'values', answers, items: { explicit: 0, inferred: 0 }, openContradictions: 0 });
    const four = computeCoverage({ category: 'values', answers, items: { explicit: 4, inferred: 0 }, openContradictions: 0 });
    const eightInferred = computeCoverage({ category: 'values', answers, items: { explicit: 0, inferred: 8 }, openContradictions: 0 });
    expect(four.coverage).toBeGreaterThan(none.coverage);
    expect(four.coverage).toBeCloseTo(eightInferred.coverage);
  });
  it('an open contradiction caps coverage at 85%', () => {
    const answers = CATEGORY_FACETS.values.map((f) => A(f, 'substantive'));
    const clean = computeCoverage({ category: 'values', answers, items: { explicit: 8, inferred: 0 }, openContradictions: 0 });
    const contested = computeCoverage({ category: 'values', answers, items: { explicit: 8, inferred: 0 }, openContradictions: 1 });
    expect(contested.coverage).toBeCloseTo(clean.coverage * 0.85);
  });
  it('is deterministic', () => {
    const input = { category: 'values' as const, answers: [A('sacrifices', 'substantive'), A('risk', 'thin', true)], items: { explicit: 2, inferred: 3 }, openContradictions: 1 };
    expect(computeCoverage(input)).toEqual(computeCoverage(input));
  });
});

// ── picker ───────────────────────────────────────────────────────────────────
function state(overrides?: Partial<PickerState>): PickerState {
  const coverage = Object.fromEntries(INTERVIEW_CATEGORIES.map((c) => [c, {
    category: c, coverage: 0.5, facets: Object.fromEntries(CATEGORY_FACETS[c].map((f) => [f, 0.5])), answered: 5, openContradictions: 0, justStarted: false,
  }])) as PickerState['coverage'];
  const uncertainty = Object.fromEntries(INTERVIEW_CATEGORIES.map((c) => [c, 0.5])) as PickerState['uncertainty'];
  return { coverage, uncertainty, recentCategories: [], recentSkippedFacets: [], ...overrides };
}
const bankC = (category: Candidate['category'], facet: string, text = 'Tell me about a time…'): Candidate =>
  ({ bankKey: `${category}.${facet}.1`, category, facet, kind: 'behavioural', priority: 0, text });

describe('pickNext', () => {
  it('a strong follow-up hook beats plain bank questions', () => {
    const s = state();
    const follow: Candidate = { id: 'f1', category: 'values', facet: 'sacrifices', kind: 'follow_up', priority: 0.9, text: 'Why did that matter?' };
    const winner = pickNext([bankC('money', 'spending'), follow, bankC('work', 'feedback')], s);
    expect(winner?.id).toBe('f1');
  });
  it('a contradiction probe outranks everything else at equal coverage', () => {
    const s = state();
    const probe: Candidate = { id: 'c1', category: 'values', facet: null, kind: 'contradiction', priority: 0, text: 'What makes those different?' };
    const follow: Candidate = { id: 'f1', category: 'values', facet: 'sacrifices', kind: 'follow_up', priority: 0.3, text: 'And then?' };
    expect(pickNext([bankC('money', 'spending'), follow, probe], s)?.id).toBe('c1');
  });
  it('rotates away from the category just answered', () => {
    const s = state({ recentCategories: ['money'] });
    const winner = pickNext([bankC('money', 'saving'), bankC('ethics', 'fairness')], s);
    expect(winner?.category).toBe('ethics');
  });
  it('suppresses facets the person just skipped', () => {
    const s = state({ recentSkippedFacets: ['fairness'] });
    const winner = pickNext([bankC('ethics', 'fairness'), bankC('ethics', 'honesty')], s);
    expect(winner?.facet).toBe('honesty');
  });
  it('prefers uncovered important categories from a cold start', () => {
    const s = state();
    for (const c of INTERVIEW_CATEGORIES) { s.coverage[c] = { ...s.coverage[c], coverage: 0, answered: 0, justStarted: true }; s.uncertainty[c] = 1; }
    const winner = pickNext([bankC('social', 'strangers'), bankC('identity', 'self_image'), bankC('future', 'fears')], s);
    expect(winner?.category).toBe('identity'); // importance bonus while under-answered
  });
  it('is deterministic — same state, same pick, stable tie-break', () => {
    const s = state();
    const cands = [bankC('ethics', 'honesty'), bankC('ethics', 'fairness'), bankC('social', 'belonging')];
    const first = pickNext([...cands], s);
    for (let i = 0; i < 5; i++) expect(pickNext([...cands].reverse(), state())).toEqual(first);
  });
  it('empty candidate list → null', () => {
    expect(pickNext([], state())).toBeNull();
  });
  it('scoreCandidate penalizes covered facets (info gain)', () => {
    const s = state();
    s.coverage.values = { ...s.coverage.values, facets: { ...s.coverage.values.facets, named_values: 1, sacrifices: 0 } };
    expect(scoreCandidate(bankC('values', 'sacrifices'), s)).toBeGreaterThan(scoreCandidate(bankC('values', 'named_values'), s));
  });
});

// ── sanitizeExtraction ───────────────────────────────────────────────────────
const ANSWER = 'I quit my consulting job in 2023 because I wanted to build things again. My partner thought I was crazy but supported it.';
const base: AnswerExtractionT = AnswerExtraction.parse({
  quality: 'substantive',
  memories: [], traits: [], rules: [], tensions: [], followup_seeds: [], contradiction_resolution: null, note: '',
});

describe('sanitizeExtraction', () => {
  it('drops memories and rules whose quotes are fabricated', () => {
    const raw: AnswerExtractionT = {
      ...base,
      memories: [{ summary: 'Quit consulting in 2023', full_context: '', importance: 0.8, emotional_significance: 0.5, people_involved: [], date_or_period: '2023', quotes: ['I definitely never said this sentence'] }],
      rules: [{ situation: 'career feels stale', condition: null, tendency: 'changes path', exception_to_key: null, tier: 'inferred', category: 'work', quotes: ['made-up quote'] }],
    };
    const { out, dropped } = sanitizeExtraction(raw, ANSWER);
    expect(out.memories).toHaveLength(0);
    expect(out.rules).toHaveLength(0);
    expect(dropped).toBe(2);
  });
  it('keeps items whose quotes match verbatim (whitespace-normalized)', () => {
    const raw: AnswerExtractionT = {
      ...base,
      memories: [{ summary: 'Quit consulting in 2023', full_context: '', importance: 0.8, emotional_significance: 0.5, people_involved: [], date_or_period: '2023', quotes: ['I quit  my consulting job in 2023'] }],
    };
    const { out, dropped } = sanitizeExtraction(raw, ANSWER);
    expect(out.memories).toHaveLength(1);
    expect(dropped).toBe(0);
  });
  it('demotes an unquoted explicit/inferred trait to hypothesis and clamps confidence', () => {
    const raw: AnswerExtractionT = {
      ...base,
      traits: [
        { kind: 'value', key: 'building_over_advising', label: 'Builder at heart', statement: 'Prefers making things to advising on them.', category: 'work', tier: 'explicit', strength: 0.8, confidence: 0.95, quotes: ['fabricated'] },
        { kind: 'value', key: 'partner_support', label: 'Leans on partner', statement: 'Partner support matters in big calls.', category: 'relationships', tier: 'inferred', strength: 0.6, confidence: 0.8, quotes: ['My partner thought I was crazy but supported it.'] },
      ],
    };
    const { out, demoted } = sanitizeExtraction(raw, ANSWER);
    expect(out.traits[0]!.tier).toBe('hypothesis');
    expect(out.traits[0]!.confidence).toBeLessThanOrEqual(0.6);
    expect(out.traits[0]!.quotes).toHaveLength(0);
    expect(out.traits[1]!.tier).toBe('inferred');
    expect(out.traits[1]!.confidence).toBeLessThanOrEqual(0.85);
    expect(demoted).toBe(1);
  });
  it('drops followup seeds pointing at unknown facets', () => {
    const raw: AnswerExtractionT = {
      ...base,
      followup_seeds: [
        { category: 'work', facet: 'motivation', question: 'Tell me about a time work felt effortless.', hook_strength: 0.5 },
        { category: 'work', facet: 'not_a_real_facet', question: 'Bogus?', hook_strength: 0.5 },
      ],
    };
    const { out } = sanitizeExtraction(raw, ANSWER);
    expect(out.followup_seeds).toHaveLength(1);
    expect(out.followup_seeds[0]!.facet).toBe('motivation');
  });
  it('schema itself refuses malformed model output', () => {
    expect(() => AnswerExtraction.parse({ quality: 'amazing' })).toThrow();
    expect(() => AnswerExtraction.parse({ ...base, traits: [{ kind: 'vibe', key: 'x', label: 'x', statement: 'long enough statement', category: 'work', tier: 'explicit', strength: 0.5, confidence: 0.5, quotes: ['quote here'] }] })).toThrow();
  });
});

describe('reinforceConfidence', () => {
  it('rises monotonically but never past the tier cap', () => {
    let c = 0.5;
    for (let i = 0; i < 20; i++) c = reinforceConfidence(c, 0.8, 'inferred');
    expect(c).toBeLessThanOrEqual(0.85);
    expect(reinforceConfidence(0.5, 0.8, 'inferred')).toBeGreaterThan(0.5);
    expect(reinforceConfidence(0.59, 0.9, 'hypothesis')).toBeLessThanOrEqual(0.6);
  });
});

// ── escalation gate (McAdams pacing: low-stakes first, heavy after trust) ────
describe('escalation gate', () => {
  const coldState = (answeredInIdentity = 0): PickerState => {
    const s = state();
    for (const c of INTERVIEW_CATEGORIES) {
      s.coverage[c] = { ...s.coverage[c], coverage: 0, answered: 0, justStarted: true,
        facets: Object.fromEntries(CATEGORY_FACETS[c].map((f) => [f, 0])) };
    }
    s.coverage.identity = { ...s.coverage.identity, answered: answeredInIdentity };
    return s;
  };
  const heavy: Candidate = { ...bankC('ethics', 'dilemmas'), intensity: 'high' };
  const mid: Candidate = { ...bankC('values', 'named_values'), intensity: 'medium' };
  const light: Candidate = { ...bankC('emotional', 'joy'), intensity: 'low' };

  it('a brand-new interview opens low-stakes — never with heavy disclosure', () => {
    expect(pickNext([heavy, mid, light], coldState(0))?.bankKey).toBe(light.bankKey);
  });
  it('medium unlocks after 2 answers; high stays gated', () => {
    expect(pickNext([heavy, mid], coldState(3))?.bankKey).toBe(mid.bankKey);
  });
  it('high-intensity competes normally once 10 answers are in', () => {
    const s = state(); // 50 answered; give ethics the biggest coverage gap
    s.coverage.ethics = { ...s.coverage.ethics, coverage: 0,
      facets: Object.fromEntries(CATEGORY_FACETS.ethics.map((f) => [f, 0])) };
    expect(pickNext([heavy, light], s)?.bankKey).toBe(heavy.bankKey);
  });
  it('never stalls: if only gated questions remain, the gate opens', () => {
    expect(pickNext([heavy], coldState(0))?.bankKey).toBe(heavy.bankKey);
  });
  it('follow-ups and contradiction probes are never gated', () => {
    const probe: Candidate = { id: 'c1', category: 'ethics', facet: null, kind: 'contradiction', priority: 0, text: 'What makes those different?' };
    expect(pickNext([probe, light], coldState(0))?.id).toBe('c1');
  });
});

// ── thread rules: the "keeps asking about the same thing" contract ──────────
describe('thread rules (no circling)', () => {
  const parent = 'a-parent';
  const follow: Candidate = { id: 'f1', category: 'work', facet: 'ambition', kind: 'follow_up', priority: 0.9, parentAnswerId: parent,
    text: 'Since that early win, have you sought out lead roles again?' };
  const probe: Candidate = { id: 'c1', category: 'work', facet: 'ambition', kind: 'contradiction', priority: 0, parentAnswerId: parent,
    text: 'What was different about the deployment that let you push through?' };
  const other = bankC('money', 'saving', 'How do you handle money you do not immediately need?');
  const turns = (n: number) => [...Array(n).keys()].map((i) => `later-${i}`);

  it('questionOverlap: a rephrase scores high, a different question low', () => {
    expect(questionOverlap(
      'Tell me about a time two things you care about pulled in opposite directions. Which won, and why?',
      'Tell me about a specific time you actually had to choose family over a work obligation.',
    )).toBeLessThan(0.5);
    expect(questionOverlap(
      'Tell me about the last specific time you froze under pressure with no time to research.',
      'After one of those times you froze under pressure, what did you do differently to prepare?',
    )).toBeGreaterThanOrEqual(0.5);
    expect(questionOverlap('How far ahead do you really plan?', 'When is a lie acceptable to you?')).toBe(0);
  });

  it('a follow-up is NOT served right after the answer it grew from', () => {
    const s = state({ recentAnswerIds: [parent] });
    expect(threadEligible(follow, s)).toBe(false);
    expect(pickNext([follow, other], s)?.id).toBeUndefined(); // the bank question wins
  });

  it('…nor after one more turn, but it is once the cooldown has passed', () => {
    expect(threadEligible(follow, state({ recentAnswerIds: [...turns(FOLLOW_UP_COOLDOWN - 1), parent] }))).toBe(false);
    const cooled = state({ recentAnswerIds: [...turns(FOLLOW_UP_COOLDOWN), parent] });
    expect(threadEligible(follow, cooled)).toBe(true);
    expect(pickNext([follow, other], cooled)?.id).toBe('f1'); // strong hook now beats the bank
  });

  it('a stale follow-up (parent scrolled out of the window) is never served', () => {
    expect(threadEligible(follow, state({ recentAnswerIds: [...turns(FOLLOW_UP_MAX_AGE), parent] }))).toBe(false);
    expect(threadEligible(follow, state({ recentAnswerIds: turns(3) }))).toBe(false); // parent unknown ⇒ not recent
  });

  it('a contradiction probe waits one turn, then outranks everything', () => {
    expect(threadEligible(probe, state({ recentAnswerIds: [parent] }))).toBe(false);
    const s = state({ recentAnswerIds: ['later-0', parent] });
    expect(threadEligible(probe, s)).toBe(true);
    expect(pickNext([probe, other, follow], s)?.id).toBe('c1');
  });

  it('a candidate that rephrases a question just asked is dropped', () => {
    const asked = 'Tell me about the last specific time you froze under pressure with no time to research.';
    const rephrase = bankC('decision_making', 'pressure', 'After one of those times you froze under pressure, what did you do differently to prepare?');
    const s = state({ recentQuestionTexts: [asked] });
    expect(circles(rephrase, s)).toBe(true);
    expect(circles(other, s)).toBe(false);
    expect(pickNext([rephrase, other], s)?.facet).toBe('saving');
  });

  it('never stalls: when every candidate is on cooldown, one is still served', () => {
    expect(pickNext([follow], state({ recentAnswerIds: [parent] }))?.id).toBe('f1');
  });

  it('legacy behavioural candidates ignore thread rules entirely', () => {
    expect(threadEligible(other, state({ recentAnswerIds: [parent] }))).toBe(true);
  });
});
