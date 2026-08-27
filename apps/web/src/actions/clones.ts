'use server';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@opersona/db';
import { requireOrg } from '@/lib/session';

/** Create the current user's clone in the active org (unique per org+owner) plus an empty brief. */
export async function createMyCloneAction() {
  const ctx = await requireOrg();
  const [existing] = await db
    .select({ id: schema.clones.id })
    .from(schema.clones)
    .where(and(eq(schema.clones.orgId, ctx.orgId), eq(schema.clones.ownerUserId, ctx.userId)))
    .limit(1);
  if (existing) redirect('/me');

  const name = ctx.user.name?.trim() || ctx.user.email.split('@')[0] || 'My persona';
  let cloneId: string;
  try {
    cloneId = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(schema.clones)
        .values({ orgId: ctx.orgId, ownerUserId: ctx.userId, name })
        .returning({ id: schema.clones.id });
      if (!row) throw new Error('insert failed');
      await tx.insert(schema.personaBriefs).values({ cloneId: row.id, orgId: ctx.orgId, displayName: name });
      return row.id;
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to create clone';
    redirect(`/opersonas?error=${encodeURIComponent(msg)}`);
  }
  redirect('/me/brief');
}
