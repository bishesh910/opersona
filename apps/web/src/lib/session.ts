import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq, asc } from 'drizzle-orm';
import { db, authSchema } from '@opersona/db';
import { auth } from './auth';

export type OrgRole = 'owner' | 'admin' | 'member';

export interface SessionCtx {
  userId: string;
  /** id of the session row backing THIS request (for the Devices card). */
  sessionId: string;
  user: { id: string; name: string; email: string };
  activeOrganizationId: string | null;
  twoFactorEnabled: boolean;
}

export interface OrgCtx extends SessionCtx {
  orgId: string;
  orgName: string;
  role: OrgRole;
}

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
  };
}

/** Two-factor is MANDATORY: any signed-in user without it is sent to set it up.
 *  Call at the top of the (app) layout; the /setup-2fa page is exempt. */
export async function require2FA(s: SessionCtx): Promise<void> {
  if (!s.twoFactorEnabled) redirect('/setup-2fa');
}

/** Redirects to /sign-in when unauthenticated. */
export async function requireSession(): Promise<SessionCtx> {
  const s = await getSessionCtx();
  if (!s) redirect('/sign-in');
  return s;
}

/**
 * Resolve the current org: session.activeOrganizationId if the user is a member,
 * else the first membership. Returns null when the user has no org at all.
 */
export async function getOrgCtx(s: SessionCtx): Promise<OrgCtx | null> {
  const memberships = await db
    .select({
      orgId: authSchema.member.organizationId,
      role: authSchema.member.role,
      orgName: authSchema.organization.name,
    })
    .from(authSchema.member)
    .innerJoin(authSchema.organization, eq(authSchema.organization.id, authSchema.member.organizationId))
    .where(eq(authSchema.member.userId, s.userId))
    .orderBy(asc(authSchema.member.createdAt));
  if (memberships.length === 0) return null;
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

export function isOrgAdmin(ctx: Pick<OrgCtx, 'role'>): boolean {
  return ctx.role === 'owner' || ctx.role === 'admin';
}
