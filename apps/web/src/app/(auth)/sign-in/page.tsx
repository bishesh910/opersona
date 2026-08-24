import { redirect } from 'next/navigation';
import { getSessionCtx } from '@/lib/session';
import { SignInForm } from '@/components/auth/SignInForm';
import { SOCIAL } from '@/lib/auth';

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next: rawNext } = await searchParams;
  // Only same-site paths (e.g. back to an invite link).
  const next = rawNext && /^\/(?!\/)/.test(rawNext) ? rawNext : undefined;
  if (await getSessionCtx()) redirect(next ?? '/clones');
  return <SignInForm social={SOCIAL} next={next} />;
}
