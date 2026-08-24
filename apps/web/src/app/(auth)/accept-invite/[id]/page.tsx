import Link from 'next/link';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { and, eq } from 'drizzle-orm';
import { db, authSchema } from '@opersona/db';
import { auth, SIGNUP_OPEN } from '@/lib/auth';
import { getSessionCtx } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * Invitation landing page. Logged out → sign-in / sign-up (with a return-to).
 * Logged in with the invited email → accept, set the org active, on to onboarding.
 */
export default async function AcceptInvitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const safeId = /^[\w-]{1,64}$/.test(id) ? id : '';
  const [inv] = safeId
    ? await db
        .select({
          id: authSchema.invitation.id,
          email: authSchema.invitation.email,
          status: authSchema.invitation.status,
          expiresAt: authSchema.invitation.expiresAt,
          organizationId: authSchema.invitation.organizationId,
          orgName: authSchema.organization.name,
        })
        .from(authSchema.invitation)
        .innerJoin(authSchema.organization, eq(authSchema.organization.id, authSchema.invitation.organizationId))
        .where(eq(authSchema.invitation.id, safeId))
        .limit(1)
    : [];

  if (!inv || inv.status !== 'pending' || inv.expiresAt < new Date()) {
    return (
      <div className="space-y-2 text-sm" data-invite-invalid>
        <h1 className="text-lg font-semibold">Invitation not found</h1>
        <p className="muted">This invitation link is invalid, expired, or was already used. Ask whoever invited you for a fresh link.</p>
        <Link href="/sign-in" className="underline">Sign in</Link>
      </div>
    );
  }

  const s = await getSessionCtx();
  const here = `/accept-invite/${inv.id}`;

  if (!s) {
    return (
      <div className="space-y-3 text-sm" data-invite-landing>
        <h1 className="text-lg font-semibold">Join {inv.orgName}</h1>
        <p className="muted">
          You&rsquo;ve been invited to join <strong>{inv.orgName}</strong> as <strong>{inv.email}</strong>.
          Sign in — or create an account with that email — to accept.
        </p>
        {SIGNUP_OPEN ? (
          <Link href={`/sign-up?next=${encodeURIComponent(here)}`} className="btn-primary block w-full text-center" data-invite-signup>Create account</Link>
        ) : (
          <p className="muted text-xs">
            Sign-ups are currently closed on this server, so a brand-new account can&rsquo;t be created yet —
            ask the organization owner to enable sign-ups (ALLOW_SIGNUP), then come back to this link.
          </p>
        )}
        <Link href={`/sign-in?next=${encodeURIComponent(here)}`} className="btn-secondary block w-full text-center" data-invite-signin>Sign in</Link>
      </div>
    );
  }

  if (s.user.email.toLowerCase() !== inv.email.toLowerCase()) {
    return (
      <div className="space-y-2 text-sm" data-invite-wrong-account>
        <h1 className="text-lg font-semibold">Different account</h1>
        <p className="muted">
          This invitation was created for <strong>{inv.email}</strong>, but you are signed in as <strong>{s.user.email}</strong>.
          Sign out and use an account with the invited email.
        </p>
        <Link href="/sign-in" className="underline">Switch account</Link>
      </div>
    );
  }

  // Already a member (e.g. the link opened twice)? Nothing to accept.
  const [member] = await db.select({ id: authSchema.member.id }).from(authSchema.member)
    .where(and(eq(authSchema.member.userId, s.userId), eq(authSchema.member.organizationId, inv.organizationId))).limit(1);
  if (!member) {
    try {
      // Accepts + sets this org active on the session (server-side, in the session row).
      await auth.api.acceptInvitation({ body: { invitationId: inv.id }, headers: await headers() });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not accept the invitation';
      return (
        <div className="space-y-2 text-sm">
          <h1 className="text-lg font-semibold">Could not join</h1>
          <p className="text-red-600">{msg}</p>
          <Link href={here} className="underline">Try again</Link>
        </div>
      );
    }
  }
  redirect('/onboarding');
}
