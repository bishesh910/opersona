/**
 * Pattern tidy-up: the extractor sometimes coins two keys for one habit
 * ("raw_data_before_guessing" vs "pastes_raw_terminal_output"). A model pass
 * proposes merge groups; code applies them behind verify gates:
 *   - only keys that exist; canonical ∉ absorbed; no group touches a REJECTED pattern
 *   - a human-ACCEPTED key can only be the canonical, never absorbed away
 *   - evidence is never lost: observations are re-keyed, aggregates recomputed
 * Runs nightly (03:00–04:00 server time) and on demand ("Tidy up" button).
 */
import { z } from 'zod';
import { and, eq, inArray } from 'drizzle-orm';
import { db, reasoningPatterns, reasoningObservations, learningEvents, clones } from '@opersona/db';
import { structuredCall } from '../llm.js';
import { orgModelConfig } from '../keys.js';
import { recomputeFingerprint } from './fingerprint.js';
import { publishSnapshot } from '../persona/assemble.js';

const MergePlan = z.object({
  groups: z.array(z.object({
    canonical_key: z.string(),
    absorb: z.array(z.string()).min(1).max(6),
    merged_description: z.string().min(10).max(220).describe('one domain-free sentence covering the merged habit'),
    reason: z.string().max(200),
  })).max(20),
});

const SYSTEM = `You are tidying a person's "reasoning fingerprint": a list of patterns describing HOW they think. Some entries are the SAME underlying habit under different keys. Propose merge groups.

Rules:
- Merge ONLY when the two descriptions describe the same observable habit. "Wants raw command output" and "pastes raw terminal output" are the same habit; "asks why before acting" and "asks what happens if skipped" are DIFFERENT habits — do not merge.
- canonical_key must be the key that best names the habit (prefer the one marked ACCEPTED, else the higher-strength one).
- merged_description: one present-tense, domain-free sentence that covers the whole group.
- When in doubt, do NOT merge. An empty groups list is a fine answer.`;

export interface MergeResult { groups: number; absorbed: number; skipped: string[] }

export async function tidyPatterns(orgId: string, cloneId: string): Promise<MergeResult> {
  const rows = await db.select().from(reasoningPatterns).where(eq(reasoningPatterns.cloneId, cloneId));
  const active = rows.filter((r) => r.status !== 'rejected');
  if (active.length < 4) return { groups: 0, absorbed: 0, skipped: [] };
  const cfg = await orgModelConfig(orgId);
  const listing = active.sort((a, b) => b.strength - a.strength)
    .map((r) => `- ${r.patternKey} [${r.dimension}] strength=${r.strength} seen=${r.nSources}${r.userVerdict === 'accept' ? ' ACCEPTED' : ''}: ${r.description}`).join('\n');
  const plan = await structuredCall({ orgId, cloneId, kind: 'tidy', apiKey: cfg.apiKey, model: cfg.extractModel, effort: 'medium', schema: MergePlan, system: SYSTEM, user: `PATTERNS:\n${listing}` });

  const byKey = new Map(rows.map((r) => [r.patternKey, r]));
  const result: MergeResult = { groups: 0, absorbed: 0, skipped: [] };
  const taken = new Set<string>();
  for (const g of plan.groups) {
    const canonical = byKey.get(g.canonical_key);
    const absorbed = g.absorb.map((k) => byKey.get(k)).filter((x): x is NonNullable<typeof x> => !!x && x.patternKey !== g.canonical_key);
    const why = (m: string) => result.skipped.push(`${g.canonical_key}: ${m}`);
    if (!canonical || !absorbed.length) { why('unknown key'); continue; }
    if (canonical.status === 'rejected' || absorbed.some((a) => a.status === 'rejected')) { why('touches a rejected pattern'); continue; }
    if (absorbed.some((a) => a.userVerdict === 'accept')) { why('would absorb a human-accepted pattern'); continue; }
    // Cross-dimension merges are allowed (the extractor files one habit under different dimensions);
    // the canonical's dimension wins. Re-key the absorbed observations' dimension too so the
    // aggregate stays consistent.
    if ([g.canonical_key, ...absorbed.map((a) => a.patternKey)].some((k) => taken.has(k))) { why('key already merged this run'); continue; }

    const keys = absorbed.map((a) => a.patternKey);
    await db.transaction(async (tx) => {
      await tx.update(reasoningObservations).set({ patternKey: g.canonical_key, dimension: canonical.dimension })
        .where(and(eq(reasoningObservations.cloneId, cloneId), inArray(reasoningObservations.patternKey, keys)));
      await tx.delete(reasoningPatterns).where(and(eq(reasoningPatterns.cloneId, cloneId), inArray(reasoningPatterns.patternKey, keys)));
      await tx.update(reasoningPatterns).set({ description: g.merged_description, updatedAt: new Date() })
        .where(and(eq(reasoningPatterns.cloneId, cloneId), eq(reasoningPatterns.patternKey, g.canonical_key)));
      await tx.insert(learningEvents).values({
        orgId, cloneId, layer: 'pattern', targetId: g.canonical_key, action: 'merged', reviewStatus: 'auto',
        summary: `Merged ${keys.join(', ')} into ${g.canonical_key}`, before: { absorbed: keys }, after: { description: g.merged_description }, sourceKind: 'reflection',
      });
    });
    [g.canonical_key, ...keys].forEach((k) => taken.add(k));
    result.groups++; result.absorbed += keys.length;
  }
  if (result.groups) { await recomputeFingerprint(orgId, cloneId); await publishSnapshot(orgId, cloneId); }
  return result;
}

// nightly, in-process (03:00–03:59 server time, once per day per clone)
let lastRun = '';
export function startNightlyTidy(): void {
  if (process.env.TIDY_NIGHTLY === 'false') return;
  setInterval(async () => {
    const now = new Date();
    const stamp = now.toISOString().slice(0, 10);
    if (now.getHours() !== 3 || lastRun === stamp) return;
    lastRun = stamp;
    try {
      const all = await db.select({ id: clones.id, orgId: clones.orgId }).from(clones);
      for (const c of all) {
        const r = await tidyPatterns(c.orgId, c.id).catch((e) => { console.error('[tidy]', c.id, e); return null; });
        if (r?.groups) console.log(`[tidy] ${c.id}: merged ${r.absorbed} pattern(s) into ${r.groups} group(s)`);
      }
    } catch (e) { console.error('[tidy] pass failed', e); }
  }, 10 * 60_000);
}
