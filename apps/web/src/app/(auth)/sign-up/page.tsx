import Link from 'next/link';
import { redirect } from 'next/navigation';
import { and, eq, gt } from 'drizzle-orm';
import { db, authSchema } from '@opersona/db';
import { getSessionCtx } from '@/lib/session';
import { SIGNUP_OPEN, SOCIAL } from '@/lib/auth';
import { SignUpForm } from '@/components/auth/SignUpForm';

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ next?: string; email?: string }> }) {
  const { next: rawNext } = await searchParams;
  const next = rawNext && /^\/(?!\/)/.test(rawNext) ? rawNext : undefined;
  // The form is reachable ONLY through a real, live invitation: the invite id in `next`
  // is verified against the database and its email becomes the (locked) signup email.
  const invId = next?.match(/^\/accept-invite\/([\w-]{1,64})$/)?.[1];
  const [inv] = invId
    ? await db.select({ email: authSchema.invitation.email }).from(authSchema.invitation)
        .where(and(eq(authSchema.invitation.id, invId), eq(authSchema.invitation.status, 'pending'), gt(authSchema.invitation.expiresAt, new Date()))).limit(1)
    : [];
  const invited = !!inv;
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
      <SignUpForm social={SOCIAL} next={next} prefillEmail={inv?.email} lockEmail={invited} />
      <p className="muted mt-4 text-center text-xs">Sign up and build your persona — face, story, mind.</p>
    </>
  );
}
