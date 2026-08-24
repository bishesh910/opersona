'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signIn } from '@/lib/auth-client';
import { SocialButtons } from './SocialButtons';

export function SignInForm({ social = { google: false, apple: false }, next }: { social?: { google: boolean; apple: boolean }; next?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const res = await signIn.email({ email, password });
    setBusy(false);
    if (res.error) { setError(res.error.message ?? 'Sign-in failed'); return; }
    router.push(next ?? '/clones');
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <h1 className="text-lg font-semibold">Sign in</h1>
      <SocialButtons google={social.google} apple={social.apple} label="Continue" />
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input id="email" className="input" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="password">Password</label>
        <input id="password" className="input" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button className="btn-primary w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      <p className="muted text-center text-sm">No account? <Link className="underline" href={next ? `/sign-up?next=${encodeURIComponent(next)}` : '/sign-up'}>Sign up</Link></p>
    </form>
  );
}
