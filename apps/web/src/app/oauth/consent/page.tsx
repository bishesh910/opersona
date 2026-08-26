import { redirect } from 'next/navigation';
import { getSessionCtx } from '@/lib/session';
import { ConsentCard } from '@/components/auth/ConsentCard';

export const metadata = { title: 'Authorize access' };
export const dynamic = 'force-dynamic';

/**
 * OAuth consent — where the authorize flow lands when a client (claude.ai)
 * needs the signed-in user's approval. The signed query it arrives with is
 * posted back verbatim to /api/auth/oauth2/consent; the page never interprets
 * it beyond display.
 */
export default async function ConsentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const str = (k: string) => (typeof params[k] === 'string' ? (params[k] as string) : '');
  if (!str('client_id')) redirect('/'); // not an OAuth landing
  const s = await getSessionCtx();
  if (!s) {
    // Signed out mid-flow: sign in, then come straight back with the signed query intact.
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) for (const val of Array.isArray(v) ? v : v != null ? [v] : []) q.append(k, val);
    redirect(`/sign-in?next=${encodeURIComponent(`/oauth/consent?${q.toString()}`)}`);
  }
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6">
      <div className="text-center">
        <div className="text-lg font-semibold tracking-tight">opersona.me</div>
        <p className="muted mt-1 text-sm">Signed in as {s.user.email}</p>
      </div>
      <ConsentCard clientId={str('client_id')} clientName={str('client_name')} scope={str('scope')} />
    </div>
  );
}
