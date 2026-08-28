/**
 * "What did I get wrong?" — the correction loop that makes a missed prediction
 * worth more than a hit. The person tags the failure kind(s) and explains; one
 * extraction turns that into (a) reasoning counter-observations exactly like
 * chat feedback, and (b) knowledge proposals (trait / memory / rule / fact)
 * that land as CANDIDATES with the person's own words as evidence. Everything
 * is audit-trailed, then the fingerprint recomputes and the prompt republishes.
 */
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import {
  db, predictionScenarios, corrections, reasoningObservations, learningEvents, traits, memories, contextualRules, facts,
  type Evidence,
} from '@opersona/db';
import { INTERVIEW_CATEGORIES, TRAIT_KINDS } from '@opersona/shared';
import { structuredCall } from '../llm.js';
import { orgModelConfig } from '../keys.js';
import { DIMENSIONS } from './extractReasoning.js';
import { enqueue } from './queue.js';

export const CORRECTION_KINDS = ['wrong_decision', 'wrong_reasoning', 'missing_context', 'exception', 'outdated_belief', 'misunderstood_preference', 'other'] as const;
export type CorrectionKind = (typeof CORRECTION_KINDS)[number];

/** Map the user-facing kinds onto the corrections table's vocabulary. */
const KIND_MAP: Record<CorrectionKind, 'factual' | 'procedural' | 'stylistic' | 'scope' | 'one_off'> = {
  wrong_decision: 'procedural', wrong_reasoning: 'procedural', missing_context: 'factual',
  outdated_belief: 'factual', misunderstood_preference: 'stylistic', exception: 'scope', other: 'one_off',
};

const CorrectionExtraction = z.object({
  observations: z.array(z.object({
    pattern_key: z.string().regex(/^[a-z0-9_]+$/).max(48),
    dimension: z.enum(DIMENSIONS),
    description: z.string().min(10).max(220),
    polarity: z.enum(['is_me', 'not_me']),
    evidence: z.array(z.string().min(5).max(300)).min(1).max(2).describe("verbatim quotes from the PERSON's answer/explanation only"),
  })).max(4).default([]),
  proposals: z.array(z.object({
    layer: z.enum(['fact', 'trait', 'memory', 'rule']),
    kind: z.enum(TRAIT_KINDS).nullable().default(null).describe('for layer=trait only'),
    key: z.string().regex(/^[a-z0-9_]*$/).max(48).default('').describe('snake_case id for layer=trait'),
    label: z.string().max(60).default(''),
    statement: z.string().min(10).max(300),
    situation: z.string().max(160).default('').describe('for layer=rule: the IF'),
    condition: z.string().max(160).nullable().default(null),
    tendency: z.string().max(160).default('').describe('for layer=rule: the THEN'),
    category: z.enum(INTERVIEW_CATEGORIES).nullable().default(null),
    evidence: z.array(z.string().min(5).max(300)).min(1).max(2),
  })).max(3).default([]),
  lesson: z.string().min(10).max(220),
});

const SYSTEM = `A person is correcting an AI behavioural model of themselves. The model predicted their response to a scenario; the person answered differently and explained what the model got wrong. Extract:
- observations: domain-free reasoning moves — not_me for what the model wrongly assumed, is_me for how the person says they ACTUALLY think. Evidence = verbatim quotes from the person's own answer/explanation, never from the model's prediction.
- proposals: at most 3 durable knowledge items the correction reveals — a trait (value/belief/preference/behaviour/decision_pattern with a snake_case key), a rule (IF situation AND condition THEN tendency — the usual shape when the person says "it depends"), a memory (a real event they mentioned), or a fact. These land as CANDIDATES the person reviews.
- lesson: one sentence the model should carry forward.
Never invent; when the explanation is thin, fewer items.`;

export async function correctScenario(a: {
  orgId: string; cloneId: string; scenarioId: string; userId: string; kinds: CorrectionKind[]; note: string;
}): Promise<{ ok: boolean; observations: number; proposals: number; error?: string }> {
  const [row] = await db.select().from(predictionScenarios)
    .where(and(eq(predictionScenarios.id, a.scenarioId), eq(predictionScenarios.cloneId, a.cloneId), eq(predictionScenarios.orgId, a.orgId))).limit(1);
  if (!row) return { ok: false, observations: 0, proposals: 0, error: 'scenario not found' };
  if (row.status !== 'scored' && row.status !== 'failed') return { ok: false, observations: 0, proposals: 0, error: 'answer the scenario first' };
  if (row.correctionId) return { ok: false, observations: 0, proposals: 0, error: 'already corrected' };

  const cfg = await orgModelConfig(a.orgId);
  const pred = row.aiPrediction!;
  const out = await structuredCall({
    orgId: a.orgId, cloneId: a.cloneId, kind: 'scenario-correct', apiKey: cfg.apiKey, model: cfg.extractModel, effort: 'medium',
    schema: CorrectionExtraction, system: SYSTEM,
    user: `SCENARIO:\n${row.scenario}\n${row.question}\n\nMODEL PREDICTED:\n${pred.decision}\nFactors: ${pred.factors.join('; ')}\n\nPERSON ACTUALLY ANSWERED:\n${row.humanAnswer}${row.humanFactors ? `\nTheir reasons: ${row.humanFactors}` : ''}\n\nWHAT THEY SAY WENT WRONG (${a.kinds.join(', ')}):\n${a.note}`,
  });

  const ref = `scenario:${a.scenarioId}`;
  const ev = (quotes: string[]): Evidence[] => quotes.map((quote) => ({ quote, ref }));
  let proposals = 0;

  const correctionId = await db.transaction(async (tx) => {
    const [corr] = await tx.insert(corrections).values({
      orgId: a.orgId, cloneId: a.cloneId,
      cloneOutput: `${pred.decision}\nFactors: ${pred.factors.join('; ')}`.slice(0, 2000),
      humanFix: `${row.humanAnswer}\n---\n${a.note}`.slice(0, 2000),
      kind: KIND_MAP[a.kinds[0] ?? 'other'],
      severity: 'low', lesson: out.lesson,
      scope: { domain: 'scenario', task_type: a.kinds.join('+') },
      sourceKind: 'correction', sourceRef: ref, createdBy: a.userId,
      status: 'confirmed', confidence: 0.8, evidence: ev([a.note.slice(0, 300)]),
      applied: [], standing: false,
    }).returning({ id: corrections.id });

    if (out.observations.length) {
      await tx.insert(reasoningObservations).values(out.observations.map((o) => ({
        orgId: a.orgId, cloneId: a.cloneId, patternKey: o.pattern_key, dimension: o.dimension, description: o.description,
        evidence: o.evidence.map((quote) => ({ quote })), weight: o.polarity === 'is_me' ? 1.5 : 1.0,
        sourceKind: 'feedback' as const, sourceRef: ref,
      })));
    }

    for (const p of out.proposals) {
      if (p.layer === 'trait' && p.kind && p.key) {
        const [dupe] = await tx.select({ id: traits.id }).from(traits)
          .where(and(eq(traits.cloneId, a.cloneId), eq(traits.kind, p.kind), eq(traits.key, p.key))).limit(1);
        if (dupe) continue; // the interview pipeline owns reinforcement; a correction never silently rewrites
        const [ins] = await tx.insert(traits).values({
          orgId: a.orgId, cloneId: a.cloneId, status: 'candidate', confidence: 0.7,
          sourceKind: 'correction', sourceRef: ref, evidence: ev(p.evidence), createdBy: a.userId,
          kind: p.kind, key: p.key, label: p.label || p.key.replace(/_/g, ' '), statement: p.statement,
          category: p.category, tier: 'explicit', strength: 0.6, validFrom: new Date(),
        }).returning({ id: traits.id });
        await tx.insert(learningEvents).values({ orgId: a.orgId, cloneId: a.cloneId, layer: 'trait', targetId: ins!.id, action: 'created', summary: `correction → ${p.statement}`, sourceKind: 'correction', sourceRef: ref, reviewStatus: 'pending' });
        proposals++;
      } else if (p.layer === 'rule' && p.situation && p.tendency) {
        const [ins] = await tx.insert(contextualRules).values({
          orgId: a.orgId, cloneId: a.cloneId, status: 'candidate', confidence: 0.7,
          sourceKind: 'correction', sourceRef: ref, evidence: ev(p.evidence), createdBy: a.userId,
          category: p.category, situation: p.situation, condition: p.condition, tendency: p.tendency,
          tier: 'explicit', validFrom: new Date(),
        }).returning({ id: contextualRules.id });
        await tx.insert(learningEvents).values({ orgId: a.orgId, cloneId: a.cloneId, layer: 'rule', targetId: ins!.id, action: 'created', summary: `correction → IF ${p.situation} THEN ${p.tendency}`, sourceKind: 'correction', sourceRef: ref, reviewStatus: 'pending' });
        proposals++;
      } else if (p.layer === 'memory') {
        const [ins] = await tx.insert(memories).values({
          orgId: a.orgId, cloneId: a.cloneId, status: 'candidate', confidence: 0.7,
          sourceKind: 'correction', sourceRef: ref, evidence: ev(p.evidence), createdBy: a.userId,
          summary: p.statement.slice(0, 200), fullContext: '', importance: 0.5, emotionalSignificance: 0,
          peopleInvolved: [], category: p.category,
        }).returning({ id: memories.id });
        await tx.insert(learningEvents).values({ orgId: a.orgId, cloneId: a.cloneId, layer: 'memory', targetId: ins!.id, action: 'created', summary: `correction → ${p.statement.slice(0, 120)}`, sourceKind: 'correction', sourceRef: ref, reviewStatus: 'pending' });
        proposals++;
      } else if (p.layer === 'fact') {
        const [ins] = await tx.insert(facts).values({
          orgId: a.orgId, cloneId: a.cloneId, status: 'candidate', confidence: 0.7,
          sourceKind: 'correction', sourceRef: ref, evidence: ev(p.evidence), createdBy: a.userId,
          statement: p.statement, tags: [],
        }).returning({ id: facts.id });
        await tx.insert(learningEvents).values({ orgId: a.orgId, cloneId: a.cloneId, layer: 'fact', targetId: ins!.id, action: 'created', summary: `correction → ${p.statement.slice(0, 120)}`, sourceKind: 'correction', sourceRef: ref, reviewStatus: 'pending' });
        proposals++;
      }
    }

    await tx.update(predictionScenarios).set({ correctionId: corr!.id }).where(eq(predictionScenarios.id, a.scenarioId));
    return corr!.id;
  });
  void correctionId;

  // Fold the counter-observations into the fingerprint and republish the prompt.
  enqueue({ kind: 'refresh', orgId: a.orgId, cloneId: a.cloneId });
  return { ok: true, observations: out.observations.length, proposals };
}
