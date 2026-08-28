import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionCtx } from '@/lib/session';
import { CommunityHeader } from '@/components/community/CommunityHeader';

export const metadata: Metadata = {
  title: 'opersona — build an AI that knows how you think',
  description:
    'opersona learns your preferences, values, memories, decisions and behavioural patterns — from your own conversations and work — into a persona that is evidence-backed, testable, and yours.',
};

/** A quiet nod to the pixie avatars: five square "pixels" fading in and out. */
function PixelDivider() {
  return (
    <div aria-hidden="true" className="flex items-center gap-1">
      {['opacity-25', 'opacity-50', 'opacity-100', 'opacity-50', 'opacity-25'].map((o, i) => (
        <span key={i} className={`h-1.5 w-1.5 bg-neutral-400 dark:bg-neutral-600 ${o}`} />
      ))}
    </div>
  );
}

export default async function Home() {
  const session = await getSessionCtx();
  if (session) redirect('/me');
  return (
    <div className="min-h-dvh bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <main className="mx-auto max-w-3xl px-4 py-6 sm:py-10">
        <CommunityHeader />
        <section className="space-y-6 py-10 sm:py-16">
          <h1 className="max-w-xl text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            Build an AI that knows how you think.
          </h1>
          <p className="muted max-w-xl text-base sm:text-lg">
            opersona learns your preferences, values, memories, decisions and behavioural patterns —
            from your own conversations and work — and turns them into a persona you can question,
            test, and correct.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/sign-up" className="btn-primary">Build my persona</Link>
            <Link href="/about" className="btn-secondary">See how it works</Link>
          </div>
          <PixelDivider />
        </section>
        <section className="grid gap-4 pb-12 sm:grid-cols-3">
          <div className="card space-y-2 p-5">
            <span className="chip">learns you</span>
            <h2 className="font-medium">How you think, not just what you said</h2>
            <p className="muted text-sm">
              Your persona distills reasoning patterns, confirmed facts and playbooks from the
              conversations and work you were doing anyway.
            </p>
          </div>
          <div className="card space-y-2 p-5">
            <span className="chip">evidence-backed</span>
            <h2 className="font-medium">Every pattern shows its receipts</h2>
            <p className="muted text-sm">
              Nothing is asserted without your own words behind it. You see the evidence, and you
              confirm or reject what it learned — &ldquo;that&rsquo;s me&rdquo; or &ldquo;not me&rdquo;.
            </p>
          </div>
          <div className="card space-y-2 p-5">
            <span className="chip">yours</span>
            <h2 className="font-medium">Private by design</h2>
            <p className="muted text-sm">
              It runs on your own Claude, raw chats can be sealed with a key only you hold, and your
              persona is shared only when you decide, on your terms.
            </p>
          </div>
        </section>
        <footer className="muted flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-neutral-200 pt-6 text-xs dark:border-neutral-800">
          <Link href="/explore" className="hover:underline">Explore shared personas</Link>
          <Link href="/about" className="hover:underline">About</Link>
          <Link href="/privacy" className="hover:underline">Privacy</Link>
          <span className="ml-auto">opersona.me</span>
        </footer>
      </main>
    </div>
  );
}
