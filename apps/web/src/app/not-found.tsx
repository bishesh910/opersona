import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-white px-4 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <div className="card w-full max-w-sm space-y-3 p-6 text-center">
        <p className="font-mono text-3xl">404</p>
        <h1 className="font-medium">Nothing lives at this address.</h1>
        <p className="muted text-sm">The page moved, was unpublished, or never existed.</p>
        <div className="flex justify-center gap-2 pt-1">
          <Link href="/" className="btn-primary btn-sm">Go home</Link>
          <Link href="/about" className="btn-secondary btn-sm">About</Link>
        </div>
      </div>
    </main>
  );
}
