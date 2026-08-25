'use client';
import { PasswordInput } from './PasswordInput';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { authClient, signIn } from '@/lib/auth-client';
import { SocialButtons } from './SocialButtons';

export function SignInForm({ social = { google: false, apple: false }, next }: { social?: { google: boolean; apple: boolean }; next?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [twoFactor, setTwoFactor] = useState(false);
  const [useBackup, setUseBackup] = useState(false);
  const [code, setCode] = useState('');

  function done() {
    router.push(next ?? '/clones');
    router.refresh();
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const res = await signIn.email({ email, password });
    setBusy(false);
    if (res.error) { setError(res.error.message ?? 'Sign-in failed'); return; }
    if ((res.data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) {
      setTwoFactor(true);
      return;
    }
    done();
  }

  async function onCodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const trimmed = code.trim();
    const res = useBackup
      ? await authClient.twoFactor.verifyBackupCode({ code: trimmed })
      : await authClient.twoFactor.verifyTotp({ code: trimmed });
    setBusy(false);
    if (res.error) { setError(res.error.message ?? 'Invalid code'); return; }
    done();
  }

  if (twoFactor) {
    return (
      <form onSubmit={onCodeSubmit} className="space-y-3">
        <h1 className="text-lg font-semibold">Two-factor authentication</h1>
        <p className="muted text-sm">{useBackup ? 'Enter one of your backup codes.' : 'Enter the 6-digit code from your authenticator app.'}</p>
        <div>
          <label className="label" htmlFor="tf-code">{useBackup ? 'Backup code' : 'Authentication code'}</label>
          <input
            id="tf-code" className="input" required autoFocus
            autoComplete="one-time-code"
            {...(useBackup ? {} : { inputMode: 'numeric' as const, pattern: '[0-9]{6}', maxLength: 6, placeholder: '123456' })}
            value={code} onChange={(e) => setCode(e.target.value)}
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Verifying…' : 'Verify'}</button>
        <p className="muted text-center text-sm">
          <button type="button" className="underline" onClick={() => { setUseBackup((v) => !v); setCode(''); setError(null); }}>
            {useBackup ? 'Use an authenticator code instead' : 'Use a backup code'}
          </button>
        </p>
        <p className="muted text-center text-sm">
          <button type="button" className="underline" onClick={() => { setTwoFactor(false); setUseBackup(false); setCode(''); setPassword(''); setError(null); }}>
            Back to sign in
          </button>
        </p>
      </form>
    );
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
        <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="current-password" />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button className="btn-primary w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      <p className="muted text-center text-sm">No account? <Link className="underline" href={next ? `/sign-up?next=${encodeURIComponent(next)}` : '/sign-up'}>Sign up</Link></p>
    </form>
  );
}
