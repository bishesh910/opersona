import { redirect } from 'next/navigation';
import Link from 'next/link';
import { requireSession } from '@/lib/session';
import { TwoFactorCard } from '@/components/settings/TwoFactorCard';
import { SignOutLink } from '@/components/shell/SignOutLink';

/** Mandatory 2FA gate: reached when a signed-in user has no 2FA. Not inside (app),
 *  so it isn't caught by the gate that redirects here. */
export default async function Setup2FAPage() {
  const s = await requireSession();
  if (s.twoFactorEnabled) redirect('/chat');
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6">
      <div className="text-center">
        <div className="text-lg font-semibold tracking-tight">opersona</div>
        <p className="muted mt-1 text-sm">Two-factor authentication is required to continue.</p>
      </div>
      <TwoFactorCard enabled={false} redirectTo="/chat" />
      <p className="muted text-center text-xs">
        Use an authenticator app (Google Authenticator, Authy, 1Password…). Signed in as {s.user.email}. <SignOutLink />
      </p>
    </div>
  );
}
