'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { authClient } from '@/lib/auth-client';

type Stage =
  | { step: 'idle' }
  | { step: 'password'; mode: 'enable' | 'disable' }
  | { step: 'verify'; totpURI: string; secret: string; qrDataUrl: string; backupCodes: string[] }
  | { step: 'done-enabled' };

function secretFromUri(uri: string): string {
  try {
    return new URL(uri).searchParams.get('secret') ?? '';
  } catch {
    return '';
  }
}

export function TwoFactorCard({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>({ step: 'idle' });
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function onPasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (stage.step !== 'password') return;
    setBusy(true); setError(null);
    if (stage.mode === 'enable') {
      const res = await authClient.twoFactor.enable({ password });
      setBusy(false);
      if (res.error) { setError(res.error.message ?? 'Could not start two-factor setup'); return; }
      const totpURI = res.data.totpURI;
      const qrDataUrl = await QRCode.toDataURL(totpURI, { margin: 1, width: 192 });
      setPassword('');
      setStage({ step: 'verify', totpURI, secret: secretFromUri(totpURI), qrDataUrl, backupCodes: res.data.backupCodes });
    } else {
      const res = await authClient.twoFactor.disable({ password });
      setBusy(false);
      if (res.error) { setError(res.error.message ?? 'Could not disable two-factor'); return; }
      setPassword('');
      setStage({ step: 'idle' });
      router.refresh();
    }
  }

  async function onVerifySubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const res = await authClient.twoFactor.verifyTotp({ code: code.trim() });
    setBusy(false);
    if (res.error) { setError(res.error.message ?? 'Invalid code — try again'); return; }
    setCode('');
    setStage({ step: 'done-enabled' });
    router.refresh();
  }

  async function copySecret(secret: string) {
    try { await navigator.clipboard.writeText(secret); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ }
  }

  return (
    <section className="card space-y-3">
      <h2 className="font-medium">Two-factor authentication</h2>
      {enabled || stage.step === 'done-enabled' ? (
        <>
          <p className="text-sm"><span className="chip">Two-factor is on ✓</span> Signing in requires a code from your authenticator app.</p>
          {stage.step === 'password' && stage.mode === 'disable' ? (
            <form onSubmit={onPasswordSubmit} className="space-y-2">
              <div>
                <label className="label" htmlFor="tf-disable-password">Confirm your password to disable</label>
                <input id="tf-disable-password" className="input" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <div className="flex gap-2">
                <button className="btn-danger" disabled={busy}>{busy ? 'Disabling…' : 'Disable two-factor'}</button>
                <button type="button" className="btn-secondary" onClick={() => { setStage({ step: 'idle' }); setPassword(''); setError(null); }}>Cancel</button>
              </div>
            </form>
          ) : (
            <button type="button" className="btn-secondary" onClick={() => { setStage({ step: 'password', mode: 'disable' }); setError(null); }}>Disable</button>
          )}
        </>
      ) : stage.step === 'verify' ? (
        <div className="space-y-3">
          <p className="text-sm">Scan this QR code with your authenticator app (Google Authenticator, 1Password, Authy…):</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={stage.qrDataUrl} alt="TOTP QR code" width={192} height={192} className="rounded border border-black/10 bg-white p-1 dark:border-white/10" />
          <p className="muted text-xs">
            Can’t scan? Enter this secret manually:{' '}
            <code className="select-all break-all font-mono">{stage.secret}</code>{' '}
            <button type="button" className="underline" onClick={() => copySecret(stage.secret)}>{copied ? 'copied' : 'copy'}</button>
          </p>
          <div>
            <p className="text-sm font-medium">Backup codes — save these somewhere safe.</p>
            <p className="muted text-xs">Each works once if you lose access to your authenticator.</p>
            <ul className="mt-1 grid grid-cols-2 gap-x-4 font-mono text-sm sm:grid-cols-3" data-testid="backup-codes">
              {stage.backupCodes.map((c) => <li key={c} className="select-all">{c}</li>)}
            </ul>
          </div>
          <form onSubmit={onVerifySubmit} className="space-y-2">
            <div>
              <label className="label" htmlFor="tf-verify-code">Verify code to finish</label>
              <input
                id="tf-verify-code" className="input max-w-40" required
                inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6}
                placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-2">
              <button className="btn-primary" disabled={busy}>{busy ? 'Verifying…' : 'Verify & turn on'}</button>
              <button type="button" className="btn-secondary" onClick={() => { setStage({ step: 'idle' }); setCode(''); setError(null); }}>Cancel</button>
            </div>
          </form>
        </div>
      ) : stage.step === 'password' ? (
        <form onSubmit={onPasswordSubmit} className="space-y-2">
          <div>
            <label className="label" htmlFor="tf-enable-password">Confirm your password to continue</label>
            <input id="tf-enable-password" className="input" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button className="btn-primary" disabled={busy}>{busy ? 'Starting…' : 'Continue'}</button>
            <button type="button" className="btn-secondary" onClick={() => { setStage({ step: 'idle' }); setPassword(''); setError(null); }}>Cancel</button>
          </div>
        </form>
      ) : (
        <>
          <p className="muted text-sm">Protect your account with a one-time code from an authenticator app at sign-in.</p>
          <button type="button" className="btn-primary" onClick={() => { setStage({ step: 'password', mode: 'enable' }); setError(null); }}>Add an authenticator app</button>
        </>
      )}
    </section>
  );
}
