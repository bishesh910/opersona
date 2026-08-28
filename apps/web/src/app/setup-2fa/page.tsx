import { redirect } from 'next/navigation';
import Link from 'next/link';
import { requireSession } from '@/lib/session';
import { REQUIRE_2FA } from '@/lib/auth';
import { eq } from 'drizzle-orm';
import { db, schema } from '@opersona/db';
import { TwoFactorCard } from '@/components/settings/TwoFactorCard';
import { SignOutLink } from '@/components/shell/SignOutLink';

/** 2FA setup page. With REQUIRE_2FA=true it is a mandatory gate (the (app) layout
 *  redirects here); otherwise it's reached voluntarily from Settings' nudge. */
export default async function Setup2FAPage() {
  const s = await requireSession();
  const [own] = await db.select({ id: schema.clones.id }).from(schema.clones).where(eq(schema.clones.ownerUserId, s.userId)).limit(1);
  const dest = own ? '/me' : '/onboarding'; // persona not built yet → straight back to the builder
  if (s.twoFactorEnabled) redirect(dest);
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6">
      <div className="text-center">
        <div className="text-lg font-semibold tracking-tight">opersona.me</div>
        <p className="muted mt-1 text-sm">{REQUIRE_2FA ? 'Two-factor authentication is required to continue.' : 'Protect your account with two-factor authentication.'}</p>
      </div>
      <TwoFactorCard enabled={false} redirectTo={dest} email={s.user.email} />
      <p className="muted text-center text-xs">
        Use an authenticator app (Google Authenticator, Authy, 1Password…). Signed in as {s.user.email}. <SignOutLink />
      </p>
      {!REQUIRE_2FA && <p className="text-center text-xs"><Link className="muted underline underline-offset-2 hover:text-neutral-700 dark:hover:text-neutral-300" href={dest}>Skip for now</Link></p>}
    </div>
  );
}
