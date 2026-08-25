'use client';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { PasswordInput } from '@/components/auth/PasswordInput';

/** Self-service password change: current password → new + confirm. */
export function ChangePasswordCard() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) { setMsg({ ok: false, text: 'New passwords do not match' }); return; }
    setBusy(true); setMsg(null);
    const res = await authClient.changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: true });
    setBusy(false);
    if (res.error) setMsg({ ok: false, text: res.error.message ?? 'Could not change the password' });
    else { setMsg({ ok: true, text: 'Password changed. Other devices were signed out.' }); setCurrent(''); setNext(''); setConfirm(''); }
  };

  return (
    <section className="card">
      <h2 className="font-medium">Change password</h2>
      <form onSubmit={submit} className="mt-2 max-w-sm space-y-3">
        <div>
          <label className="label" htmlFor="pw-current">Current password</label>
          <PasswordInput id="pw-current" value={current} onChange={setCurrent} autoComplete="current-password" />
        </div>
        <div>
          <label className="label" htmlFor="pw-new">New password</label>
          <PasswordInput id="pw-new" value={next} onChange={setNext} autoComplete="new-password" minLength={8} />
        </div>
        <div>
          <label className="label" htmlFor="pw-confirm">Confirm new password</label>
          <PasswordInput id="pw-confirm" value={confirm} onChange={setConfirm} autoComplete="new-password" minLength={8} />
          {confirm.length > 0 && confirm !== next && <p className="mt-1 text-xs text-red-600">Passwords don&apos;t match yet.</p>}
        </div>
        <div className="flex items-center gap-3">
          <button className="btn-primary" disabled={busy}>{busy ? 'Changing…' : 'Change password'}</button>
          {msg && <span className={`text-sm ${msg.ok ? 'text-green-700 dark:text-green-400' : 'text-red-600'}`}>{msg.text}</span>}
        </div>
      </form>
    </section>
  );
}
