import { redirect } from 'next/navigation';
import Link from 'next/link';
import { requireSession } from '@/lib/session';
import { eq } from 'drizzle-orm';
import { db, schema } from '@opersona/db';
import { TwoFactorCard } from '@/components/settings/TwoFactorCard';
import { SignOutLink } from '@/components/shell/SignOutLink';

/** Mandatory 2FA gate: reached when a signed-in user has no 2FA. Not inside (app),
 *  so it isn't caught by the gate that redirects here. */
export default async function Setup2FAPage() {
  const s = await requireSession();
  const [own] = await db.select({ id: schema.clones.id }).from(schema.clones).where(eq(schema.clones.ownerUserId, s.userId)).limit(1);
  const dest = own ? '/chat' : '/onboarding'; // persona not built yet → straight back to the builder
  if (s.twoFactorEnabled) redirect(dest);
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6">
      <div className="text-center">
        <div className="text-lg font-semibold tracking-tight">opersona</div>
        <p className="muted mt-1 text-sm">Two-factor authentication is required to continue.</p>
      </div>
      <TwoFactorCard enabled={false} redirectTo={dest} email={s.user.email} />
      <p className="muted text-center text-xs">
        Use an authenticator app (Google Authenticator, Authy, 1Password…). Signed in as {s.user.email}. <SignOutLink />
      </p>
    </div>
  );
}
