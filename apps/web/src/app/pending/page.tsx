import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionCtx } from '@/lib/session';
import { SignOutButton } from '@/components/auth/SignOutButton';

export const metadata = { title: 'Almost in — opersona' };
export const dynamic = 'force-dynamic';

/** The admission waiting room: signed up, verified, waiting for a human yes. */
export default async function PendingPage() {
  const s = await getSessionCtx();
  if (!s) redirect('/sign-in');
  if (s.approved) redirect('/chat');
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 px-5 py-10">
      {/* re-check every 30s so approval kicks in without a manual reload */}
      <meta httpEquiv="refresh" content="30" />
      <p className="text-4xl" aria-hidden>⏳</p>
      <h1 className="text-2xl font-semibold tracking-tight">You&apos;re on the list</h1>
      <p className="text-sm">
        opersona is letting people in gradually — every account is approved by a human before
        it opens. You don&apos;t need to do anything: this page refreshes itself, and the moment
        you&apos;re approved it takes you straight in.
      </p>
      <div className="card space-y-1.5 p-4 text-sm">
        <p>Signed up as <span className="font-medium">{s.user.email}</span></p>
        <p className="muted text-xs">Wrong address? Sign out and register again with the right one.</p>
      </div>
      <div className="flex items-center gap-3">
        <SignOutButton />
        <Link href="/privacy" className="muted text-xs hover:underline">Privacy, honestly</Link>
      </div>
    </div>
  );
}
