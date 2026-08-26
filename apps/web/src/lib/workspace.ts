/**
 * Personal workspace = an organization of one, auto-created for every account.
 * org_id is a loose text discriminator across the whole schema, so giving each
 * user their own org makes per-user API keys, budgets and billing attribution
 * fall out for free — every existing org-scoped code path keeps working.
 *
 * Called from the user-create database hook (signup, social login) and lazily
 * from getOrgCtx() as a self-heal, so an account can never be orgless.
 * Concurrency: a transaction-scoped advisory lock keyed on the user id makes
 * double-creation impossible even for simultaneous first requests. Rows are
 * inserted directly (same shape better-auth writes) inside that transaction —
 * an org create has no plugin side effects in this app.
 */
import { randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db, authSchema } from '@opersona/db';

function firstNameOf(user: { name?: string | null; email?: string | null }): string {
  const fromName = (user.name ?? '').trim().split(/\s+/)[0];
  if (fromName) return fromName;
  const fromEmail = (user.email ?? '').split('@')[0]?.replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(/\s+/)[0];
  return fromEmail || 'My';
}

const slugify = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'workspace';

async function membershipOf(userId: string): Promise<string | null> {
  const rows = await db.select({ orgId: authSchema.member.organizationId }).from(authSchema.member).where(eq(authSchema.member.userId, userId)).limit(1);
  return rows[0]?.orgId ?? null;
}

/** Returns the user's org id, creating the personal workspace when they have none. */
export async function ensurePersonalWorkspace(user: { id: string; name?: string | null; email?: string | null }): Promise<string> {
  const existing = await membershipOf(user.id);
  if (existing) return existing;
  const first = firstNameOf(user);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'workspace:' + user.id}))`);
    const again = await tx.select({ orgId: authSchema.member.organizationId }).from(authSchema.member).where(eq(authSchema.member.userId, user.id)).limit(1);
    if (again[0]) return again[0].orgId;
    const orgId = randomBytes(16).toString('hex');
    await tx.insert(authSchema.organization).values({
      id: orgId,
      name: `${first}'s workspace`,
      slug: `${slugify(first)}-${randomBytes(3).toString('hex')}`,
      metadata: JSON.stringify({ personal: true }),
      createdAt: new Date(),
    });
    await tx.insert(authSchema.member).values({
      id: randomBytes(16).toString('hex'),
      organizationId: orgId,
      userId: user.id,
      role: 'owner',
      createdAt: new Date(),
    });
    return orgId;
  });
}
