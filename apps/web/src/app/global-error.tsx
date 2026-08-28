'use client';

/** Last-resort boundary (root layout itself crashed) — must render its own <html>. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ display: 'flex', minHeight: '100dvh', alignItems: 'center', justifyContent: 'center', fontFamily: 'ui-sans-serif, system-ui, sans-serif', background: '#0a0a0a', color: '#e5e5e5' }}>
        <div style={{ textAlign: 'center', padding: 24 }}>
          <h1 style={{ fontSize: 16, fontWeight: 500 }}>opersona hit an unexpected error.</h1>
          <p style={{ fontSize: 13, opacity: 0.7, margin: '8px 0 16px' }}>
            It is logged{error.digest ? ` (ref ${error.digest})` : ''}. Your data is fine.
          </p>
          <button type="button" onClick={reset} style={{ font: 'inherit', fontSize: 13, padding: '6px 14px', borderRadius: 6, border: '1px solid #525252', background: 'transparent', color: 'inherit', cursor: 'pointer' }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
