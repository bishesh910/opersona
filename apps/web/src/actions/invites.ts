'use server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { and, eq, gt, sql } from 'drizzle-orm';
import { db, authSchema } from '@opersona/db';
import { requireOrg, isOrgAdmin } from '@/lib/session';

export interface InviteResult {
  ok: boolean;
  error?: string;
  /** Shareable accept URL for the invitation just created. */
  url?: string;
  email?: string;
}

const errMsg = (e: unknown) =>
  (e && typeof e === 'object' && 'message' in e && typeof (e as { message?: unknown }).message === 'string'
    ? (e as { message: string }).message
    : 'Something went wrong');

/** Org owner/admin creates a member invitation via better-auth; the accept URL is shown to copy. */
export async function createInviteAction(_prev: InviteResult | null, form: FormData): Promise<InviteResult> {
  const ctx = await requireOrg();
  if (!isOrgAdmin(ctx)) return { ok: false, error: 'Org owner/admin only' };
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'A valid email is required — the invite only works for an account with that address' };
  const base0 = (process.env.BETTER_AUTH_URL ?? '').replace(/\/$/, '');
  // Already a member? Say so instead of minting a dead link.
  const [existingMember] = await db.select({ id: authSchema.member.id }).from(authSchema.member)
    .innerJoin(authSchema.user, eq(authSchema.user.id, authSchema.member.userId))
    .where(and(eq(authSchema.member.organizationId, ctx.orgId), sql`lower(${authSchema.user.email}) = ${email}`)).limit(1);
  if (existingMember) return { ok: false, error: 'Already a member — they can just sign in.' };
  // A live pending invite for this email keeps its link — re-creating would kill the one you already sent.
  const [pending] = await db.select({ id: authSchema.invitation.id }).from(authSchema.invitation)
    .where(and(eq(authSchema.invitation.organizationId, ctx.orgId), sql`lower(${authSchema.invitation.email}) = ${email}`,
      eq(authSchema.invitation.status, 'pending'), gt(authSchema.invitation.expiresAt, new Date()))).limit(1);
  if (pending) return { ok: true, url: `${base0}/accept-invite/${pending.id}`, email };
  try {
    const inv = await auth.api.createInvitation({
      body: { email, role: 'member' as const, organizationId: ctx.orgId, resend: true },
      headers: await headers(),
    });
    revalidatePath('/settings');
    const base = (process.env.BETTER_AUTH_URL ?? '').replace(/\/$/, '');
    return { ok: true, url: `${base}/accept-invite/${inv.id}`, email };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export async function cancelInviteAction(form: FormData): Promise<void> {
  const ctx = await requireOrg();
  if (!isOrgAdmin(ctx)) redirect('/settings');
  const invitationId = String(form.get('invitationId') ?? '');
  if (invitationId) {
    try { await auth.api.cancelInvitation({ body: { invitationId }, headers: await headers() }); }
    catch { /* already handled/expired */ }
  }
  revalidatePath('/settings');
}
