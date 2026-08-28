'use server';
/**
 * Self-serve deletion — the privacy page's promise, kept. Persona deletion
 * sweeps every clone_id table (information_schema-driven, so new tables are
 * covered automatically) and purges the engine's files; account deletion wipes
 * every solely-owned workspace the same way, then removes the auth identity.
 * Both are permanent and both say so before they act.
 */
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@opersona/db';
import { requireOrg, requireSession } from '@/lib/session';
import { getCloneAccess } from '@/lib/clones';
import { wipeClone, purgeCloneFiles, deleteUserAccount } from '@/lib/deletion';

export interface DeletionResult { ok: boolean; error?: string }

/** Permanently delete the caller's own persona (their member clone) and everything derived from it. */
export async function deletePersonaAction(): Promise<DeletionResult> {
  const ctx = await requireOrg();
  const access = await getCloneAccess(ctx, 'me');
  if (!access?.isOwner || !access.canWrite) return { ok: false, error: 'no persona to delete' };
  const cloneId = access.clone.id;
  const docs = await db.select({ id: schema.documents.id }).from(schema.documents)
    .where(and(eq(schema.documents.cloneId, cloneId), eq(schema.documents.orgId, ctx.orgId)));
  await db.transaction(async (tx) => { await wipeClone(tx, ctx.orgId, cloneId); });
  await purgeCloneFiles(ctx.orgId, cloneId, docs.map((d) => d.id));
  return { ok: true };
}

/** Permanently delete the caller's account. `confirmEmail` must match exactly — a typed, deliberate act. */
export async function deleteAccountAction(confirmEmail: string): Promise<DeletionResult> {
  const s = await requireSession();
  if (confirmEmail.trim().toLowerCase() !== s.user.email.trim().toLowerCase()) {
    return { ok: false, error: 'Type your account email exactly to confirm.' };
  }
  await deleteUserAccount(s.userId, s.user.email);
  return { ok: true };
}
