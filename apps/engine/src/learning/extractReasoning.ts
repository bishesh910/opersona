/**
 * Reasoning-move extractor — the heart of "learn HOW they think, not WHAT they did".
 *
 * Input: one conversation between the human and an assistant (in-app chat or an
 * imported claude.ai chat). Output: a handful of DOMAIN-FREE observations about the
 * human's approach, each quoting the human's own words as evidence. The assistant's
 * turns are context only — nothing the assistant did is ever attributed to the human.
 *
 * Observations are written to reasoning_observations; the fingerprint aggregator
 * turns repeated observations into confirmed patterns.
 */
import { z } from 'zod';
import { and, eq, asc } from 'drizzle-orm';
import { db, turns, reasoningObservations, reasoningPatterns } from '@opersona/db';
import { redactSecrets } from '@opersona/shared';
import { structuredCall } from '../llm.js';
import { orgModelConfig } from '../keys.js';

export const DIMENSIONS = ['decomposition', 'starting_point', 'information', 'verification', 'explanation', 'risk', 'pace', 'other'] as const;

const Observation = z.object({
  pattern_key: z.string().min(3).max(48).regex(/^[a-z0-9_]+$/).describe('snake_case id. REUSE an existing key from the list if the same pattern; otherwise coin a new one'),
  dimension: z.enum(DIMENSIONS),
  description: z.string().min(10).max(220).describe('one domain-free sentence, present tense, about how this person thinks — e.g. "Breaks a problem into the smallest units and counts them up"'),
  evidence: z.array(z.string().min(5).max(300)).min(1).max(3).describe("verbatim quotes from the HUMAN's turns only"),
  strength: z.number().min(0).max(1).describe('how clearly this conversation shows the pattern'),
});
export const Extraction = z.object({
  observations: z.array(Observation).max(8),
  note: z.string().max(300).describe('one line: what kind of conversation this was; or why nothing could be learned'),
});
export type Extraction = z.infer<typeof Extraction>;

export const EXTRACT_SYSTEM = `You study how ONE specific person thinks, by reading a conversation they had with an AI assistant.

Your job is NOT to record what was discussed, what the answer was, or what the assistant did. Your job is to notice the person's REASONING MOVES — the shape of how they approach things — stated in a way that would apply to any other problem in any other domain.

Example: if asked "how to solve 2+2" the person reasons "1+1+1+1", the learning is NOT "2+2=4" and NOT "they used 1+1+1+1". It is: "Breaks a problem into the smallest units and counts them up" (dimension: decomposition). If they instead said "4-2+4-2", it might be "Reframes a problem in terms of a known anchor and adjusts from it".

Dimensions:
- decomposition: how they break things down (units, backwards from the goal, by analogy, by elimination…)
- starting_point: where they begin (evidence/logs first vs hypothesis first; simplest case vs general case)
- information: what they ask for or trust (examples vs rules; the why before the how; must see it themselves)
- verification: how they check (re-derive another way, run a test, ask for confirmation, move on)
- explanation: how they want things explained back (step-by-step, analogy, terse, visual, from first principles)
- risk: caution, reversibility, when they escalate or refuse to act
- pace: breadth-first exploring vs narrow-and-deep; patience; when they stop
- other: only if it truly fits nowhere else

Rules:
- Evidence must be verbatim quotes from the HUMAN's turns. Never quote the assistant. Never infer a trait from something the assistant proposed and the human merely accepted — acceptance is weak evidence; pushing back, redirecting, re-asking, or explaining their own reasoning is strong evidence.
- Prefer 0–4 well-supported observations over many weak ones. If the conversation is just a question and an answer with no visible reasoning from the human, return an empty list and say so in note.
- If a pattern in the EXISTING PATTERNS list matches, reuse its pattern_key exactly so the evidence accumulates. Coin a new key only for something genuinely different.
- Descriptions must be domain-free: no product names, no technologies, no topic words. "Checks the raw source before trusting a summary" — not "reads ossec.log before restarting".
- Do not psychoanalyse. Describe observable moves, not personality.`;

/** Existing pattern keys + descriptions so the extractor reuses keys. */
async function existingPatternsDigest(cloneId: string): Promise<string> {
  const rows = await db.select({ key: reasoningPatterns.patternKey, dim: reasoningPatterns.dimension, desc: reasoningPatterns.description, status: reasoningPatterns.status })
    .from(reasoningPatterns).where(eq(reasoningPatterns.cloneId, cloneId));
  if (!rows.length) return '(none yet)';
  return rows.filter((r) => r.status !== 'rejected').map((r) => `- ${r.key} [${r.dim}]: ${r.desc}`).join('\n');
}

export interface TranscriptTurn { role: 'human' | 'assistant'; text: string }

/** Human turns are the signal (kept up to 3000 chars); assistant turns are context (clipped to 700). */
export function renderTranscript(t: TranscriptTurn[], maxChars = 70_000): string {
  const lines = t.map((x) => `${x.role === 'human' ? 'HUMAN' : 'ASSISTANT'}: ${redactSecrets(x.text).slice(0, x.role === 'human' ? 3000 : 700)}`);
  let s = lines.join('\n\n');
  if (s.length > maxChars) s = s.slice(0, maxChars) + '\n\n[truncated]';
  return s;
}

/** Split a long transcript into sequential windows that each fit one extraction call. */
export function windows(t: TranscriptTurn[], maxChars = 70_000, maxWindows = 4): TranscriptTurn[][] {
  const size = (x: TranscriptTurn) => Math.min(x.text.length, x.role === 'human' ? 3000 : 700) + 12;
  const out: TranscriptTurn[][] = [[]]; let cur = 0;
  for (const turn of t) {
    const n = size(turn);
    if (cur + n > maxChars && out[out.length - 1]!.length) { out.push([]); cur = 0; }
    out[out.length - 1]!.push(turn); cur += n;
  }
  if (out.length <= maxWindows) return out;
  // Too long even for maxWindows: keep the first and the last windows (start + most recent work).
  return [...out.slice(0, Math.ceil(maxWindows / 2)), ...out.slice(-Math.floor(maxWindows / 2))];
}

export async function extractFromTranscript(args: {
  orgId: string; cloneId: string; transcript: TranscriptTurn[]; sourceKind: 'conversation' | 'import' | 'feedback'; sourceRef: string;
}): Promise<Extraction> {
  const humanTurns = args.transcript.filter((t) => t.role === 'human');
  if (humanTurns.length === 0 || humanTurns.reduce((n, t) => n + t.text.length, 0) < 40) return { observations: [], note: 'no human reasoning to learn from' };
  const cfg = await orgModelConfig(args.orgId);
  const parts = windows(args.transcript);
  const all: Extraction = { observations: [], note: '' };
  for (const [i, part] of parts.entries()) {
    const digest = await existingPatternsDigest(args.cloneId); // refreshed per window so later windows reuse keys coined earlier
    const user = `EXISTING PATTERNS for this person (reuse keys when the same):\n${digest}\n\nCONVERSATION${parts.length > 1 ? ` (part ${i + 1} of ${parts.length})` : ''}:\n${renderTranscript(part)}`;
    const out = await structuredCall({ orgId: args.orgId, cloneId: args.cloneId, kind: 'extract', apiKey: cfg.apiKey, model: cfg.extractModel, system: EXTRACT_SYSTEM, user, schema: Extraction, effort: 'medium' });
    if (out.observations.length) {
      await db.insert(reasoningObservations).values(out.observations.map((o) => ({
        orgId: args.orgId, cloneId: args.cloneId, patternKey: o.pattern_key, dimension: o.dimension, description: o.description,
        evidence: o.evidence.map((quote) => ({ quote })), weight: Math.max(0.1, o.strength), sourceKind: args.sourceKind, sourceRef: args.sourceRef,
      })));
    }
    all.observations.push(...out.observations); all.note = out.note;
  }
  return all;
}

/** Extract from an in-app conversation (turns table). */
export async function extractFromConversation(orgId: string, cloneId: string, conversationId: string): Promise<Extraction> {
  const rows = await db.select().from(turns).where(and(eq(turns.conversationId, conversationId), eq(turns.orgId, orgId))).orderBy(asc(turns.createdAt));
  const transcript: TranscriptTurn[] = rows.filter((r) => r.role !== 'system').map((r) => ({ role: r.role === 'user' ? 'human' : 'assistant', text: r.editedContent ?? r.content }));
  return extractFromTranscript({ orgId, cloneId, transcript, sourceKind: 'conversation', sourceRef: conversationId });
}
