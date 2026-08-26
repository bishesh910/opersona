'use client';
import { stashPassword } from '@/lib/pw-relay';
import { PasswordInput } from './PasswordInput';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { authClient, signIn } from '@/lib/auth-client';
import { SocialButtons } from './SocialButtons';
import { NIGHT, ErrorNote } from './auth-styles';
import { usePixieMood } from './AuthPixie';

export function SignInForm({ social = { google: false, apple: false }, next, canReset = false }: { social?: { google: boolean; apple: boolean }; next?: string; canReset?: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [twoFactor, setTwoFactor] = useState(false);
  const [useBackup, setUseBackup] = useState(false);
  const [code, setCode] = useState('');

  // The card's Pixie ponders while the form works or waits on a 2FA code.
  const setMood = usePixieMood();
  useEffect(() => { setMood(busy || twoFactor ? 'thinking' : 'idle'); }, [busy, twoFactor, setMood]);

  function done() {
    router.push(next ?? '/chat');
    router.refresh();
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const res = await signIn.email({ email, password });
    if (!res.error) stashPassword(password);
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
      // key remounts on totp<->backup toggle so the entrance rise replays subtly
      <form key={useBackup ? 'backup' : 'totp'} onSubmit={onCodeSubmit} className="animate-[card-in_0.3s_ease-out] space-y-4 motion-reduce:animate-none">
        <header>
          <h1 className="text-xl font-semibold tracking-tight text-white">One more lock</h1>
          <p className="mt-1 text-sm text-neutral-400">{useBackup ? 'Enter one of your backup codes.' : 'Enter the 6-digit code from your authenticator app.'}</p>
        </header>
        <div>
          <label className={NIGHT.LABEL} htmlFor="tf-code">{useBackup ? 'Backup code' : 'Authentication code'}</label>
          {/* ONE input, never per-digit boxes — one-time-code autofill, autoFocus and paste depend on it. */}
          <input
            id="tf-code" required autoFocus
            autoComplete="one-time-code"
            className={useBackup ? NIGHT.BACKUP : NIGHT.OTP}
            {...(useBackup ? {} : { inputMode: 'numeric' as const, pattern: '[0-9]{6}', maxLength: 6, placeholder: '123456' })}
            value={code} onChange={(e) => setCode(e.target.value)}
          />
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
        <button className={NIGHT.BTN} disabled={busy}>{busy ? 'Verifying…' : 'Verify'}</button>
        <p className="text-center text-sm text-neutral-400">
          <button type="button" className={NIGHT.QUIET_BTN} onClick={() => { setUseBackup((v) => !v); setCode(''); setError(null); }}>
            {useBackup ? 'Use an authenticator code instead' : 'Use a backup code'}
          </button>
        </p>
        <p className="text-center text-sm text-neutral-400">
          <button type="button" className={NIGHT.QUIET_BTN} onClick={() => { setTwoFactor(false); setUseBackup(false); setCode(''); setPassword(''); setError(null); }}>
            Back to sign in
          </button>
        </p>
      </form>
    );
  }

  return (
    <form onSubmit={onSubmit} className="animate-[card-in_0.3s_ease-out] space-y-4 motion-reduce:animate-none">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-white">Welcome back</h1>
        <p className="mt-1 text-sm text-neutral-400">Your Pixie kept the lights on.</p>
      </header>
      <SocialButtons google={social.google} apple={social.apple} label="Continue" />
      <div>
        <label className={NIGHT.LABEL} htmlFor="email">Email</label>
        <input id="email" className={NIGHT.FIELD} type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <label className={NIGHT.LABEL} htmlFor="password">Password</label>
        <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="current-password" inputClassName={NIGHT.FIELD + ' pr-11'} buttonClassName={NIGHT.EYE} />
        {canReset && <p className="mt-1.5 text-right text-xs"><Link className={NIGHT.QUIET_BTN} href="/forgot-password">Forgot password?</Link></p>}
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      <button className={NIGHT.BTN} disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      <p className="pt-1 text-center text-sm text-neutral-400">
        New here?{' '}
        <Link className={NIGHT.LINK} href={next ? `/sign-up?next=${encodeURIComponent(next)}` : '/sign-up'}>Create your Pixie</Link>
      </p>
    </form>
  );
}
