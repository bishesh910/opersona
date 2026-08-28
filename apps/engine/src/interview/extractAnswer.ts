/**
 * Interview-answer extraction — one answer in, structured knowledge out:
 * MEMORIES (what happened), TRAITS (values/beliefs/preferences/behaviours/
 * decision patterns), CONTEXTUAL RULES (IF/AND/THEN), plus TENSIONS against
 * what we already believe and fresh QUESTION SEEDS.
 *
 * Anti-hallucination is code-enforced, not prompt-hoped (`sanitizeExtraction`):
 * every quote must appear verbatim in the answer (whitespace-normalized);
 * an 'explicit' item without a surviving quote is demoted to 'inferred';
 * confidence is clamped per tier. A schema or rail failure marks the answer
 * extraction 'failed' and writes NOTHING (single transaction).
 */
import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import {
  db, interviewAnswers, interviewQuestions, traits, memories, contextualRules, contradictions, learningEvents,
  type Evidence,
} from '@opersona/db';
import { INTERVIEW_CATEGORIES, FOLLOWUP_INTENTS, TIER_CONFIDENCE_CAP, TRAIT_KINDS, redactSecrets } from '@opersona/shared';
import { structuredCall } from '../llm.js';
import { orgModelConfig } from '../keys.js';
import { knownDigest, storeCoverage } from './state.js';
import { CATEGORY_FACETS } from './bank.js';

export const AnswerExtraction = z.object({
  quality: z.enum(['substantive', 'thin', 'off_topic', 'refusal']),
  memories: z.array(z.object({
    summary: z.string().min(5).max(200),
    full_context: z.string().max(700).default(''),
    importance: z.number().min(0).max(1),
    emotional_significance: z.number().min(0).max(1),
    people_involved: z.array(z.string().max(60)).max(6).default([]),
    date_or_period: z.string().max(60).nullable().default(null),
    quotes: z.array(z.string().min(5).max(300)).min(1).max(2),
  })).max(3).default([]),
  traits: z.array(z.object({
    kind: z.enum(TRAIT_KINDS),
    key: z.string().regex(/^[a-z0-9_]+$/).max(48).describe('snake_case id — REUSE a key from KNOWN TRAITS when it is the same thing'),
    label: z.string().min(2).max(60),
    statement: z.string().min(10).max(240),
    category: z.enum(INTERVIEW_CATEGORIES),
    tier: z.enum(['explicit', 'inferred', 'hypothesis']),
    strength: z.number().min(0).max(1),
    confidence: z.number().min(0).max(1),
    quotes: z.array(z.string().min(5).max(300)).min(1).max(3),
  })).max(6).default([]),
  rules: z.array(z.object({
    situation: z.string().min(5).max(160),
    condition: z.string().max(160).nullable().default(null),
    tendency: z.string().min(5).max(160),
    exception_to_key: z.string().max(48).nullable().default(null),
    tier: z.enum(['explicit', 'inferred']),
    category: z.enum(INTERVIEW_CATEGORIES),
    quotes: z.array(z.string().min(5).max(300)).min(1).max(2),
  })).max(3).default([]),
  tensions: z.array(z.object({
    existing_key: z.string().max(48).describe('the KNOWN trait key this answer sits uneasily with'),
    description: z.string().min(10).max(240).describe('one neutral sentence naming both sides'),
    probe_question: z.string().min(10).max(240).describe('a curious, warm question about what makes the situations different — never a gotcha'),
  })).max(2).default([]),
  contradiction_resolution: z.object({ resolved: z.boolean(), note: z.string().max(200) }).nullable().default(null),
  followup_seeds: z.array(z.object({
    category: z.enum(INTERVIEW_CATEGORIES),
    facet: z.string().max(40),
    question: z.string().min(10).max(240),
  })).max(2).default([]),
  note: z.string().max(200).default(''),
});
export type AnswerExtractionT = z.infer<typeof AnswerExtraction>;

export const EXTRACT_ANSWER_SYSTEM = `You analyse ONE interview answer from a person building a behavioural model of themselves. Extract only what this answer actually supports.

Distinguish three kinds of knowledge:
- MEMORY: a thing that HAPPENED ("Moved cities in 2024 for a job"). Not a trait.
- TRAIT: a value / belief / preference / behaviour / decision pattern ("Willing to relocate when the career upside is large"). One sentence, present tense.
- RULE: conditional behaviour — IF situation (AND condition) THEN tendency. Use a rule when the answer shows behaviour that DEPENDS on circumstances; mark exception_to_key when it bends a KNOWN trait.

The epistemic tier is sacred:
- explicit: the person plainly said it, in so many words.
- inferred: the answer shows it without the person naming it.
- hypothesis: you suspect it; the evidence is thin. When unsure, choose the weaker tier.

Hard rules:
- Every quote must be VERBATIM from the answer. Never invent, trim-to-change, or paraphrase quotes.
- Never invent people, dates, or events. date_or_period is exactly what they said ("2024", "when I was a kid") or null.
- REUSE a key from KNOWN TRAITS when the answer reinforces the same thing — do not coin near-duplicates.
- TENSIONS: if the answer sits uneasily with a KNOWN trait, name it neutrally and write a curious probe question ("What makes those situations different for you?"). People are not inconsistent — they are contextual; the probe's job is to find the rule.
- Empty arrays are correct for thin answers. quality='refusal' when they declined; 'off_topic' when the answer is about something else.
- followup_seeds: at most 2 genuinely promising NEW questions this answer opens up (category + facet from the known facet list), phrased behaviourally ("Tell me about the last time…").
- Do not psychoanalyse. Model observable behaviour and stated positions, never private inner states.`;

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Code-level truth layer, pure:
 * - every quote must appear verbatim in the answer (whitespace-normalized);
 * - MEMORIES and RULES are factual claims — zero verified quotes ⇒ dropped;
 * - a TRAIT with zero verified quotes survives only demoted to 'hypothesis'
 *   (a hunch may stand on inference; fabricated evidence never stands at all);
 * - confidence is clamped to the tier's ceiling.
 */
export function sanitizeExtraction(raw: AnswerExtractionT, answerText: string): { out: AnswerExtractionT; dropped: number; demoted: number } {
  const hay = norm(answerText);
  const verified = (quotes: string[]) => quotes.filter((q) => hay.includes(norm(q)));
  let dropped = 0, demoted = 0;

  const memoriesOut = raw.memories.flatMap((m) => {
    const quotes = verified(m.quotes);
    if (!quotes.length) { dropped++; return []; }
    return [{ ...m, quotes }];
  });

  const traitsOut = raw.traits.map((t) => {
    const quotes = verified(t.quotes);
    let tier = t.tier;
    if (!quotes.length && tier !== 'hypothesis') { tier = 'hypothesis'; demoted++; }
    const confidence = Math.min(t.confidence, TIER_CONFIDENCE_CAP[tier]);
    return { ...t, tier, confidence, quotes };
  });

  const rulesOut = raw.rules.flatMap((r) => {
    const quotes = verified(r.quotes);
    if (!quotes.length) { dropped++; return []; }
    return [{ ...r, quotes }];
  });

  const seeds = raw.followup_seeds.filter((s) => (CATEGORY_FACETS[s.category] as readonly string[] | undefined)?.includes(s.facet));

  return { out: { ...raw, memories: memoriesOut, traits: traitsOut, rules: rulesOut, followup_seeds: seeds }, dropped, demoted };
}

/** Bounded noisy-OR reinforcement: new supporting evidence nudges confidence up, capped by tier. */
export function reinforceConfidence(current: number, incoming: number, tier: 'explicit' | 'inferred' | 'hypothesis'): number {
  const next = 1 - (1 - current) * (1 - 0.3 * incoming);
  return Math.min(next, TIER_CONFIDENCE_CAP[tier]);
}

/** The async queue job: analyse one answer and fold it into the knowledge model. */
export async function extractInterviewAnswer(orgId: string, cloneId: string, answerId: string): Promise<{ status: 'done' | 'skipped' | 'failed'; note: string }> {
  const [row] = await db.select().from(interviewAnswers)
    .where(and(eq(interviewAnswers.id, answerId), eq(interviewAnswers.orgId, orgId), eq(interviewAnswers.cloneId, cloneId))).limit(1);
  if (!row) return { status: 'failed', note: 'answer not found' };
  if (row.skipped || row.text.trim().length < 8) {
    await db.update(interviewAnswers).set({ extractionStatus: 'skipped', extractedAt: new Date() }).where(eq(interviewAnswers.id, answerId));
    return { status: 'skipped', note: 'nothing to extract' };
  }
  const [question] = await db.select().from(interviewQuestions).where(eq(interviewQuestions.id, row.questionId)).limit(1);

  try {
    const cfg = await orgModelConfig(orgId);
    const digest = await knownDigest(cloneId);
    let probeContext = '';
    if (question?.kind === 'contradiction' && question.contradictionId) {
      const [contra] = await db.select().from(contradictions).where(eq(contradictions.id, question.contradictionId)).limit(1);
      if (contra) probeContext = `\n\nTHIS ANSWER RESPONDS TO AN OPEN TENSION:\n${contra.description}\nJudge contradiction_resolution: did this answer explain what makes the situations different? A good resolution usually becomes a RULE.`;
    }
    const raw = await structuredCall({
      orgId, cloneId, kind: 'interview-extract', apiKey: cfg.apiKey, model: cfg.extractModel, effort: 'medium',
      schema: AnswerExtraction, system: EXTRACT_ANSWER_SYSTEM,
      user: `${digest}\n\nCATEGORY: ${row.category}\nFACETS in this category: ${(CATEGORY_FACETS[row.category as keyof typeof CATEGORY_FACETS] ?? []).join(', ')}\n\nQUESTION:\n${row.questionText}\n\nANSWER (verbatim):\n${redactSecrets(row.text).slice(0, 8000)}${probeContext}`,
    });
    const { out, dropped, demoted } = sanitizeExtraction(raw, row.text);

    await db.transaction(async (tx) => {
      const ev = (quotes: string[]): Evidence[] => quotes.map((quote) => ({ quote, ref: `interview:${answerId}` }));
      const log = async (layer: string, targetId: string | null, action: string, summary: string, extra?: Record<string, unknown>) => {
        await tx.insert(learningEvents).values({
          orgId, cloneId, layer, targetId, action, summary,
          sourceKind: 'interview', sourceRef: `interview:${answerId}`, reviewStatus: 'auto', ...extra,
        });
      };

      for (const m of out.memories) {
        const [ins] = await tx.insert(memories).values({
          orgId, cloneId, status: 'confirmed', confidence: 0.9, sourceKind: 'interview', sourceRef: `interview:${answerId}`,
          evidence: ev(m.quotes), createdBy: 'interview',
          summary: m.summary, fullContext: m.full_context, importance: m.importance,
          emotionalSignificance: m.emotional_significance, peopleInvolved: m.people_involved,
          dateOrPeriod: m.date_or_period, category: row.category,
        }).returning({ id: memories.id });
        await log('memory', ins!.id, 'created', m.summary);
      }

      for (const t of out.traits) {
        const [existing] = await tx.select().from(traits)
          .where(and(eq(traits.cloneId, cloneId), eq(traits.kind, t.kind), eq(traits.key, t.key))).limit(1);
        if (existing && !t.quotes.length) continue; // no verified evidence ⇒ never nudges an existing item
        if (existing) {
          const alreadyFromThisAnswer = existing.evidence.some((e) => e.ref === `interview:${answerId}`);
          const confidence = reinforceConfidence(existing.confidence, t.confidence, existing.tier);
          const promote = t.tier === 'explicit' && existing.tier !== 'explicit' && t.quotes.length > 0;
          const confirmInferred = !promote && existing.tier === 'inferred' && existing.status === 'candidate' && !alreadyFromThisAnswer;
          await tx.update(traits).set({
            confidence: promote ? Math.min(Math.max(confidence, t.confidence), TIER_CONFIDENCE_CAP.explicit) : confidence,
            evidence: [...existing.evidence, ...ev(t.quotes)].slice(0, 20),
            reinforceCount: existing.reinforceCount + 1,
            lastReinforcedAt: new Date(),
            strength: (existing.strength + t.strength) / 2,
            ...(promote ? { tier: 'explicit' as const, status: 'confirmed' as const } : {}),
            ...(confirmInferred ? { status: 'confirmed' as const } : {}),
            updatedAt: new Date(),
          }).where(eq(traits.id, existing.id));
          if (promote) await log('trait', existing.id, 'promoted', `${t.label}: now explicit — the person said it outright`);
          else if (confirmInferred) await log('trait', existing.id, 'confirmed', `${t.label}: seen in a second independent answer`);
          else await log('trait', existing.id, 'reinforced', `${t.label}: reinforced (${existing.reinforceCount + 1}×)`, { confidence });
        } else {
          const status = t.tier === 'explicit' ? 'confirmed' : 'candidate';
          const [ins] = await tx.insert(traits).values({
            orgId, cloneId, status, confidence: t.confidence, sourceKind: 'interview', sourceRef: `interview:${answerId}`,
            evidence: ev(t.quotes), createdBy: 'interview',
            kind: t.kind, key: t.key, label: t.label, statement: t.statement, category: t.category,
            tier: t.tier, strength: t.strength, validFrom: new Date(),
          }).returning({ id: traits.id });
          await log('trait', ins!.id, 'created', `${t.label} [${t.kind}/${t.tier}]: ${t.statement}`, { confidence: t.confidence });
        }
      }

      for (const r of out.rules) {
        const [dupe] = await tx.select({ id: contextualRules.id, evidence: contextualRules.evidence, reinforceCount: contextualRules.reinforceCount, confidence: contextualRules.confidence, tier: contextualRules.tier })
          .from(contextualRules)
          .where(and(eq(contextualRules.cloneId, cloneId),
            sql`lower(${contextualRules.situation}) = ${r.situation.toLowerCase()}`,
            sql`lower(${contextualRules.tendency}) = ${r.tendency.toLowerCase()}`)).limit(1);
        if (dupe) {
          await tx.update(contextualRules).set({
            evidence: [...dupe.evidence, ...ev(r.quotes)].slice(0, 12),
            reinforceCount: dupe.reinforceCount + 1, lastReinforcedAt: new Date(),
            confidence: reinforceConfidence(dupe.confidence, 0.7, dupe.tier), updatedAt: new Date(),
          }).where(eq(contextualRules.id, dupe.id));
          await log('rule', dupe.id, 'reinforced', `${r.situation} → ${r.tendency}`);
          continue;
        }
        let exceptionToTraitId: string | null = null;
        if (r.exception_to_key) {
          const [t] = await tx.select({ id: traits.id }).from(traits)
            .where(and(eq(traits.cloneId, cloneId), eq(traits.key, r.exception_to_key))).limit(1);
          exceptionToTraitId = t?.id ?? null;
        }
        const [ins] = await tx.insert(contextualRules).values({
          orgId, cloneId, status: r.tier === 'explicit' ? 'confirmed' : 'candidate',
          confidence: Math.min(0.8, TIER_CONFIDENCE_CAP[r.tier]), sourceKind: 'interview', sourceRef: `interview:${answerId}`,
          evidence: ev(r.quotes), createdBy: 'interview',
          category: r.category, situation: r.situation, condition: r.condition, tendency: r.tendency,
          exceptionToTraitId, tier: r.tier, validFrom: new Date(),
        }).returning({ id: contextualRules.id });
        await log('rule', ins!.id, 'created', `IF ${r.situation}${r.condition ? ` AND ${r.condition}` : ''} THEN ${r.tendency}`);
      }

      for (const tn of out.tensions) {
        const [trait] = await tx.select({ id: traits.id }).from(traits)
          .where(and(eq(traits.cloneId, cloneId), eq(traits.key, tn.existing_key))).limit(1);
        const [contra] = await tx.insert(contradictions).values({
          orgId, cloneId, traitId: trait?.id ?? null, answerId, description: tn.description,
        }).returning({ id: contradictions.id });
        const [probe] = await tx.insert(interviewQuestions).values({
          orgId, cloneId, category: row.category, facet: question?.facet ?? null,
          text: tn.probe_question, kind: 'contradiction', source: 'generated',
          contradictionId: contra!.id, status: 'pending',
        }).returning({ id: interviewQuestions.id });
        await tx.update(contradictions).set({ probeQuestionId: probe!.id }).where(eq(contradictions.id, contra!.id));
        await log('contradiction', contra!.id, 'created', tn.description);
      }

      // Resolve the tension this probe was asking about.
      if (question?.kind === 'contradiction' && question.contradictionId) {
        const resolved = out.contradiction_resolution?.resolved === true;
        await tx.update(contradictions).set({
          status: resolved ? 'resolved' : 'probed',
          ...(resolved ? { resolutionAnswerId: answerId, resolutionNote: out.contradiction_resolution?.note ?? null, resolvedAt: new Date() } : {}),
        }).where(eq(contradictions.id, question.contradictionId));
        if (resolved) await log('contradiction', question.contradictionId, 'updated', `resolved: ${out.contradiction_resolution?.note ?? ''}`);
      }

      // Fresh questions this answer opened up (thread depth capped at 2).
      const depth = (row.context?.threadDepth ?? 0);
      if (depth < 2) {
        for (const s of out.followup_seeds) {
          await tx.insert(interviewQuestions).values({
            orgId, cloneId, category: s.category, facet: s.facet, text: s.question,
            kind: 'behavioural', source: 'generated', status: 'pending',
          });
        }
      }

      await tx.update(interviewAnswers).set({
        extraction: {
          memories: out.memories.length, traits: out.traits.length, rules: out.rules.length,
          tensions: out.tensions.length, quality: out.quality,
          note: [out.note, dropped ? `${dropped} unquoted item(s) dropped` : '', demoted ? `${demoted} demoted to observed` : ''].filter(Boolean).join(' · '),
        },
        extractionStatus: 'done', extractedAt: new Date(),
      }).where(eq(interviewAnswers.id, answerId));
    });

    await storeCoverage(orgId, cloneId);
    if (out.memories.length || out.traits.length || out.rules.length) {
      // The knowledge sections render into the persona prompt — publish a fresh version.
      const { publishSnapshot } = await import('../persona/assemble.js');
      await publishSnapshot(orgId, cloneId).catch((e) => console.error('[interview] snapshot after extraction failed', e));
    }
    return { status: 'done', note: `${out.memories.length}m/${out.traits.length}t/${out.rules.length}r/${out.tensions.length}x` };
  } catch (e) {
    await db.update(interviewAnswers).set({ extractionStatus: 'failed' }).where(eq(interviewAnswers.id, answerId)).catch(() => {});
    return { status: 'failed', note: e instanceof Error ? e.message.slice(0, 200) : 'extraction failed' };
  }
}
