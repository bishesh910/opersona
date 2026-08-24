/**
 * "That's me" / "Not me" on a clone reply. Stored as feedback; with a comment it is
 * also run through the extractor as counter-/supporting evidence so the fingerprint
 * moves. Plain "me" without comment mildly reinforces the patterns the reply used
 * (we can't know which, so it is stored only — the UI uses it for the accuracy score).
 */
import { and, eq } from 'drizzle-orm';
import { db, turns, reasoningFeedback, reasoningObservations } from '@opersona/db';
import { extractFromTranscript } from './extractReasoning.js';
import { orgModelConfig } from '../keys.js';
import { structuredCall } from '../llm.js';
import { z } from 'zod';
import { DIMENSIONS } from './extractReasoning.js';

const NotMe = z.object({
  observations: z.array(z.object({
    pattern_key: z.string().regex(/^[a-z0-9_]+$/).max(48), dimension: z.enum(DIMENSIONS), description: z.string().max(220),
    polarity: z.enum(['is_me', 'not_me']).describe('is_me = the comment describes how they DO think; not_me = the reply showed a move they reject'),
    evidence: z.array(z.string().max(300)).min(1).max(2),
  })).max(4),
});

/** Fast path: store the verdict and return; the model call that turns a comment into
 *  observations runs AFTER the response (the UI shows "noted" immediately). */
export async function recordFeedback(a: { orgId: string; cloneId: string; conversationId: string; turnId: string; verdict: 'me' | 'not_me'; comment?: string; userId: string }): Promise<{ queued: boolean }> {
  const [turn] = await db.select().from(turns).where(and(eq(turns.id, a.turnId), eq(turns.orgId, a.orgId))).limit(1);
  if (!turn) throw new Error('turn not found');
  // Double-click guard: same turn + same verdict within 2 minutes → update the comment instead of a second row.
  const [dup] = await db.select({ id: reasoningFeedback.id, at: reasoningFeedback.createdAt }).from(reasoningFeedback)
    .where(and(eq(reasoningFeedback.turnId, a.turnId), eq(reasoningFeedback.verdict, a.verdict))).limit(1);
  if (dup && Date.now() - dup.at.getTime() < 120_000) {
    if (a.comment?.trim()) await db.update(reasoningFeedback).set({ comment: a.comment }).where(eq(reasoningFeedback.id, dup.id));
  } else {
    await db.insert(reasoningFeedback).values({ orgId: a.orgId, cloneId: a.cloneId, conversationId: a.conversationId, turnId: a.turnId, verdict: a.verdict, comment: a.comment ?? null, userId: a.userId });
  }
  if (!a.comment?.trim()) return { queued: false };
  void processFeedbackComment(a).catch((e) => console.error('[feedback]', e));
  return { queued: true };
}

async function processFeedbackComment(a: { orgId: string; cloneId: string; turnId: string; verdict: 'me' | 'not_me'; comment?: string }): Promise<void> {
  const [turn] = await db.select().from(turns).where(eq(turns.id, a.turnId)).limit(1);
  if (!turn) return;

  if (a.verdict === 'me') {
    await extractFromTranscript({ orgId: a.orgId, cloneId: a.cloneId, sourceKind: 'feedback', sourceRef: `feedback:${a.turnId}`,
      transcript: [{ role: 'assistant', text: turn.content }, { role: 'human', text: `That is exactly how I would approach it. ${a.comment}` }] });
    const { refresh } = await import('./queue.js');
    await refresh(a.orgId, a.cloneId);
    return;
  }
  const cfg = await orgModelConfig(a.orgId);
  const out = await structuredCall({ orgId: a.orgId, cloneId: a.cloneId, kind: 'feedback', apiKey: cfg.apiKey, model: cfg.extractModel, effort: 'medium', schema: NotMe,
    system: `A person is teaching an AI clone of themselves how they think. The clone gave a reply; the person said "that's NOT how I would approach it" and explained why. Extract domain-free reasoning patterns: polarity not_me for moves the reply made that the person rejects; polarity is_me for how the person says they WOULD think. Evidence = verbatim quotes from the person's comment only. Descriptions are present-tense, domain-free, about the person (for not_me, describe the rejected move as the person's avoidance, e.g. "Does not jump to a fix before seeing the raw data").`,
    user: `CLONE REPLY:\n${turn.content.slice(0, 6000)}\n\nPERSON'S COMMENT:\n${a.comment}` });
  if (out.observations.length) {
    await db.insert(reasoningObservations).values(out.observations.map((o) => ({
      orgId: a.orgId, cloneId: a.cloneId, patternKey: o.pattern_key, dimension: o.dimension, description: o.description,
      evidence: o.evidence.map((quote) => ({ quote })), weight: o.polarity === 'is_me' ? 1.5 : 1.0, sourceKind: 'feedback' as const, sourceRef: `feedback:${a.turnId}`,
    })));
    const { refresh } = await import('./queue.js');
    await refresh(a.orgId, a.cloneId);
  }
}
