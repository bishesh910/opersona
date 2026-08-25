'use server';
import { randomBytes } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, schema, authSchema } from '@opersona/db';
import { auth } from '@/lib/auth';
import { requireOrg, isOrgAdmin } from '@/lib/session';

export interface MemberActionResult { ok: boolean; error?: string; tempPassword?: string }

/** Admin guard shared by all member management actions: acting user must be org admin,
 *  target must be a member of the same org, and never the acting user themself. */
async function guard(targetUserId: string) {
  const ctx = await requireOrg();
  if (!isOrgAdmin(ctx)) return { error: 'Org owner/admin only' } as const;
  if (targetUserId === ctx.userId) return { error: 'Use Settings for your own account' } as const;
  const [m] = await db.select({ id: authSchema.member.id }).from(authSchema.member)
    .where(and(eq(authSchema.member.organizationId, ctx.orgId), eq(authSchema.member.userId, targetUserId))).limit(1);
  if (!m) return { error: 'Not a member of this org' } as const;
  return { ctx } as const;
}

/** Set a random temporary password (shown once to the admin) and revoke their sessions. */
export async function resetMemberPasswordAction(_p: MemberActionResult | null, form: FormData): Promise<MemberActionResult> {
  const uid = String(form.get('userId') ?? '');
  const g = await guard(uid); if ('error' in g) return { ok: false, error: g.error };
  const temp = 'op-' + randomBytes(9).toString('base64url');
  const actx = await auth.$context;
  const hash = await actx.password.hash(temp);
  await db.update(authSchema.account).set({ password: hash })
    .where(and(eq(authSchema.account.userId, uid), eq(authSchema.account.providerId, 'credential')));
  await db.delete(authSchema.session).where(eq(authSchema.session.userId, uid));
  return { ok: true, tempPassword: temp };
}

/** Wipe their authenticator enrollment; the mandatory-2FA gate makes them re-enroll at next login. */
export async function resetMember2FAAction(_p: MemberActionResult | null, form: FormData): Promise<MemberActionResult> {
  const uid = String(form.get('userId') ?? '');
  const g = await guard(uid); if ('error' in g) return { ok: false, error: g.error };
  await db.delete(authSchema.twoFactor).where(eq(authSchema.twoFactor.userId, uid));
  await db.update(authSchema.user).set({ twoFactorEnabled: false }).where(eq(authSchema.user.id, uid));
  await db.delete(authSchema.session).where(eq(authSchema.session.userId, uid));
  revalidatePath('/settings');
  return { ok: true };
}

/** Remove from the org: their persona and everything learned from them is deleted, then the
 *  account itself (auth rows cascade). Their data lives nowhere else — this is the hard delete. */
export async function removeMemberAction(_p: MemberActionResult | null, form: FormData): Promise<MemberActionResult> {
  const uid = String(form.get('userId') ?? '');
  const g = await guard(uid); if ('error' in g) return { ok: false, error: g.error };
  const clones = await db.select({ id: schema.clones.id }).from(schema.clones)
    .where(and(eq(schema.clones.orgId, g.ctx.orgId), eq(schema.clones.ownerUserId, uid)));
  for (const c of clones) {
    if (!/^[0-9a-f-]{36}$/.test(c.id)) continue;
    // turns hang off conversations (no clone_id of their own)
    await db.execute(sql`DELETE FROM turns WHERE conversation_id IN (SELECT id FROM conversations WHERE clone_id = ${c.id})`);
    // sweep every table that carries clone_id — robust against future tables
    await db.execute(sql.raw(`DO $$ DECLARE r record; BEGIN
      FOR r IN SELECT table_name FROM information_schema.columns WHERE column_name='clone_id' AND table_schema='public' AND table_name <> 'clones' LOOP
        EXECUTE format('DELETE FROM %I WHERE clone_id = %L', r.table_name, '${c.id}');
      END LOOP; END $$;`));
    await db.delete(schema.clones).where(eq(schema.clones.id, c.id));
  }
  await db.delete(authSchema.user).where(eq(authSchema.user.id, uid)); // account/session/member/twoFactor/invitation cascade
  revalidatePath('/settings'); revalidatePath('/clones');
  return { ok: true };
}
