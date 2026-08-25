'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { resetMemberPasswordAction, resetMember2FAAction, removeMemberAction, type MemberActionResult } from '@/actions/members';
import { copyText } from '@/components/shell/CopyButton';

export function MemberMenu({ userId, email }: { userId: string; email: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<MemberActionResult | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const run = async (name: string, action: (p: MemberActionResult | null, f: FormData) => Promise<MemberActionResult>, confirmMsg?: string) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusy(name); setResult(null);
    const f = new FormData(); f.set('userId', userId);
    const r = await action(null, f);
    setBusy(null); setResult(r);
    if (r.ok && !r.tempPassword) { setOpen(false); router.refresh(); }
  };

  const item = 'block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-neutral-100 disabled:opacity-50 dark:hover:bg-neutral-800';
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-label={`Manage ${email}`} aria-haspopup="menu" aria-expanded={open} className="icon-btn rounded-md px-2 py-1 text-lg leading-none text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-200" onClick={() => { setOpen((o) => !o); setResult(null); }}>⋯</button>
      {open && (
        <div role="menu" className="card absolute right-0 z-20 mt-1 w-64 p-2 shadow-lg">
          {result?.tempPassword ? (
            <div className="space-y-2 p-1">
              <p className="text-xs font-medium text-green-700 dark:text-green-400">Temporary password — shown once. Send it to them securely; they should change it after signing in.</p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded bg-neutral-100 px-2 py-1 font-mono text-xs dark:bg-neutral-800">{result.tempPassword}</code>
                <button type="button" className="btn-secondary btn-sm shrink-0" onClick={() => copyText(result.tempPassword!)}>Copy</button>
              </div>
              <button type="button" className="btn-secondary btn-sm w-full" onClick={() => { setOpen(false); setResult(null); router.refresh(); }}>Done</button>
            </div>
          ) : (
            <>
              <button type="button" role="menuitem" disabled={!!busy} className={item} onClick={() => run('pw', resetMemberPasswordAction, `Reset ${email}'s password? Their current sessions are signed out.`)}>{busy === 'pw' ? 'Resetting…' : 'Reset password'}</button>
              <button type="button" role="menuitem" disabled={!!busy} className={item} onClick={() => run('2fa', resetMember2FAAction, `Reset ${email}'s two-factor? They'll re-enrol with their phone at next sign-in.`)}>{busy === '2fa' ? 'Resetting…' : 'Reset 2FA (lost phone)'}</button>
              <div className="my-1 border-t border-neutral-200 dark:border-neutral-800" />
              <button type="button" role="menuitem" disabled={!!busy} className={`${item} text-red-600 dark:text-red-400`} onClick={() => run('rm', removeMemberAction, `Remove ${email} from the org? Their persona and everything learned from them is permanently deleted. This cannot be undone.`)}>{busy === 'rm' ? 'Removing…' : 'Remove from org'}</button>
              {result && !result.ok && <p className="px-2 pt-1 text-xs text-red-600">{result.error}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
