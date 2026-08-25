import Link from 'next/link';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-bg flex min-h-screen items-center justify-center bg-[#07070c] p-6">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-6 block text-center text-2xl font-semibold tracking-tight text-white drop-shadow-[0_1px_4px_rgba(0,0,0,0.8)]">opersona.me</Link>
        <div className="card bg-white/95 backdrop-blur-sm dark:bg-neutral-900/95">{children}</div>
      </div>
    </div>
  );
}
