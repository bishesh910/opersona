'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth-client';
import { PasswordInput } from './PasswordInput';
import { NIGHT, ErrorNote } from './auth-styles';

export function ResetPasswordForm({ token, invalid }: { token: string; invalid: boolean }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (invalid) {
    return (
      <div className="space-y-3">
        <h1 className="text-xl font-semibold tracking-tight text-white">This link has expired</h1>
        <p className="text-sm text-neutral-400">Reset links are single-use and expire after an hour. Request a fresh one and try again.</p>
        <p className="text-sm"><Link className={NIGHT.LINK} href="/forgot-password">Request a new link</Link></p>
      </div>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError('Passwords do not match'); return; }
    setBusy(true); setError(null);
    const res = await authClient.resetPassword({ newPassword: password, token });
    setBusy(false);
    if (res.error) { setError(res.error.message ?? 'Could not reset the password'); return; }
    router.push('/sign-in');
  }

  return (
    <form onSubmit={onSubmit} className="animate-[card-in_0.3s_ease-out] space-y-4 motion-reduce:animate-none">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-white">Set a new password</h1>
        <p className="mt-1 text-sm text-neutral-400">At least 10 characters. Your other sessions stay signed in.</p>
      </header>
      <div>
        <label className={NIGHT.LABEL} htmlFor="password">New password</label>
        <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="new-password" minLength={10} inputClassName={NIGHT.FIELD + ' pr-11'} buttonClassName={NIGHT.EYE} />
      </div>
      <div>
        <label className={NIGHT.LABEL} htmlFor="confirm">Confirm password</label>
        <PasswordInput id="confirm" value={confirm} onChange={setConfirm} autoComplete="new-password" minLength={10} inputClassName={NIGHT.FIELD + ' pr-11'} buttonClassName={NIGHT.EYE} />
        {confirm.length > 0 && confirm !== password && <p className="mt-1.5 text-xs text-red-300">Passwords don&apos;t match yet.</p>}
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      <button className={NIGHT.BTN} disabled={busy}>{busy ? 'Saving…' : 'Set new password'}</button>
    </form>
  );
}
