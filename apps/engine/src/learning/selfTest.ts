/**
 * "Does it sound like me?" — the quality gauge for the fingerprint.
 *
 * A batch = 3 short problems from domains the person has NOT been chatting about,
 * answered by the persona (its real system prompt). The person rates each answer
 * me / not_me (+ optional "what I'd have done instead"). Ratings feed accuracy;
 * a not_me with a comment produces counter-observations exactly like chat feedback.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { and, eq, desc, isNotNull, isNull } from 'drizzle-orm';
import { db, selfTests, reasoningObservations, reasoningFeedback, claudeCodeSessions, personaBriefs } from '@opersona/db';
import { structuredCall, textCall } from '../llm.js';
import { orgModelConfig } from '../keys.js';
import { activePrompt } from '../persona/assemble.js';
import { DIMENSIONS } from './extractReasoning.js';

const Questions = z.object({
  problems: z.array(z.object({
    domain: z.string().max(40).describe('everyday or professional domain, e.g. "car maintenance", "event planning"'),
    question: z.string().min(20).max(400).describe('a realistic problem someone might bring, phrased in first person'),
  })).min(3).max(3),
});

const QUESTION_SYSTEM = `You create test problems for an AI persona that imitates how one specific person thinks. You are given WHO THEY ARE: their role, the projects they work on, and verbatim quotes from their real conversations. Produce 3 short, realistic problems THEY could plausibly face:
- Problems 1 and 2: squarely inside their actual fields of work (infer the fields from the projects and quotes — their stack, their kind of systems, their kind of decisions). NEW situations though — never a problem the quotes show they already solved.
- Problem 3: an adjacent field a person like them would still get pulled into (nearby technology, planning, vendor choice, hiring for their area).
- Each problem must have room for an approach (diagnosis, planning, weighing options) — not a fact lookup.
- Do not reuse the RECENT QUESTION domains.
- First person, 1–3 sentences, as if a colleague pinged them. No preamble.`;

export async function createSelfTestBatch(orgId: string, cloneId: string): Promise<{ batchId: string; items: { id: string; domain: string; question: string; answer: string }[] }> {
  const cfg = await orgModelConfig(orgId);
  const recent = await db.select({ domain: selfTests.domain }).from(selfTests).where(eq(selfTests.cloneId, cloneId)).orderBy(desc(selfTests.createdAt)).limit(12);
  const avoid = [...new Set(recent.map((r) => r.domain).filter(Boolean))];
  // Ground the questions in the person's real work: projects, their own words, their brief.
  const [brief] = await db.select({ role: personaBriefs.roleTitle, md: personaBriefs.briefMd }).from(personaBriefs).where(eq(personaBriefs.cloneId, cloneId)).limit(1);
  const projects = [...new Set((await db.select({ p: claudeCodeSessions.project }).from(claudeCodeSessions).where(eq(claudeCodeSessions.cloneId, cloneId))).map((r) => (r.p ?? '').split('/').pop()).filter(Boolean))].slice(0, 12);
  const obs = await db.select({ e: reasoningObservations.evidence }).from(reasoningObservations).where(eq(reasoningObservations.cloneId, cloneId)).orderBy(desc(reasoningObservations.createdAt)).limit(60);
  const quotes = [...new Set(obs.flatMap((o) => o.e.map((x) => x.quote)))].filter((q) => q.length > 30).slice(0, 18);
  const who = [
    brief?.role ? `Role: ${brief.role}` : '',
    brief?.md?.trim() ? `About them: ${brief.md.slice(0, 500)}` : '',
    projects.length ? `Projects they work in: ${projects.join(', ')}` : '',
    quotes.length ? ['Verbatim quotes from their real conversations:', ...quotes.map((q) => `- "${q.slice(0, 160)}"`)].join('\n') : '',
  ].filter(Boolean).join('\n\n');
  const q = await structuredCall({ orgId, cloneId, kind: 'self-test', apiKey: cfg.apiKey, model: cfg.extractModel, effort: 'medium', schema: Questions,
    system: QUESTION_SYSTEM,
    user: `WHO THEY ARE:\n${who || '(nothing known yet — use general professional problems)'}\n\nRECENT QUESTION domains to avoid: ${avoid.length ? avoid.join(', ') : '(none)'}` });

  const { prompt } = await activePrompt(orgId, cloneId);
  const batchId = randomUUID();
  const items = [];
  for (const p of q.problems) {
    const answer = await textCall({ orgId, cloneId, kind: 'self-test', apiKey: cfg.apiKey, model: cfg.chatModel, effort: 'medium', system: prompt,
      user: `${p.question}\n\n(Reply like a quick message to a colleague: numbered steps of what you'd actually do, in order — one short line each — then one line starting "Bottom line:". No preamble, no caveats, under 100 words.)` });
    const [row] = await db.insert(selfTests).values({ orgId, cloneId, batchId, domain: p.domain, question: p.question, answer, model: cfg.chatModel }).returning({ id: selfTests.id });
    items.push({ id: row!.id, domain: p.domain, question: p.question, answer });
  }
  return { batchId, items };
}

const NotMe = z.object({
  observations: z.array(z.object({
    pattern_key: z.string().regex(/^[a-z0-9_]+$/).max(48), dimension: z.enum(DIMENSIONS), description: z.string().max(220),
    polarity: z.enum(['is_me', 'not_me']), evidence: z.array(z.string().max(300)).min(1).max(2),
  })).max(4),
});

/** Throw away the unrated batch and make a fresh one. */
export async function regenerateSelfTests(orgId: string, cloneId: string) {
  await db.delete(selfTests).where(and(eq(selfTests.cloneId, cloneId), eq(selfTests.orgId, orgId), isNull(selfTests.verdict)));
  return createSelfTestBatch(orgId, cloneId);
}

export async function rateSelfTest(a: { orgId: string; cloneId: string; id: string; verdict: 'me' | 'not_me'; comment?: string }): Promise<{ observations: number }> {
  const [t] = await db.select().from(selfTests).where(and(eq(selfTests.id, a.id), eq(selfTests.cloneId, a.cloneId))).limit(1);
  if (!t) throw new Error('self-test not found');
  await db.update(selfTests).set({ verdict: a.verdict, comment: a.comment ?? null, ratedAt: new Date() }).where(eq(selfTests.id, a.id));
  if (a.verdict === 'me' || !a.comment?.trim()) return { observations: 0 };
  const cfg = await orgModelConfig(a.orgId);
  const out = await structuredCall({ orgId: a.orgId, cloneId: a.cloneId, kind: 'feedback', apiKey: cfg.apiKey, model: cfg.extractModel, effort: 'medium', schema: NotMe,
    system: `A person is correcting an AI persona of themselves. The persona answered a problem; the person said "that's NOT how I'd approach it" and explained. Extract domain-free reasoning patterns: not_me for the rejected move, is_me for how they say they WOULD think. Evidence = verbatim quotes from the person's comment only.`,
    user: `PROBLEM:\n${t.question}\n\nPERSONA'S ANSWER:\n${t.answer.slice(0, 5000)}\n\nPERSON'S COMMENT:\n${a.comment}` });
  if (out.observations.length) {
    await db.insert(reasoningObservations).values(out.observations.map((o) => ({
      orgId: a.orgId, cloneId: a.cloneId, patternKey: o.pattern_key, dimension: o.dimension, description: o.description,
      evidence: o.evidence.map((quote) => ({ quote })), weight: o.polarity === 'is_me' ? 1.5 : 1.0, sourceKind: 'feedback' as const, sourceRef: `self-test:${a.id}`,
    })));
  }
  return { observations: out.observations.length };
}

/** me / (me + not_me) across chat feedback and self-tests, with counts. */
export async function accuracy(cloneId: string): Promise<{ me: number; notMe: number; pct: number | null }> {
  const fb = await db.select({ v: reasoningFeedback.verdict }).from(reasoningFeedback).where(eq(reasoningFeedback.cloneId, cloneId));
  const st = await db.select({ v: selfTests.verdict }).from(selfTests).where(and(eq(selfTests.cloneId, cloneId), isNotNull(selfTests.verdict)));
  const all = [...fb.map((x) => x.v), ...st.map((x) => x.v!)];
  const me = all.filter((v) => v === 'me').length, notMe = all.length - me;
  return { me, notMe, pct: all.length ? Math.round((100 * me) / all.length) : null };
}
