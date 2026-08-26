'use server';
import { and, eq, lt, ne } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, authSchema } from '@opersona/db';
import { requireSession } from '@/lib/session';

/**
 * Device/session management. Long sessions (60-day sliding window) are safe
 * BECAUSE they are revocable: every session is a Postgres row checked on each
 * request, so deleting the row signs that device out immediately. Done fully
 * server-side — raw session tokens never reach the browser.
 */

/** Sign out one of YOUR devices. Scoped to the caller's own rows. */
export async function revokeDeviceSession(id: string): Promise<void> {
  const ctx = await requireSession();
  await db
    .delete(authSchema.session)
    .where(and(eq(authSchema.session.id, id), eq(authSchema.session.userId, ctx.userId)));
  revalidatePath('/settings');
}

/** Sign out everywhere except the device making this request. */
export async function revokeOtherDeviceSessions(): Promise<void> {
  const ctx = await requireSession();
  await db
    .delete(authSchema.session)
    .where(and(eq(authSchema.session.userId, ctx.userId), ne(authSchema.session.id, ctx.sessionId)));
  revalidatePath('/settings');
}

/** Sessions not used for this long are grouped as "inactive" and can be purged.
 *  Must match the grouping cutoff computed in settings/page.tsx. */
const INACTIVE_MS = 2 * 86400000;

/** Sign out every session that has not been used in 2+ days (never the current one).
 *  These are mostly orphans: a fresh sign-in replaces the browser cookie, so the
 *  previous row can never be used again but lingers until its 60-day expiry. */
export async function revokeInactiveDeviceSessions(): Promise<void> {
  const ctx = await requireSession();
  await db
    .delete(authSchema.session)
    .where(and(
      eq(authSchema.session.userId, ctx.userId),
      ne(authSchema.session.id, ctx.sessionId),
      lt(authSchema.session.updatedAt, new Date(Date.now() - INACTIVE_MS)),
    ));
  revalidatePath('/settings');
}
