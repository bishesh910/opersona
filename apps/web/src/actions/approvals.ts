'use server';
/**
 * Account admission — platform admins let people in. Approve stamps
 * approved_at (and emails them when a mailer is configured); reject deletes
 * the never-approved account and its empty personal workspace.
 */
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { db, authSchema } from '@opersona/db';
import { getSessionCtx } from '@/lib/session';
import { isPlatformAdmin } from '@/lib/auth';
import { sendEmail, MAILER_ON } from '@/lib/email';
import { deleteUserAccount } from '@/lib/deletion';

async function requireStaff() {
  const s = await getSessionCtx();
  if (!s || !isPlatformAdmin(s.user.email)) throw new Error('staff only');
  return s;
}

export async function approveUserAction(userId: string): Promise<void> {
  await requireStaff();
  const [u] = await db.select().from(authSchema.user).where(eq(authSchema.user.id, userId)).limit(1);
  if (!u) throw new Error('user not found');
  if (u.approvedAt) return;
  await db.update(authSchema.user).set({ approvedAt: new Date() }).where(eq(authSchema.user.id, userId));
  if (MAILER_ON) {
    try {
      await sendEmail({ to: u.email, subject: "You're in — opersona", text: `Hi ${u.name},\n\nYour opersona account is approved. Head to https://opersona.me and build your persona.\n\nWelcome aboard.` });
    } catch (e) { console.error('[approvals] welcome email failed', e); }
  }
  revalidatePath('/admin/approvals');
}

/** Reject = delete the account + its (necessarily empty) personal workspace. Only never-approved accounts. */
export async function rejectUserAction(userId: string): Promise<void> {
  await requireStaff();
  const [u] = await db.select().from(authSchema.user).where(eq(authSchema.user.id, userId)).limit(1);
  if (!u) return;
  if (u.approvedAt) throw new Error('account is already approved — removal is a support task, not a click');
  if (isPlatformAdmin(u.email)) throw new Error('refusing to reject a platform admin');
  await deleteUserAccount(userId, u.email);
  revalidatePath('/admin/approvals');
}
