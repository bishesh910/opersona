'use server';
import { eq } from 'drizzle-orm';
import { db, schema } from '@opersona/db';
import { AvatarRecipe } from '@opersona/shared';
import { requireOrg } from '@/lib/session';
import { getCloneAccess } from '@/lib/clones';
import type { ActionResult } from './brief';

export async function saveAvatarAction(cloneId: string, recipe: unknown): Promise<ActionResult> {
  const ctx = await requireOrg();
  const access = await getCloneAccess(ctx, cloneId);
  if (!access?.canWrite) return { ok: false, error: 'Not allowed' };
  const parsed = AvatarRecipe.safeParse(recipe);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  await db.update(schema.clones).set({ avatarRecipe: parsed.data, updatedAt: new Date() }).where(eq(schema.clones.id, cloneId));
  return { ok: true, savedAt: new Date().toISOString() };
}
