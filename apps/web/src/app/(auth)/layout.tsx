import Link from 'next/link';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen bg-[#07070c] lg:flex">
      {/* desktop wordmark, top-left */}
      <Link href="/" className="absolute left-8 top-6 z-10 hidden text-xl font-semibold tracking-tight text-white lg:block">opersona.me</Link>
      {/* form column: whole screen on mobile/tablet, left column on desktop */}
      <div className="auth-bg flex min-h-screen w-full items-center justify-center p-6 lg:w-[44%] lg:flex-none">
        <div className="w-full max-w-sm">
          <Link href="/" className="mb-6 block text-center text-2xl font-semibold tracking-tight text-white drop-shadow-[0_1px_4px_rgba(0,0,0,0.8)] lg:hidden">opersona.me</Link>
          <div className="card bg-white/95 backdrop-blur-sm dark:bg-neutral-900/95">{children}</div>
        </div>
      </div>
      {/* the Pixie crowd, framed — desktop only */}
      <div className="hidden lg:flex lg:min-h-screen lg:flex-1 lg:p-5 lg:pl-0">
        <div className="auth-panel w-full self-stretch overflow-hidden rounded-3xl border border-neutral-800/80" />
      </div>
    </div>
  );
}
