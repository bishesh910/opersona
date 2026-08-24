'use server';
import { z } from 'zod';
import { db, schema } from '@opersona/db';
import { scoreMbti, type MbtiResult } from '@opersona/shared';
import { requireOrg } from '@/lib/session';
import { getCloneAccess } from '@/lib/clones';
import { snapshotClone } from '@/lib/engine';

const PersonalityInput = z.object({
  cloneId: z.string(),
  answers: z.record(z.string(), z.number().int().min(1).max(5)),
});

export interface PersonalityResult { ok: boolean; error?: string; warning?: string; result?: MbtiResult }

/** Save a completed personality test for a persona (owner only), then re-render the snapshot. */
export async function savePersonalityAction(input: { cloneId: string; answers: Record<string, number> }): Promise<PersonalityResult> {
  const ctx = await requireOrg();
  const parsed = PersonalityInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid answers' };
  const access = await getCloneAccess(ctx, parsed.data.cloneId);
  if (!access?.isOwner) return { ok: false, error: 'Not allowed' };

  let result: MbtiResult;
  try {
    result = scoreMbti(parsed.data.answers); // server-side score; never trust the client's
  } catch {
    return { ok: false, error: 'Please answer every question.' };
  }

  await db.insert(schema.personalityTests).values({
    orgId: ctx.orgId,
    cloneId: access.clone.id,
    answers: parsed.data.answers,
    scores: result.scores,
    type: result.type,
  });

  const snap = await snapshotClone(access.clone.id, ctx.orgId);
  return { ok: true, result, warning: snap.ok ? undefined : `Saved, but snapshot failed: ${snap.error}` };
}
