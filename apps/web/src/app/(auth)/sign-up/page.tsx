import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionCtx } from '@/lib/session';
import { SIGNUP_OPEN, SOCIAL } from '@/lib/auth';
import { SignUpForm } from '@/components/auth/SignUpForm';

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ next?: string; email?: string }> }) {
  const { next: rawNext, email: prefillEmail } = await searchParams;
  const next = rawNext && /^\/(?!\/)/.test(rawNext) ? rawNext : undefined;
  const invited = !!next && next.startsWith('/accept-invite/');
  if (await getSessionCtx()) redirect(next ?? '/chat');
  if (!SIGNUP_OPEN && !invited) {
    return (
      <div className="card space-y-2 text-sm">
        <h1 className="text-lg font-semibold">Sign-ups are closed</h1>
        <p className="muted">Ask your organization&apos;s owner for an invitation.</p>
        <Link href="/sign-in" className="underline">Sign in</Link>
      </div>
    );
  }
  return (
    <>
      <SignUpForm social={SOCIAL} next={next} prefillEmail={typeof prefillEmail === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(prefillEmail) ? prefillEmail : undefined} />
      <p className="muted mt-4 text-center text-xs">Sign up and build your persona — face, story, mind.</p>
    </>
  );
}
