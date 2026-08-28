'use client';
/**
 * The privacy page's promise, kept: permanent, self-serve deletion. Persona
 * deletion sweeps every table that references it plus the engine's files;
 * account deletion additionally wipes every solely-owned workspace and the
 * auth identity. Both spell out the blast radius before acting.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { deletePersonaAction, deleteAccountAction } from '@/actions/deletion';

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-xl border border-neutral-200 bg-white p-5 shadow-2xl dark:border-neutral-800 dark:bg-neutral-900">
        {children}
      </div>
    </div>
  );
}

export function DangerZone({ email, personaName }: { email: string; personaName: string | null }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<null | 'persona' | 'account'>(null);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function deletePersona() {
    setBusy(true); setErr(null);
    const r = await deletePersonaAction();
    setBusy(false);
    if (!r.ok) { setErr(r.error ?? 'failed'); return; }
    setDialog(null);
    router.push('/onboarding');
    router.refresh();
  }

  async function deleteAccount() {
    setBusy(true); setErr(null);
    const r = await deleteAccountAction(confirmText);
    setBusy(false);
    if (!r.ok) { setErr(r.error ?? 'failed'); return; }
    window.location.href = '/'; // the session is gone with the account
  }

  return (
    <section className="card space-y-3 border-red-200 dark:border-red-950">
      <h2 className="font-medium">Delete</h2>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm">Delete my persona{personaName ? <span className="muted"> ({personaName})</span> : ''}</p>
          <p className="muted text-xs">Everything it learned — interview answers, memories, traits, patterns, chats, tests — gone for good. Your account stays.</p>
        </div>
        <button type="button" className="btn-secondary btn-sm shrink-0" onClick={() => { setDialog('persona'); setErr(null); }} disabled={!personaName}>Delete persona…</button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-200 pt-3 dark:border-neutral-800">
        <div>
          <p className="text-sm">Delete my account</p>
          <p className="muted text-xs">Your persona, workspace, files and sign-in — permanently removed. There is no undo and no recovery window.</p>
        </div>
        <button type="button" className="btn-danger btn-sm shrink-0" onClick={() => { setDialog('account'); setConfirmText(''); setErr(null); }}>Delete account…</button>
      </div>

      {dialog === 'persona' && (
        <Overlay onClose={() => setDialog(null)}>
          <h3 className="text-base font-semibold">Delete this persona forever?</h3>
          <p className="muted mt-1 text-sm">
            Interview answers, memories, traits, rules, reasoning patterns, conversations, documents, test results and any published listing are removed from the database and from disk. Copies other people already imported keep working (they hold their own snapshot). This cannot be undone.
          </p>
          {err && <p className="mt-2 text-sm text-red-600" role="alert">{err}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setDialog(null)} disabled={busy}>Cancel</button>
            <button type="button" className="rounded-lg bg-red-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-60" onClick={() => void deletePersona()} disabled={busy}>
              {busy ? 'Deleting…' : 'Delete persona forever'}
            </button>
          </div>
        </Overlay>
      )}

      {dialog === 'account' && (
        <Overlay onClose={() => setDialog(null)}>
          <h3 className="text-base font-semibold">Delete your account forever?</h3>
          <p className="muted mt-1 text-sm">
            Every workspace only you belong to is wiped — persona, memories, chats, files, published listings — then your sign-in itself. Shared workspaces just lose you as a member. No undo, no recovery window.
          </p>
          <label className="label mt-3" htmlFor="dz-confirm">Type your email to confirm</label>
          <input id="dz-confirm" className="input font-mono text-sm" placeholder={email} value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)} disabled={busy} autoComplete="off" />
          {err && <p className="mt-2 text-sm text-red-600" role="alert">{err}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setDialog(null)} disabled={busy}>Cancel</button>
            <button type="button" className="rounded-lg bg-red-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-60"
              onClick={() => void deleteAccount()} disabled={busy || confirmText.trim().toLowerCase() !== email.trim().toLowerCase()}>
              {busy ? 'Deleting…' : 'Delete my account'}
            </button>
          </div>
        </Overlay>
      )}
    </section>
  );
}
