import Link from 'next/link';
import { headers } from 'next/headers';
import { AuthPixieFrame } from '@/components/auth/AuthPixie';

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <div className="auth-bg relative flex min-h-screen items-center justify-center bg-[#07070c] p-6 lg:justify-start lg:pl-[7vw]">
      {/* The scene follows the visitor's clock: sunrise mornings, blue sky days, stars at night. */}
      <script nonce={nonce} dangerouslySetInnerHTML={{ __html: "(function(){try{var h=new Date().getHours();document.documentElement.setAttribute('data-daypart',h>=5&&h<11?'morning':h>=11&&h<18?'day':'night');}catch(e){}})()" }} />
      {/* desktop wordmark, top-left */}
      <Link href="/" className="absolute left-8 top-6 hidden text-xl font-semibold tracking-tight text-white lg:block">opersona.me</Link>
      <div className="w-full max-w-sm">
        {/* mb-16 clears the Pixie head peeking above the card on mobile */}
        <Link href="/" className="mb-24 block text-center text-2xl font-semibold tracking-tight text-white drop-shadow-[0_1px_4px_rgba(0,0,0,0.8)] lg:hidden">opersona.me</Link>
        <AuthPixieFrame>
          {/* Deliberately NOT `.card` — its dark styles need the .dark class, absent when the
              app theme is light. This card is always night: dark glass (/85 + blur so stars
              transmit) with a hard pixel drop shadow, one more building in the skyline.
              .night-card hooks the no-backdrop-filter fallback in globals.css. */}
          <div className="night-card relative rounded-lg border border-white/10 bg-[#141419]/85 p-6 text-neutral-100 shadow-[0_6px_0_0_rgba(4,5,12,0.55),0_36px_90px_-28px_rgba(0,0,0,0.9)] backdrop-blur-md [-webkit-backdrop-filter:blur(12px)] max-sm:p-5">
            {/* three office-window pixels; the lit one hard-blinks every ~7s */}
            <div aria-hidden className="absolute right-5 top-5 flex gap-1">
              <span className="win-blink h-1.5 w-1.5 bg-amber-300/90" />
              <span className="h-1.5 w-1.5 bg-[#2e2e38]" />
              <span className="h-1.5 w-1.5 bg-[#2e2e38]" />
            </div>
            {children}
          </div>
          <a href="/download" className="mt-4 flex items-center justify-center gap-2 text-center text-xs text-white/80 hover:text-white">
            <span aria-hidden>↓</span> Get the macOS app — Claude Code that thinks like you
          </a>
        </AuthPixieFrame>
      </div>
    </div>
  );
}
