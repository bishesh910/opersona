import Link from 'next/link';
import { getSessionCtx } from '@/lib/session';

/**
 * Shared header for the public community pages (/explore, /p/*) — they live
 * outside the app shell, so this is the door back in (or in for the first time).
 */
export async function CommunityHeader() {
  const session = await getSessionCtx();
  return (
    <nav className="flex items-center justify-between gap-3 pb-6">
      <Link href={session ? '/chat' : '/'} className="text-base font-semibold tracking-tight">opersona.me</Link>
      <div className="flex items-center gap-2 text-sm">
        <Link href="/privacy" className="muted mr-1 hidden text-xs hover:underline sm:inline">Privacy</Link>
        <Link href="/explore" className="btn-secondary btn-sm">Explore</Link>
        {session ? (
          <>
            <Link href="/me/share" className="btn-secondary btn-sm">Share my persona</Link>
            <Link href="/chat" className="btn-primary btn-sm">My workspace →</Link>
          </>
        ) : (
          <>
            <Link href="/sign-in" className="btn-secondary btn-sm">Sign in</Link>
            <Link href="/sign-up" className="btn-primary btn-sm">Create account</Link>
          </>
        )}
      </div>
    </nav>
  );
}
