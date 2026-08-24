'use server';
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@opersona/db';
import { requireOrg } from '@/lib/session';
import { getCloneAccess } from '@/lib/clones';
import { snapshotClone } from '@/lib/engine';

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
