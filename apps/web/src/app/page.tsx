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
        <section className="grid gap-4 sm:grid-cols-3">
          <div className="card space-y-2 p-5">
            <span className="chip">the interview</span>
            <h2 className="font-medium">Teach it who you are</h2>
            <p className="muted text-sm">
              An adaptive interview asks about real moments — decisions, conflicts, money, people —
              and follows the threads your answers open, including the ones that don&rsquo;t quite add up.
            </p>
          </div>
          <div className="card space-y-2 p-5">
            <span className="chip">evidence-backed</span>
            <h2 className="font-medium">Every claim shows its receipts</h2>
            <p className="muted text-sm">
              What it learns is labelled honestly — <em>you said this</em>, <em>observed</em>, or just
              a <em>hunch</em> — with your own words one tap away, and &ldquo;that&rsquo;s me / not
              me&rdquo; buttons everywhere.
            </p>
          </div>
          <div className="card space-y-2 p-5">
            <span className="chip">tested blind</span>
            <h2 className="font-medium">It has to prove it knows you</h2>
            <p className="muted text-sm">
              Fresh scenarios, predicted blind before you answer, scored on decision, reasoning and
              style. Every miss you correct makes it more you.
            </p>
          </div>
        </section>
        <section className="py-10">
          <p className="muted mx-auto flex max-w-xl flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center font-mono text-xs">
            {['interview', 'model', 'predict', 'test', 'correct', 'predict better'].map((s, i) => (
              <span key={s} className="inline-flex items-center gap-2">
                {i > 0 && <span aria-hidden className="opacity-40">→</span>}
                <span className={i === 5 ? 'font-medium text-neutral-700 dark:text-neutral-300' : ''}>{s}</span>
              </span>
            ))}
          </p>
          <p className="muted mt-3 text-center text-sm">
            The loop the whole product bends toward: does it actually get better at predicting you?
            It also runs on your own Claude, seals raw chats with a key only you hold, and deletes
            completely when you say so.
          </p>
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
