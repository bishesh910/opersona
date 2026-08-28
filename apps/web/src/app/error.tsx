'use client';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-white px-4 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <div className="card w-full max-w-sm space-y-3 p-6 text-center">
        <h1 className="font-medium">Something broke on our side.</h1>
        <p className="muted text-sm">
          The error is logged{error.digest ? ` (ref ${error.digest})` : ''}. Your data is fine — try again.
        </p>
        <div className="flex justify-center gap-2 pt-1">
          <button type="button" className="btn-primary btn-sm" onClick={reset}>Try again</button>
          <a href="/" className="btn-secondary btn-sm">Go home</a>
        </div>
      </div>
    </main>
  );
}
