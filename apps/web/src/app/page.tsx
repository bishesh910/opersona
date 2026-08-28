import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSessionCtx } from '@/lib/session';
import { AuthPixieFrame } from '@/components/auth/AuthPixie';

export const metadata: Metadata = {
  title: 'opersona — build an AI that knows how you think',
  description:
    'opersona learns your preferences, values, memories, decisions and behavioural patterns — from your own conversations and work — into a persona that is evidence-backed, testable, and yours.',
};

/** The Night Shift look from the auth pages, worn by the front door: same starry
 *  pixel skyline, same glass night-cards, same pixie peeking over the edge.
 *  Deliberately always-night (independent of the app theme), like sign-in. */

const CTA_PRIMARY =
  'inline-flex h-12 select-none items-center justify-center rounded-md border border-[#c8c2ac]/60 bg-[#e2decd] px-6 text-[15px] ' +
  'font-bold text-[#1c1917] shadow-[0_4px_0_0_#57534e] transition-[transform,box-shadow,background-color] duration-100 ' +
  'hover:bg-[#efecdf] active:translate-y-[3px] active:shadow-[0_1px_0_0_#57534e] motion-reduce:transition-none';
const CTA_QUIET =
  'inline-flex h-12 items-center justify-center rounded-md border-2 border-[#30303a] bg-[#1a1a20]/80 px-5 text-[15px] ' +
  'font-semibold text-neutral-200 transition-colors hover:border-[#e2decd]/40 hover:text-white';
const GLASS_CARD =
  'night-card rounded-lg border border-white/10 bg-[#141419]/80 p-5 text-neutral-100 ' +
  'shadow-[0_6px_0_0_rgba(4,5,12,0.55),0_28px_70px_-28px_rgba(0,0,0,0.9)] backdrop-blur-md [-webkit-backdrop-filter:blur(12px)]';

function Windows() {
  return (
    <div aria-hidden className="absolute right-5 top-5 flex gap-1">
      <span className="win-blink h-1.5 w-1.5 bg-amber-300/90" />
      <span className="h-1.5 w-1.5 bg-[#2e2e38]" />
      <span className="h-1.5 w-1.5 bg-[#2e2e38]" />
    </div>
  );
}

export default async function Home() {
  const session = await getSessionCtx();
  if (session) redirect('/me');
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <div className="auth-bg relative min-h-dvh bg-[#07070c] text-neutral-100">
      {/* The scene follows the visitor's clock: sunrise mornings, blue sky days, stars at night. */}
      <script nonce={nonce} dangerouslySetInnerHTML={{ __html: "(function(){try{var h=new Date().getHours();document.documentElement.setAttribute('data-daypart',h>=5&&h<11?'morning':h>=11&&h<18?'day':'night');}catch(e){}})()" }} />
      {/* Scrim: the backdrop's pixie crowd stays a faint skyline, never the show —
          bottom-heavy so the sky and stars up top survive. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#07070c]/30 via-[#07070c]/55 to-[#07070c]/90" />
      <div className="relative mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-5 py-6 sm:px-8">
        <nav className="flex items-center justify-between gap-3">
          <span className="text-xl font-semibold tracking-tight text-white drop-shadow-[0_1px_4px_rgba(0,0,0,0.8)]">opersona.me</span>
          <div className="flex items-center gap-2 text-sm">
            <Link href="/about" className="rounded-md px-3 py-2 font-medium text-neutral-300 transition-colors hover:text-white">About</Link>
            <Link href="/privacy" className="hidden rounded-md px-3 py-2 font-medium text-neutral-300 transition-colors hover:text-white sm:inline-flex">Privacy</Link>
            <Link href="/sign-in" className={CTA_QUIET + ' !h-10 !px-4 text-sm'}>Sign in</Link>
          </div>
        </nav>

        <main className="flex flex-1 flex-col justify-center py-14 sm:py-16">
          <div className="mx-auto w-full max-w-xl">
            <AuthPixieFrame>
              <div className={GLASS_CARD + ' relative p-7 max-sm:p-5'}>
                <Windows />
                <h1 className="max-w-md text-3xl font-semibold leading-tight tracking-tight text-white sm:text-4xl">
                  Build an AI that knows how you think.
                </h1>
                <p className="mt-4 max-w-md text-[15px] leading-relaxed text-neutral-300">
                  opersona learns your preferences, values, memories, decisions and behavioural
                  patterns — from your own words — into a persona you can question, test, and correct.
                </p>
                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <Link href="/sign-up" className={CTA_PRIMARY}>Build my persona</Link>
                  <Link href="/about" className={CTA_QUIET}>See how it works</Link>
                </div>
                <p className="mt-5 font-mono text-[11px] tracking-wide text-neutral-500">
                  interview → model → predict → test → correct → <span className="text-neutral-300">predict better</span>
                </p>
              </div>
            </AuthPixieFrame>
          </div>
        </main>

        <section className="grid gap-4 pb-10 sm:grid-cols-3">
          <div className={GLASS_CARD}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-300/90">the interview</p>
            <h2 className="mt-2 font-semibold text-white">Teach it who you are</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-neutral-400">
              An adaptive interview asks about real moments — decisions, conflicts, money, people —
              and follows the threads your answers open, including the ones that don&rsquo;t quite add up.
            </p>
          </div>
          <div className={GLASS_CARD}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-300/90">evidence-backed</p>
            <h2 className="mt-2 font-semibold text-white">Every claim shows its receipts</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-neutral-400">
              What it learns is labelled honestly — <em>you said this</em>, <em>observed</em>, or a{' '}
              <em>hunch</em> — with your own words one tap away and &ldquo;that&rsquo;s me / not
              me&rdquo; everywhere.
            </p>
          </div>
          <div className={GLASS_CARD}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-300/90">tested blind</p>
            <h2 className="mt-2 font-semibold text-white">It has to prove it knows you</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-neutral-400">
              Fresh scenarios, predicted blind before you answer, scored on decision, reasoning and
              style. Every miss you correct makes it more you.
            </p>
          </div>
        </section>

        <footer className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-white/10 py-5 text-xs text-neutral-500">
          <span>Runs on your own Claude · chats sealable with a key only you hold · deletes completely when you say so</span>
          <span className="ml-auto flex gap-4">
            <Link href="/privacy" className="transition-colors hover:text-neutral-300">Privacy</Link>
            <Link href="/about" className="transition-colors hover:text-neutral-300">About</Link>
          </span>
        </footer>
      </div>
    </div>
  );
}
