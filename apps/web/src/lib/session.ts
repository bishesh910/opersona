import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq, asc } from 'drizzle-orm';
import { db, authSchema } from '@opersona/db';
import { auth, REQUIRE_2FA, isPlatformAdmin } from './auth';
import { ensurePersonalWorkspace } from './workspace';

// Shapes + role checks live in ./org (Next-free); re-exported here so existing
// `from '@/lib/session'` imports keep working.
export { isOrgAdmin } from './org';
export type { OrgRole, SessionCtx, OrgCtx } from './org';
import type { OrgRole, SessionCtx, OrgCtx } from './org';

export async function getSessionCtx(): Promise<SessionCtx | null> {
  const s = await auth.api.getSession({ headers: await headers() });
  if (!s) return null;
  const active = (s.session as { activeOrganizationId?: string | null }).activeOrganizationId ?? null;
  return {
    userId: s.user.id,
    sessionId: (s.session as { id: string }).id,
    user: { id: s.user.id, name: s.user.name, email: s.user.email },
    activeOrganizationId: active,
    twoFactorEnabled: (s.user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled === true,
    approved: !!(s.user as { approvedAt?: Date | string | null }).approvedAt || isPlatformAdmin(s.user.email),
  };
}

/** Two-factor is optional by default (nudged in Settings); REQUIRE_2FA=true restores
 *  the mandatory redirect for locked-down self-hosts. The /setup-2fa page is exempt. */
export async function require2FA(s: SessionCtx): Promise<void> {
  if (REQUIRE_2FA && !s.twoFactorEnabled) redirect('/setup-2fa');
}

/** Redirects to /sign-in when unauthenticated, /pending until a platform admin approves. */
export async function requireSession(): Promise<SessionCtx> {
  const s = await getSessionCtx();
  if (!s) redirect('/sign-in');
  if (!s.approved) redirect('/pending');
  return s;
}

/**
 * Resolve the current org: session.activeOrganizationId if the user is a member,
 * else the first membership. Returns null when the user has no org at all.
 */
export async function getOrgCtx(s: SessionCtx): Promise<OrgCtx | null> {
  const query = () => db
    .select({
      orgId: authSchema.member.organizationId,
      role: authSchema.member.role,
      orgName: authSchema.organization.name,
    })
    .from(authSchema.member)
    .innerJoin(authSchema.organization, eq(authSchema.organization.id, authSchema.member.organizationId))
    .where(eq(authSchema.member.userId, s.userId))
    .orderBy(asc(authSchema.member.createdAt));
  let memberships = await query();
  if (memberships.length === 0) {
    // Self-heal: every account owns a personal workspace. Covers accounts whose
    // signup hook failed and pre-pivot stragglers — one call, then re-read.
    try { await ensurePersonalWorkspace(s.user); memberships = await query(); } catch (e) { console.error('[session] workspace self-heal failed', e); }
    if (memberships.length === 0) return null;
  }
  const m = memberships.find((x) => x.orgId === s.activeOrganizationId) ?? memberships[0]!;
  return { ...s, orgId: m.orgId, orgName: m.orgName, role: (m.role as OrgRole) ?? 'member' };
}

/** Redirects to /sign-in (no session) or /onboarding (no org). */
export async function requireOrg(): Promise<OrgCtx> {
  const s = await requireSession();
  const org = await getOrgCtx(s);
  if (!org) redirect('/onboarding');
  return org;
}
