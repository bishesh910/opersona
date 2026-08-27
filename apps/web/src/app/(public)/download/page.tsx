import Link from 'next/link';
import { getSessionCtx } from '@/lib/session';
import { CopyPill } from '@/components/community/CopyPill';

export const metadata = {
  title: 'Download — opersona',
  description: 'Download the opersona macOS app: Claude Code that thinks like you, running on your own machine.',
};
export const dynamic = 'force-dynamic';

export default async function DownloadPage() {
  const session = await getSessionCtx();
  return (
    <div className="mx-auto max-w-2xl space-y-8 py-4">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Download opersona</h1>
        <p className="text-lg">
          Claude Code that thinks like you. The app runs the real <code className="text-sm">claude</code> on
          your own machine, in a folder you pick, with your persona as its system prompt. Full tools, your own
          subscription, nothing on our servers.
        </p>
      </header>

      <section className="card space-y-4 p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-medium">macOS <span className="chip ml-1">Apple Silicon</span></h2>
            <p className="muted text-xs">Requires the <code>claude</code> CLI installed &amp; logged in.</p>
          </div>
          <a href="/download/opersona-app.dmg" className="btn-primary" data-app-download>Download .dmg</a>
        </div>
        <ol className="muted list-inside list-decimal space-y-2 text-sm">
          <li>Open the .dmg and drag <span className="font-medium">opersona</span> to Applications.</li>
          <li>
            Apple flags unsigned apps &ldquo;damaged&rdquo; — it isn&apos;t. Run once in Terminal:
            <span className="mt-1 block"><CopyPill text="xattr -cr /Applications/opersona.app" /></span>
          </li>
          <li>Open opersona, {session ? 'it loads your persona' : 'sign in'}, pick a folder, and hit Start.</li>
        </ol>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold tracking-tight">Prefer to run from source?</h2>
        <p className="muted text-sm">
          The app is open in the repo. On a Mac with the <code>claude</code> CLI:
        </p>
        <CopyPill text="cd apps/desktop && npm install && npm run dev" />
      </section>

      <footer className="muted border-t border-neutral-200 pt-4 text-xs dark:border-neutral-800">
        First time here? <Link href="/about" className="underline">What opersona is</Link> ·{' '}
        <Link href="/privacy" className="underline">Privacy, honestly</Link>
      </footer>
    </div>
  );
}
