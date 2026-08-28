/**
 * Pure org/session shapes and role checks — no Next runtime, no auth instance.
 * Lives apart from session.ts so authorization logic (engine-authz, clones)
 * stays importable in plain Node (vitest) without dragging next/headers in.
 */
export type OrgRole = 'owner' | 'admin' | 'member';

export interface SessionCtx {
  userId: string;
  /** id of the session row backing THIS request (for the Devices card). */
  sessionId: string;
  user: { id: string; name: string; email: string };
  activeOrganizationId: string | null;
  twoFactorEnabled: boolean;
  /** Admission control: platform admin approved this account (admins are always approved). */
  approved: boolean;
}

export interface OrgCtx extends SessionCtx {
  orgId: string;
  orgName: string;
  role: OrgRole;
}

export function isOrgAdmin(ctx: Pick<OrgCtx, 'role'>): boolean {
  return ctx.role === 'owner' || ctx.role === 'admin';
}
