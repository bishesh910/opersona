'use client';
import { useState } from 'react';
import { signIn } from '@/lib/auth-client';

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.5-.3-2.2H12v4.1h6.5c-.1 1.1-.8 2.7-2.4 3.8l3.7 2.9c2.3-2.1 3.7-5.1 3.7-8.6z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.8-2.9c-1 .7-2.4 1.2-4.2 1.2-3.2 0-6-2.1-6.9-5.1l-3.9 3C3.2 21.3 7.3 24 12 24z" />
      <path fill="#FBBC05" d="M5.1 14.3c-.2-.7-.4-1.5-.4-2.3s.1-1.6.4-2.3l-4-3C.4 8.3 0 10.1 0 12s.4 3.7 1.2 5.3l3.9-3z" />
      <path fill="#EA4335" d="M12 4.7c2.3 0 3.8 1 4.7 1.8l3.4-3.3C18 1.2 15.2 0 12 0 7.3 0 3.2 2.7 1.2 6.7l3.9 3C6 6.8 8.8 4.7 12 4.7z" />
    </svg>
  );
}
function AppleIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M16.4 12.9c0-3 2.4-4.4 2.5-4.5-1.4-2-3.5-2.3-4.2-2.3-1.8-.2-3.5 1-4.4 1s-2.3-1-3.8-1c-2 0-3.8 1.1-4.8 2.9-2 3.6-.5 8.8 1.5 11.7 1 1.4 2.1 3 3.6 2.9 1.5-.1 2-.9 3.8-.9s2.3.9 3.8.9c1.6 0 2.6-1.4 3.5-2.8 1.1-1.6 1.6-3.2 1.6-3.3-.1 0-3.1-1.2-3.1-4.6zM13.6 4.2c.8-1 1.4-2.4 1.2-3.7-1.2 0-2.6.8-3.4 1.8-.8.9-1.4 2.3-1.2 3.6 1.3.1 2.6-.7 3.4-1.7z" /></svg>;
}

/** "Continue with …" buttons; rendered only for providers the server has credentials for. */
export function SocialButtons({ google, apple, label = 'Continue' }: { google: boolean; apple: boolean; label?: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  if (!google && !apple) return null;
  const go = async (provider: 'google' | 'apple') => {
    setBusy(provider);
    await signIn.social({ provider, callbackURL: '/me' }).catch(() => setBusy(null));
  };
  return (
    <div className="space-y-2">
      {google && (
        <button type="button" className="btn-secondary flex w-full items-center justify-center gap-2" disabled={!!busy} onClick={() => go('google')}>
          <GoogleIcon /> {busy === 'google' ? 'Redirecting…' : `${label} with Google`}
        </button>
      )}
      {apple && (
        <button type="button" className="btn-secondary flex w-full items-center justify-center gap-2" disabled={!!busy} onClick={() => go('apple')}>
          <AppleIcon /> {busy === 'apple' ? 'Redirecting…' : `${label} with Apple`}
        </button>
      )}
      <div className="flex items-center gap-3 py-1">
        <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
        <span className="muted text-xs">or {label.toLowerCase()} with email</span>
        <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
      </div>
    </div>
  );
}
