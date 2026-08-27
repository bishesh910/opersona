'use server';
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@opersona/db';
import { requireOrg } from '@/lib/session';
import { getCloneAccess } from '@/lib/clones';
import { snapshotClone, engineFetch } from '@/lib/engine';

const BriefInput = z.object({
  cloneId: z.string().uuid(),
  displayName: z.string().trim().max(120),
  roleTitle: z.string().trim().max(120),
  team: z.string().trim().max(120),
  briefMd: z.string().max(20_000),
  operatingRules: z.string().max(20_000),
});

export interface ActionResult { ok: boolean; error?: string; warning?: string; savedAt?: string }

export async function saveBriefAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const ctx = await requireOrg();
  const parsed = BriefInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  const d = parsed.data;
  const access = await getCloneAccess(ctx, d.cloneId);
  if (!access?.canWrite) return { ok: false, error: 'Not allowed' };

  await db.transaction(async (tx) => {
    await tx
      .insert(schema.personaBriefs)
      .values({ cloneId: d.cloneId, orgId: ctx.orgId, displayName: d.displayName, roleTitle: d.roleTitle, team: d.team, briefMd: d.briefMd, operatingRules: d.operatingRules })
      .onConflictDoUpdate({
        target: schema.personaBriefs.cloneId,
        set: {
          displayName: d.displayName, roleTitle: d.roleTitle, team: d.team, briefMd: d.briefMd, operatingRules: d.operatingRules,
          version: sql`${schema.personaBriefs.version} + 1`, updatedAt: new Date(),
        },
      });
    if (d.displayName) {
      await tx.update(schema.clones).set({ name: d.displayName, updatedAt: new Date() }).where(eq(schema.clones.id, d.cloneId));
    }
  });
  const snap = await snapshotClone(d.cloneId, ctx.orgId);
  return { ok: true, savedAt: new Date().toISOString(), warning: snap.ok ? undefined : `Saved, but snapshot failed: ${snap.error}` };
}

/** Onboarding interview → AI-drafted brief (runs on the workspace's cheapest rail). */
export async function composeBriefAction(cloneId: string, userName: string, answers: { role: string; knownFor?: string; style?: string; rules?: string }): Promise<{ ok: true; roleTitle: string; briefMd: string; operatingRules: string } | { ok: false; error: string }> {
  const ctx = await requireOrg();
  const access = await getCloneAccess(ctx, cloneId);
  if (!access?.canWrite) return { ok: false, error: 'Not allowed' };
  try {
    const out = await engineFetch<{ roleTitle: string; briefMd: string; operatingRules: string }>(
      `/clones/${cloneId}/compose-brief`, { body: { orgId: ctx.orgId, userName: userName.slice(0, 120), answers } });
    return { ok: true, ...out };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'drafting failed' };
  }
}
