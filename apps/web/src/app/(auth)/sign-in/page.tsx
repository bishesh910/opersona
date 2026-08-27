import { redirect } from 'next/navigation';
import { getSessionCtx } from '@/lib/session';
import { SignInForm } from '@/components/auth/SignInForm';
import { SOCIAL } from '@/lib/auth';
import { MAILER_ON } from '@/lib/email';

/** Params the OAuth signed-query machinery adds; stripped before resuming authorize. */
const OAUTH_INTERNAL = new Set(['sig', 'exp', 'ba_iat', 'ba_pl', 'ba_param']);

export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  let rawNext = typeof params.next === 'string' ? params.next : undefined;
  // Landed here mid-OAuth (claude.ai connector flow, signed query attached):
  // after sign-in, resume the authorize request with the original parameters.
  if (!rawNext && typeof params.client_id === 'string' && typeof params.response_type === 'string') {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (OAUTH_INTERNAL.has(k)) continue;
      for (const val of Array.isArray(v) ? v : v != null ? [v] : []) q.append(k, val);
    }
    rawNext = `/api/auth/oauth2/authorize?${q.toString()}`;
  }
  // Only same-site paths (e.g. back to an invite link).
  const next = rawNext && /^\/(?!\/)/.test(rawNext) ? rawNext : undefined;
  if (await getSessionCtx()) redirect(next ?? '/opersonas');
  return <SignInForm social={SOCIAL} next={next} canReset={MAILER_ON} />;
}
