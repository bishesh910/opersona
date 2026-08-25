import Link from 'next/link';
import { AuthPixieFrame } from '@/components/auth/AuthPixie';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-bg relative flex min-h-screen items-center justify-center bg-[#07070c] p-6 lg:justify-start lg:pl-[7vw]">
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
          <div className="night-card relative rounded-lg border border-white/10 bg-[#0e1322]/85 p-6 text-neutral-100 shadow-[0_6px_0_0_rgba(4,5,12,0.55),0_36px_90px_-28px_rgba(0,0,0,0.9)] backdrop-blur-md [-webkit-backdrop-filter:blur(12px)] max-sm:p-5">
            {/* three office-window pixels; the lit one hard-blinks every ~7s */}
            <div aria-hidden className="absolute right-5 top-5 flex gap-1">
              <span className="win-blink h-1.5 w-1.5 bg-amber-300/90" />
              <span className="h-1.5 w-1.5 bg-[#2a3050]" />
              <span className="h-1.5 w-1.5 bg-[#2a3050]" />
            </div>
            {children}
          </div>
        </AuthPixieFrame>
      </div>
    </div>
  );
}
