'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { approveUserAction, rejectUserAction } from '@/actions/approvals';
import { ConfirmDialog } from '@/components/shell/Dialog';

export function ApprovalRow({ id, name, email, emailVerified, createdAt }: {
  id: string; name: string; email: string; emailVerified: boolean; createdAt: string;
}) {
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const act = (fn: (id: string) => Promise<void>) => start(async () => {
    try { setErr(null); await fn(id); router.refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message.replace(/^.*Error: /, '') : 'failed'); }
  });
  return (
    <li className="card flex flex-wrap items-center gap-3 p-4 text-sm">
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{name || '—'}</div>
        <div className="muted truncate text-xs">
          {email} · {new Date(createdAt).toLocaleString()} · {emailVerified
            ? <span className="text-emerald-600 dark:text-emerald-400">email verified</span>
            : <span className="text-amber-600 dark:text-amber-500">email not verified</span>}
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        <button className="btn-primary btn-sm" disabled={pending} onClick={() => act(approveUserAction)}>Approve</button>
        <button className="btn-secondary btn-sm" disabled={pending} onClick={() => setConfirming(true)}>
          Reject
        </button>
      </div>
      {confirming && (
        <ConfirmDialog
          title="Reject this account?"
          message={`${email} is deleted along with their empty workspace; they can sign up again later.`}
          confirmLabel="Reject & delete"
          busy={pending}
          onConfirm={() => { setConfirming(false); act(rejectUserAction); }}
          onCancel={() => setConfirming(false)}
        />
      )}
      {err && <p className="w-full text-xs text-red-600 dark:text-red-400" role="alert">{err}</p>}
    </li>
  );
}
