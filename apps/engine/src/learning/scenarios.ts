/**
 * Blind prediction tests — the honesty loop the whole product bends toward:
 * can the model actually predict this person?
 *
 * The prediction is generated AT CREATION and sealed: `predicted_at <
 * answered_at` is a stored invariant, so the model can never peek at the
 * human's answer (and the human can prove it never did). Every code path that
 * serves OPEN scenarios goes through OPEN_COLUMNS — the prediction is
 * structurally absent, not UI-hidden. Answering is one conditional UPDATE
 * (status='open' → 'answered'), so a double-submit races safely. The judge
 * runs after the answer is committed; a judge crash leaves 'failed' (human
 * answer intact, retryable), never an unanswered-looking scenario.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { and, desc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import { db, predictionScenarios, personaSnapshots, reasoningPatterns, traits, contradictions } from '@opersona/db';
import { structuredCall } from '../llm.js';
import { orgModelConfig } from '../keys.js';
import { activePrompt } from '../persona/assemble.js';
import { DIMENSIONS } from './extractReasoning.js';

export const SCENARIO_CATEGORIES = ['career', 'conflict', 'purchase', 'time', 'communication', 'risk', 'relationships', 'ethics', 'planning', 'other'] as const;

// ── schemas ──────────────────────────────────────────────────────────────────
const GeneratedScenarios = z.object({
  scenarios: z.array(z.object({
    category: z.enum(SCENARIO_CATEGORIES),
    format: z.enum(['open', 'choice']),
    choices: z.array(z.string().max(200)).max(4).default([]).describe('2-4 labelled options for choice format; empty for open'),
    scenario: z.string().min(40).max(700).describe('the situation, second person, 2-5 sentences, concrete stakes, no right answer'),
    question: z.string().min(5).max(200).describe('"What do you do?" variant'),
    target_note: z.string().max(200).describe('plain words: which weak/uncertain area this probes'),
  })).min(1).max(5),
});

export const Prediction = z.object({
  decision: z.string().min(5).max(600).describe("what they'd actually do — concrete, first person as them"),
  factors: z.array(z.string().max(160)).min(1).max(5).describe('the reasons, ranked, THEIR reasons'),
  communication: z.string().max(300).describe("how they'd say or handle it with the people involved"),
  confidence: z.number().min(0).max(1).describe('honestly: how sure the model is this matches the real person'),
});

const DimScore = z.object({ score: z.number().min(0).max(1), rationale: z.string().max(300) });
export const ScenarioJudge = z.object({
  decision_match: DimScore.describe('did they land on the same choice/action'),
  reasoning_factor_match: DimScore.describe('same reasons, same ranking of what matters'),
  preference_match: DimScore.describe('same underlying values/preferences expressed'),
  communication_match: DimScore.describe('same tone/directness/way of handling the people'),
  key_differences: z.array(z.string().max(200)).max(5),
  summary: z.string().max(400),
});

/** Overall = weighted mean; calibration is computed in code (deterministic, un-gameable). */
export const JUDGE_WEIGHTS = { decision: 0.35, reasoning: 0.3, preference: 0.15, communication: 0.1, calibration: 0.1 } as const;
export const MIN_SAMPLE = 5;

export const calibrationScore = (predictionConfidence: number, decisionScore: number): number =>
  1 - Math.abs(predictionConfidence - decisionScore);

/** A dimension with nothing to judge is NOT scored (null) rather than scored
 *  badly — the same "Not enough data yet" discipline used everywhere else.
 *  Scoring someone's "reasoning factors" when they never stated any reasons
 *  measured our own prompt, not them. */
export function scoreableDims(answer: string, factors: string | null | undefined): { reasoning: boolean; communication: boolean } {
  const a = (answer ?? '').trim();
  return {
    reasoning: (factors ?? '').trim().length >= 10 || a.length >= 200,
    communication: a.length >= 120,
  };
}

/** Which option a text picked, by leading letter or by quoting the option. */
function optionIndex(choices: string[], text: string): number | null {
  const t = (text ?? '').trim().toLowerCase();
  if (!t || !choices.length) return null;
  const letter = /^\(?([a-e])[.):\s]/.exec(t)?.[1];
  if (letter) {
    const i = letter.charCodeAt(0) - 97;
    if (i >= 0 && i < choices.length) return i;
  }
  let hit: number | null = null;
  choices.forEach((c, i) => { const cc = c.trim().toLowerCase(); if (cc.length >= 8 && t.includes(cc)) hit = i; });
  return hit;
}

/** Choice scenarios score the DECISION in code: same option or not. No LLM
 *  opinion, no partial credit for eloquence — un-gameable, like calibration. */
export function choiceDecisionMatch(choices: string[], answer: string, predicted: string): number | null {
  if (!choices.length) return null;
  const a = optionIndex(choices, answer);
  const p = optionIndex(choices, predicted);
  return a != null && p != null ? (a === p ? 1 : 0) : null;
}

/** Weighted mean over the dimensions that COULD be scored (weights renormalized). */
export function overallScore(s: { decision: number | null; reasoning: number | null; preference: number | null; communication: number | null; calibration: number | null }): number {
  let sum = 0, w = 0;
  for (const [k, weight] of Object.entries(JUDGE_WEIGHTS) as [keyof typeof JUDGE_WEIGHTS, number][]) {
    const v = s[k];
    if (v == null) continue;
    sum += weight * v; w += weight;
  }
  return w > 0 ? sum / w : 0;
}

// ── the blind-view discipline ────────────────────────────────────────────────
/** The ONLY select served for status='open' rows — prediction/scores structurally absent. */
export const OPEN_COLUMNS = {
  id: predictionScenarios.id,
  batchId: predictionScenarios.batchId,
  category: predictionScenarios.category,
  format: predictionScenarios.format,
  choices: predictionScenarios.choices,
  scenario: predictionScenarios.scenario,
  question: predictionScenarios.question,
  createdAt: predictionScenarios.createdAt,
} as const;

const GEN_SYSTEM = `You create BLIND prediction tests for an AI behavioural model of one specific person. Each scenario is shown to the person AND (separately) answered by the model; the comparison measures how well the model knows them.

Rules for good scenarios:
- Second person, concrete stakes, 2-5 sentences, decidable without special knowledge. Mix personal and professional life.
- There must be NO right answer — only a revealing one. Room for a decision, a reason, and a way of handling people.
- TARGET the weak spots you were given: uncertain traits, open tensions, thin dimensions, low-scoring past categories. target_note says which, in plain words.
- Never re-test a situation the evidence shows they already faced and resolved — invent adjacent, fresh situations.
- Avoid the categories listed as recently used.
- PREFER the choice format: most scenarios should offer 3-4 genuinely defensible options, each attractive to a different kind of person, none obviously "right". Choice scenarios are answerable in one tap and let the decision be compared exactly. Leave at most one scenario per batch open-ended, for something a menu would flatten.`;

/** Weak/uncertain areas the generator should aim at. */
export async function uncertainAreas(cloneId: string): Promise<string[]> {
  const out: string[] = [];
  const weakTraits = await db.select({ label: traits.label, tier: traits.tier, confidence: traits.confidence }).from(traits)
    .where(and(eq(traits.cloneId, cloneId), inArray(traits.status, ['candidate', 'confirmed']), sql`(${traits.tier} = 'hypothesis' or ${traits.confidence} < 0.6)`))
    .orderBy(traits.confidence).limit(6);
  for (const t of weakTraits) out.push(`uncertain trait: ${t.label} (${t.tier}, conf ${t.confidence.toFixed(2)})`);
  const openContra = await db.select({ description: contradictions.description }).from(contradictions)
    .where(and(eq(contradictions.cloneId, cloneId), inArray(contradictions.status, ['open', 'probed']))).limit(4);
  for (const c of openContra) out.push(`open tension: ${c.description}`);
  const dims = await db.select({ dimension: reasoningPatterns.dimension, n: sql<number>`count(*)::int` }).from(reasoningPatterns)
    .where(and(eq(reasoningPatterns.cloneId, cloneId), ne(reasoningPatterns.status, 'rejected')))
    .groupBy(reasoningPatterns.dimension);
  const covered = new Set(dims.filter((d) => d.n > 0).map((d) => d.dimension));
  for (const d of DIMENSIONS) if (d !== 'other' && !covered.has(d)) out.push(`no evidence yet on the '${d}' dimension of their reasoning`);
  return out.slice(0, 10);
}

// ── generation (prediction sealed at birth) ──────────────────────────────────
export async function createScenarioBatch(orgId: string, cloneId: string, count = 3): Promise<{ batchId: string; created: number }> {
  const cfg = await orgModelConfig(orgId);
  const recent = await db.select({ category: predictionScenarios.category, scoreOverall: predictionScenarios.scoreOverall })
    .from(predictionScenarios).where(eq(predictionScenarios.cloneId, cloneId))
    .orderBy(desc(predictionScenarios.createdAt)).limit(12);
  const avoid = [...new Set(recent.map((r) => r.category))];
  const weak = recent.filter((r) => r.scoreOverall != null && r.scoreOverall < 0.6).map((r) => r.category);
  const targets = await uncertainAreas(cloneId);

  const gen = await structuredCall({
    orgId, cloneId, kind: 'scenario-gen', apiKey: cfg.apiKey, model: cfg.extractModel, effort: 'medium',
    schema: GeneratedScenarios, system: GEN_SYSTEM,
    user: [
      `Create ${Math.min(5, Math.max(1, count))} scenarios.`,
      targets.length ? `WEAK SPOTS to target:\n${targets.map((t) => `- ${t}`).join('\n')}` : 'WEAK SPOTS: (none known — cover varied ground)',
      avoid.length ? `RECENTLY USED categories to avoid: ${avoid.join(', ')}` : '',
      weak.length ? `Categories where the model recently predicted POORLY (worth revisiting with a fresh situation): ${[...new Set(weak)].join(', ')}` : '',
    ].filter(Boolean).join('\n\n'),
  });

  const { prompt } = await activePrompt(orgId, cloneId);
  const [snap] = await db.select({ version: personaSnapshots.version }).from(personaSnapshots)
    .where(eq(personaSnapshots.cloneId, cloneId)).orderBy(desc(personaSnapshots.version)).limit(1);
  const batchId = randomUUID();
  let created = 0;
  for (const s of gen.scenarios.slice(0, count)) {
    // The blind prediction, sealed at creation.
    const prediction = await structuredCall({
      orgId, cloneId, kind: 'scenario-predict', apiKey: cfg.apiKey, model: cfg.chatModel, effort: 'medium',
      schema: Prediction,
      system: prompt + '\n\nYou are being tested: predict how the person you model would ACTUALLY respond to the scenario. Predict behaviour, never invent memories; base every factor on the evidence in your persona. Be honest in confidence — a calibrated 0.5 beats a swaggering 0.9.',
      user: `SCENARIO:\n${s.scenario}\n\n${s.question}${s.choices.length ? `\nOptions:\n${s.choices.map((c, i) => `${String.fromCharCode(65 + i)}. ${c}`).join('\n')}` : ''}`,
    });
    await db.insert(predictionScenarios).values({
      orgId, cloneId, batchId, category: s.category, format: s.format, choices: s.choices,
      scenario: s.scenario, question: s.question, targetNote: s.target_note,
      targetRefs: [], snapshotVersion: snap?.version ?? null, model: cfg.chatModel,
      aiPrediction: prediction, predictedAt: new Date(),
    });
    created++;
  }
  return { batchId, created };
}

// ── views ────────────────────────────────────────────────────────────────────
export async function openScenarios(cloneId: string) {
  return db.select(OPEN_COLUMNS).from(predictionScenarios)
    .where(and(eq(predictionScenarios.cloneId, cloneId), eq(predictionScenarios.status, 'open')))
    .orderBy(predictionScenarios.createdAt);
}

export async function historyScenarios(cloneId: string, limit = 50) {
  return db.select().from(predictionScenarios)
    .where(and(eq(predictionScenarios.cloneId, cloneId), ne(predictionScenarios.status, 'open')))
    .orderBy(desc(predictionScenarios.answeredAt)).limit(limit);
}

// ── answer (atomic) + judge ──────────────────────────────────────────────────
const JUDGE_SYSTEM = `You judge how closely an AI model's BLIND prediction matched a real person's actual answer to the same scenario. Score each dimension 0..1 with a short rationale:
- decision_match: same choice/action? 1 = same decision; 0.5 = same direction, different execution; 0 = different decision.
- reasoning_factor_match: same reasons, similarly ranked? Partial credit for overlapping factors in different order.
- preference_match: same underlying values/preferences showing through?
- communication_match: same tone, directness, way of handling the people involved?
Judge ONLY from the texts given. No benefit of the doubt on reasoning: a right decision for wrong reasons scores low on reasoning_factor_match. Different words for behaviourally equivalent answers score HIGH — you compare behaviour, not phrasing.`;

export async function answerScenario(a: {
  orgId: string; cloneId: string; id: string; answer: string; factors?: string;
}): Promise<{ ok: true; scenario: typeof predictionScenarios.$inferSelect } | { ok: false; status: number; error: string }> {
  // One conditional UPDATE = the whole blind gate: only an OPEN row accepts an answer.
  const res = await db.update(predictionScenarios)
    .set({ status: 'answered', humanAnswer: a.answer, humanFactors: a.factors ?? null, answeredAt: new Date() })
    .where(and(eq(predictionScenarios.id, a.id), eq(predictionScenarios.cloneId, a.cloneId), eq(predictionScenarios.orgId, a.orgId), eq(predictionScenarios.status, 'open')))
    .returning();
  const row = res[0];
  if (!row) return { ok: false, status: 409, error: 'already answered (or not an open scenario)' };

  await judgeScenarioRow(a.orgId, row);
  const [final] = await db.select().from(predictionScenarios).where(eq(predictionScenarios.id, row.id)).limit(1);
  return { ok: true, scenario: final! };
}

/** Judge one answered/failed row (human answer committed). Returns true when
 *  scored; on any failure the row is left 'failed' — safe, retryable, and
 *  retried automatically whenever the org's rail comes back. */
export async function judgeScenarioRow(orgId: string, row: typeof predictionScenarios.$inferSelect): Promise<boolean> {
  try {
    const cfg = await orgModelConfig(orgId);
    const pred = row.aiPrediction!;
    const answer = row.humanAnswer ?? '';
    const factors = row.humanFactors;
    const judged = await structuredCall({
      orgId, cloneId: row.cloneId, kind: 'scenario-judge', apiKey: cfg.apiKey, model: cfg.extractModel, effort: 'medium',
      schema: ScenarioJudge, system: JUDGE_SYSTEM,
      user: `SCENARIO:\n${row.scenario}\n${row.question}${row.choices.length ? `\nOptions: ${row.choices.join(' | ')}` : ''}\n\nPERSON'S ANSWER:\n${answer}${factors ? `\nTheir stated reasons: ${factors}` : ''}\n\nMODEL'S BLIND PREDICTION (made ${row.predictedAt ? 'before the person answered' : ''}):\nDecision: ${pred.decision}\nFactors: ${pred.factors.join('; ')}\nCommunication: ${pred.communication}`,
    });
    const dims = scoreableDims(answer, factors);
    const exact = choiceDecisionMatch(row.choices, answer, pred.decision);
    const decision = exact ?? judged.decision_match.score;
    const scores = {
      decision,
      reasoning: dims.reasoning ? judged.reasoning_factor_match.score : null,
      preference: judged.preference_match.score,
      communication: dims.communication ? judged.communication_match.score : null,
      calibration: calibrationScore(pred.confidence, decision),
    };
    await db.update(predictionScenarios).set({
      status: 'scored',
      judge: {
        rationale: {
          decision: judged.decision_match.rationale, reasoning: judged.reasoning_factor_match.rationale,
          preference: judged.preference_match.rationale, communication: judged.communication_match.rationale,
        },
        key_differences: judged.key_differences, summary: judged.summary,
      },
      scoreDecision: scores.decision, scoreReasoning: scores.reasoning, scorePreference: scores.preference,
      scoreCommunication: scores.communication, scoreCalibration: scores.calibration, scoreOverall: overallScore(scores),
      judgeModel: cfg.extractModel, judgedAt: new Date(),
    }).where(eq(predictionScenarios.id, row.id));
    return true;
  } catch (e) {
    await db.update(predictionScenarios).set({ status: 'failed' }).where(eq(predictionScenarios.id, row.id)).catch(() => {});
    console.error('[scenarios] judge failed', row.id, e instanceof Error ? e.message : e);
    return false;
  }
}

/** Re-run judges for scenarios that failed while no rail was reachable. */
export async function rejudgeFailedScenarios(orgId: string): Promise<number> {
  const rows = await db.select().from(predictionScenarios)
    .where(and(eq(predictionScenarios.orgId, orgId), eq(predictionScenarios.status, 'failed'), isNotNull(predictionScenarios.humanAnswer)));
  let n = 0;
  for (const r of rows) if (await judgeScenarioRow(orgId, r)) n++;
  if (rows.length) console.log(`[scenarios] rejudged ${n}/${rows.length} for org=${orgId}`);
  return n;
}

export async function skipScenario(orgId: string, cloneId: string, id: string): Promise<boolean> {
  const res = await db.update(predictionScenarios).set({ status: 'skipped' })
    .where(and(eq(predictionScenarios.id, id), eq(predictionScenarios.cloneId, cloneId), eq(predictionScenarios.orgId, orgId), eq(predictionScenarios.status, 'open')))
    .returning({ id: predictionScenarios.id });
  return !!res[0];
}

// ── aggregation ──────────────────────────────────────────────────────────────
export interface Similarity {
  scored: number;
  minSample: number;
  perDimension: Record<'decision' | 'reasoning' | 'preference' | 'communication' | 'calibration', { n: number; avg: number | null }>;
  overall: number | null;
  last10: number[];
  note: 'internal-model-metric';
}

export async function similarity(cloneId: string): Promise<Similarity> {
  const rows = await db.select({
    d: predictionScenarios.scoreDecision, r: predictionScenarios.scoreReasoning, p: predictionScenarios.scorePreference,
    c: predictionScenarios.scoreCommunication, k: predictionScenarios.scoreCalibration, o: predictionScenarios.scoreOverall,
  }).from(predictionScenarios)
    .where(and(eq(predictionScenarios.cloneId, cloneId), eq(predictionScenarios.status, 'scored')))
    .orderBy(desc(predictionScenarios.judgedAt));
  const avg = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x != null);
    return { n: v.length, avg: v.length ? v.reduce((s, x) => s + x, 0) / v.length : null };
  };
  const scored = rows.length;
  return {
    scored,
    minSample: MIN_SAMPLE,
    perDimension: {
      decision: avg(rows.map((x) => x.d)), reasoning: avg(rows.map((x) => x.r)), preference: avg(rows.map((x) => x.p)),
      communication: avg(rows.map((x) => x.c)), calibration: avg(rows.map((x) => x.k)),
    },
    overall: scored >= MIN_SAMPLE ? avg(rows.map((x) => x.o)).avg : null,
    last10: rows.slice(0, 10).map((x) => x.o ?? 0).reverse(),
    note: 'internal-model-metric',
  };
}
