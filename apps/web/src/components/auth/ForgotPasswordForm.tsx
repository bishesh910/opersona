'use client';
import { useState } from 'react';
import Link from 'next/link';
import { authClient } from '@/lib/auth-client';
import { NIGHT, ErrorNote } from './auth-styles';

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const res = await authClient.requestPasswordReset({ email, redirectTo: '/reset-password' });
    setBusy(false);
    if (res.error) { setError(res.error.message ?? 'Could not send the reset email'); return; }
    setSent(true); // same message whether or not the account exists — no user enumeration
  }

  if (sent) {
    return (
      <div className="animate-[card-in_0.3s_ease-out] space-y-3 motion-reduce:animate-none">
        <h1 className="text-xl font-semibold tracking-tight text-white">Check your inbox</h1>
        <p className="text-sm text-neutral-400">If an account exists for <span className="text-neutral-200">{email}</span>, a reset link is on its way. It expires in an hour.</p>
        <p className="text-sm text-neutral-400"><Link className={NIGHT.LINK} href="/sign-in">Back to sign in</Link></p>
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} className="animate-[card-in_0.3s_ease-out] space-y-4 motion-reduce:animate-none">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-white">Forgot your password?</h1>
        <p className="mt-1 text-sm text-neutral-400">We&apos;ll email you a link to set a new one.</p>
      </header>
      <div>
        <label className={NIGHT.LABEL} htmlFor="email">Email</label>
        <input id="email" className={NIGHT.FIELD} type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      <button className={NIGHT.BTN} disabled={busy}>{busy ? 'Sending…' : 'Email me a reset link'}</button>
      <p className="pt-1 text-center text-sm text-neutral-400"><Link className={NIGHT.LINK} href="/sign-in">Back to sign in</Link></p>
    </form>
  );
}
