'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signUp } from '@/lib/auth-client';
import { SocialButtons } from './SocialButtons';

export function SignUpForm({ social = { google: false, apple: false }, next, prefillEmail, lockEmail = false }: { social?: { google: boolean; apple: boolean }; next?: string; prefillEmail?: string; lockEmail?: boolean }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState(prefillEmail ?? '');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    if (password !== confirm) { setError('Passwords do not match'); setBusy(false); return; }
    const res = await signUp.email({ name, email, password });
    setBusy(false);
    if (res.error) { setError(res.error.message ?? 'Sign-up failed'); return; }
    router.push(next ?? '/onboarding');
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <h1 className="text-lg font-semibold">Create your account</h1>
      <SocialButtons google={social.google} apple={social.apple} label="Sign up" />
      <div>
        <label className="label" htmlFor="name">Name</label>
        <input id="name" className="input" required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input id="email" className="input read-only:opacity-70" type="email" required autoComplete="email" value={email} readOnly={lockEmail} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="password">Password</label>
        <div className="relative">
          <input id="password" className="input pr-16" type={showPw ? 'text' : 'password'} required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button type="button" className="absolute inset-y-0 right-2 my-auto text-xs font-medium text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? 'Hide password' : 'Show password'}>
            {showPw ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>
      <div>
        <label className="label" htmlFor="confirm">Confirm password</label>
        <input id="confirm" className="input" type={showPw ? 'text' : 'password'} required minLength={8} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {confirm.length > 0 && confirm !== password && <p className="mt-1 text-xs text-red-600">Passwords don&apos;t match yet.</p>}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button className="btn-primary w-full" disabled={busy}>{busy ? 'Creating…' : 'Sign up'}</button>
      <p className="muted text-center text-sm">Have an account? <Link className="underline" href={next ? `/sign-in?next=${encodeURIComponent(next)}` : '/sign-in'}>Sign in</Link></p>
    </form>
  );
}
