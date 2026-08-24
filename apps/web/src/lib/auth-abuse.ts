import { and, eq, gt, lt } from 'drizzle-orm';
import { db, authFailures } from '@opersona/db';

const THRESHOLD = 10;           // failures within the window → account locked
const WINDOW_MS = 15 * 60_000;  // rolling 15 minutes

/** True when this email has hit the failure threshold in the window. Checked in
 *  the auth `before` hook so a locked account is refused regardless of source IP
 *  (the defense IP-rate-limiting can't provide against distributed spray). */
export async function accountLocked(email: string): Promise<boolean> {
  const since = new Date(Date.now() - WINDOW_MS);
  const rows = await db.select({ id: authFailures.id }).from(authFailures)
    .where(and(eq(authFailures.email, email.toLowerCase()), gt(authFailures.createdAt, since)));
  return rows.length >= THRESHOLD;
}

/** Record the outcome of a sign-in: a failure (>=400) adds a row; a success clears them. */
export async function recordSignInResult(email: string, status: number): Promise<void> {
  const e = email.toLowerCase();
  if (status >= 400) { await db.insert(authFailures).values({ email: e }); return; }
  if (status < 300) await db.delete(authFailures).where(eq(authFailures.email, e));
}

/** Housekeeping: drop rows older than the window (called opportunistically). */
export async function pruneAuthFailures(): Promise<void> {
  await db.delete(authFailures).where(lt(authFailures.createdAt, new Date(Date.now() - WINDOW_MS)));
}
