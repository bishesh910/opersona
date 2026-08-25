/**
 * Episode writer — one compact "what happened" record per finished conversation.
 *
 * Runs inside the learning queue after reasoning extraction: the reasoning layer
 * learns HOW the person thinks; episodes remember WHAT was worked on, so
 * recall_memory can answer "what did we decide about X last week?" instead of
 * guessing. One row per conversation with ≥2 human turns, written with the cheap
 * condense model. Idempotent: unchanged conversations are skipped; a re-extracted
 * conversation that has grown replaces its episode.
 *
 * Privacy: only the OWNER's conversations become episodes (both plain-Claude and
 * persona-test chats). Visitor ("ask their persona") conversations never do — and
 * recall over episodes is owner-only regardless (see persona/retrieval.ts).
 */
import { z } from 'zod';
import { and, asc, desc, eq, ne } from 'drizzle-orm';
import { db, clones, conversations, turns, episodes } from '@opersona/db';
import { structuredCall } from '../llm.js';
import { orgModelConfig } from '../keys.js';
import { renderTranscript, type TranscriptTurn } from './extractReasoning.js';

const Episode = z.object({
  title: z.string().min(3).max(80).describe('short, specific, past-tense-friendly; no dates'),
  problem: z.string().max(200).describe('what the person was trying to do or figure out'),
  approach_summary: z.string().max(400).describe('how it was tackled, in 1-3 sentences'),
  key_decisions: z.array(z.string().max(120)).max(5).describe('concrete decisions or conclusions reached, with their WHY when stated'),
  outcome: z.enum(['resolved', 'partial', 'unresolved']),
  domain: z.string().max(40).describe('one short topic label, e.g. "databases", "wazuh", "billing"'),
});

const EPISODE_SYSTEM = `You condense ONE finished conversation between a person and an assistant into a single episode record for the person's long-term memory.

Capture WHAT happened, so it can be recalled later: the problem brought in, how it was approached, the concrete decisions/conclusions (with the stated reason when there is one), and whether it ended resolved, partial, or unresolved.

Rules:
- Be specific and searchable: keep product names, technology names, numbers — someone will later look this up by those words.
- key_decisions are the things worth recalling verbatim later ("chose PostgreSQL over SQLite because of concurrent writers"), not process notes.
- Never invent an outcome: "resolved" only if the conversation actually reached one.
- No secrets, tokens, or credentials in any field, even if the transcript contains them.`;

export type EpisodeResult = { wrote: true; id: string; title: string } | { wrote: false; reason: string };

/** Create (or refresh) the episode for one conversation. Safe to call repeatedly. */
export async function writeEpisode(orgId: string, cloneId: string, conversationId: string): Promise<EpisodeResult> {
  const [conv] = await db.select().from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.orgId, orgId), eq(conversations.cloneId, cloneId))).limit(1);
  if (!conv) return { wrote: false, reason: 'conversation not found' };

  const rows = await db.select().from(turns)
    .where(and(eq(turns.conversationId, conversationId), eq(turns.orgId, orgId))).orderBy(asc(turns.createdAt));
  const humanTurns = rows.filter((r) => r.role === 'user');
  if (humanTurns.length < 2) return { wrote: false, reason: 'fewer than 2 human turns' };

  // Idempotency: skip when nothing new happened; replace when the session has grown.
  const [existing] = await db.select({ id: episodes.id, turnCount: episodes.turnCount }).from(episodes)
    .where(and(eq(episodes.conversationId, conversationId), eq(episodes.cloneId, cloneId))).limit(1);
  if (existing && existing.turnCount === rows.length) return { wrote: false, reason: 'episode up to date' };

  const transcript: TranscriptTurn[] = rows.filter((r) => r.role !== 'system')
    .map((r) => ({ role: r.role === 'user' ? 'human' : 'assistant', text: r.editedContent ?? r.content }));
  const cfg = await orgModelConfig(orgId);
  const out = await structuredCall({
    orgId, cloneId, kind: 'episode', apiKey: cfg.apiKey, model: cfg.condenseModel,
    system: EPISODE_SYSTEM,
    user: `CONVERSATION (title: ${conv.title}):\n${renderTranscript(transcript, 60_000)}`,
    schema: Episode, effort: 'low',
  });

  const first = rows[0]!.createdAt.getTime(); const last = rows[rows.length - 1]!.createdAt.getTime();
  const values = {
    orgId, cloneId, status: 'confirmed' as const, confidence: 0.7,
    sourceKind: 'conversation' as const, sourceRef: conversationId, evidence: [], createdBy: 'system:episode-writer',
    conversationId, domain: out.domain.trim() || null, title: out.title.trim(),
    problem: out.problem.trim(), approachSummary: out.approach_summary.trim(),
    keyDecisions: out.key_decisions.map((d) => d.trim()).filter(Boolean),
    outcome: out.outcome, durationS: Math.max(0, Math.round((last - first) / 1000)), turnCount: rows.length,
  };
  if (existing) await db.delete(episodes).where(eq(episodes.id, existing.id));
  const [row] = await db.insert(episodes).values(values).returning({ id: episodes.id });
  return { wrote: true, id: row!.id, title: values.title };
}

export interface BackfillResult { scanned: number; wrote: number; skipped: number; errors: number; details: { conversationId: string; result: string }[] }

/** Backfill episodes for a clone's EXISTING finished conversations (owner's chats only), newest first. */
export async function backfillEpisodes(orgId: string, cloneId: string, cap = 50): Promise<BackfillResult> {
  const [clone] = await db.select({ owner: clones.ownerUserId }).from(clones)
    .where(and(eq(clones.id, cloneId), eq(clones.orgId, orgId))).limit(1);
  if (!clone) throw new Error('clone not found');
  const convs = (await db.select({ id: conversations.id, userId: conversations.userId }).from(conversations)
    .where(and(eq(conversations.cloneId, cloneId), eq(conversations.orgId, orgId), ne(conversations.status, 'live')))
    .orderBy(desc(conversations.lastActivityAt)))
    .filter((c) => c.userId === clone.owner)
    .slice(0, Math.min(Math.max(cap, 1), 50));
  const res: BackfillResult = { scanned: convs.length, wrote: 0, skipped: 0, errors: 0, details: [] };
  for (const c of convs) {
    try {
      const r = await writeEpisode(orgId, cloneId, c.id);
      if (r.wrote) { res.wrote++; res.details.push({ conversationId: c.id, result: `wrote: ${r.title}` }); }
      else { res.skipped++; res.details.push({ conversationId: c.id, result: `skipped: ${r.reason}` }); }
    } catch (e) {
      res.errors++; res.details.push({ conversationId: c.id, result: `error: ${e instanceof Error ? e.message : String(e)}` });
    }
  }
  return res;
}
