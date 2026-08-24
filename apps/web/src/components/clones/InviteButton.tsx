'use client';
import { useActionState, useState } from 'react';
import { createInviteAction, type InviteResult } from '@/actions/invites';

/** Compact "Invite teammate" on the Personas roster: email in, copyable invite link out.
 *  Full manage/cancel of pending invites stays in Settings. Admin-only (rendered conditionally). */
export function InviteButton() {
  const [open, setOpen] = useState(false);
  const [state, formAction, busy] = useActionState<InviteResult | null, FormData>(createInviteAction, null);
  const url = state?.ok ? state.url : null;
  return (
    <div className="relative">
      <button type="button" className="btn-secondary" onClick={() => setOpen((o) => !o)} data-invite-toggle>+ Invite teammate</button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 rounded-lg border border-neutral-200 bg-white p-3 shadow-lg dark:border-neutral-800 dark:bg-neutral-900" data-invite-popover>
          <p className="muted mb-2 text-xs">They&apos;ll build their own persona when they join. The link works only for the invited email.</p>
          <form action={formAction} className="flex gap-2">
            <input name="email" type="email" required className="input" placeholder="colleague@company.com" />
            <button className="btn-primary shrink-0" disabled={busy}>{busy ? '…' : 'Create'}</button>
          </form>
          {state && !state.ok && <p className="mt-2 text-xs text-red-600">{state.error}</p>}
          {url && (
            <div className="mt-2 space-y-1">
              <p className="text-xs font-medium text-green-700 dark:text-green-400">Invite link — send it to them:</p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded bg-neutral-100 px-2 py-1 font-mono text-[11px] dark:bg-neutral-800" title={url}>{url}</code>
                <button type="button" className="btn-secondary btn-sm shrink-0" onClick={() => navigator.clipboard?.writeText(url)}>Copy</button>
              </div>
              <p className="muted text-xs">Manage pending invites in <a href="/settings" className="underline">Settings</a>.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
