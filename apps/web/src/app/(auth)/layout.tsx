import Link from 'next/link';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 p-6 dark:bg-neutral-950">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-6 block text-center text-2xl font-semibold tracking-tight">opersona.me</Link>
        <div className="card">{children}</div>
      </div>
    </div>
  );
}
