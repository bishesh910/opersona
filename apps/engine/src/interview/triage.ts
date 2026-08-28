/**
 * Sync triage — the fast pass that keeps the interview conversational. One
 * cheap condenseModel call (hard 6s ceiling via Promise.race) looks at the
 * fresh answer and produces ONLY conversational steering:
 *   - a warm one-line acknowledgment,
 *   - up to two follow-up hooks worth pulling on right now,
 *   - at most one tension against the KNOWN digest, with a ready probe question.
 * Nothing from triage is ever stored as knowledge about the person — it only
 * creates question rows. On timeout/error the caller falls back to the pool:
 * the interview never stalls behind a slow rail. INTERVIEW_TRIAGE=false disables.
 */
import { z } from 'zod';
import { FOLLOWUP_INTENTS } from '@opersona/shared';
import { structuredCall } from '../llm.js';
import { orgModelConfig } from '../keys.js';
import { knownDigest } from './state.js';

export const TriageOut = z.object({
  quality: z.enum(['substantive', 'thin', 'off_topic', 'refusal']),
  ack: z.string().max(90).nullable().describe('one warm, plain-words line acknowledging what they shared — no analysis-speak, no flattery; null when a plain next question is better'),
  followups: z.array(z.object({
    intent: z.enum(FOLLOWUP_INTENTS),
    question: z.string().min(10).max(240),
    hook_strength: z.number().min(0).max(1).describe('how promising this thread is, honestly'),
  })).max(2).default([]),
  tension: z.object({
    known_key: z.string().max(48),
    description: z.string().min(10).max(200),
    probe_question: z.string().min(10).max(240),
  }).nullable().default(null),
});
export type TriageOutT = z.infer<typeof TriageOut>;

const TRIAGE_SYSTEM = `You are the live ear of a cognitive interview. A person just answered one question. In ONE fast pass decide only:
- quality: substantive / thin / off_topic / refusal.
- ack: one warm human line that shows you heard them ("That eighteen months of runway says a lot."). Never analyse them to their face, never flatter, never use words like "trait", "pattern", "data". null is fine.
- followups: up to 2 questions worth asking RIGHT NOW because this answer opened a door — why, alternatives considered, what mattered most, would-you-today, is-there-an-exception, does-it-change-for-someone-close. Only genuinely promising threads; hook_strength honest.
- tension: ONLY if this answer sits oddly against the KNOWN list you were given — name the key, describe the tension neutrally, and write ONE curious question about what makes the situations different. Never a gotcha. null when there is none.
You are steering a conversation, not building the model — a slower pass does that. Keep everything short.`;

export const TRIAGE_TIMEOUT_MS = 6_000;
export const triageEnabled = (): boolean => process.env.INTERVIEW_TRIAGE !== 'false';

/** Never throws; null = disabled, timed out, or failed — the caller falls back to the pool. */
export async function triageAnswer(a: { orgId: string; cloneId: string; questionText: string; answerText: string }): Promise<TriageOutT | null> {
  if (!triageEnabled()) return null;
  try {
    const cfg = await orgModelConfig(a.orgId);
    const digest = await knownDigest(a.cloneId, 2000);
    const call = structuredCall({
      orgId: a.orgId, cloneId: a.cloneId, kind: 'interview-triage', apiKey: cfg.apiKey, model: cfg.condenseModel, effort: 'low',
      schema: TriageOut, system: TRIAGE_SYSTEM,
      user: `KNOWN (for tension detection only):\n${digest}\n\nQUESTION:\n${a.questionText}\n\nANSWER:\n${a.answerText.slice(0, 4000)}`,
    });
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), TRIAGE_TIMEOUT_MS).unref?.());
    return await Promise.race([call, timeout]);
  } catch {
    return null;
  }
}
