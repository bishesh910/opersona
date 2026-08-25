'use client';
import { copyText } from '@/components/shell/CopyButton';
import { useActionState, useState } from 'react';
import { createInviteAction, cancelInviteAction, type InviteResult } from '@/actions/invites';

export interface PendingInvite { id: string; email: string; expiresAt: string }

function CopyField({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <input
        readOnly
        className="input flex-1 text-xs"
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        data-invite-url
      />
      <button
        type="button"
        className="btn-secondary btn-sm shrink-0"
        onClick={() => {
          if (copyText(url)) { setCopied(true); setTimeout(() => setCopied(false), 2000); }
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

/** "Invite people" (org owner/admin): create invite links, list + cancel pending invitations. */
export function InviteCard({ pending, baseUrl }: { pending: PendingInvite[]; baseUrl: string }) {
  const [state, formAction, busy] = useActionState<InviteResult | null, FormData>(createInviteAction, null);
  return (
    <section className="card space-y-3" data-invite-card>
      <div>
        <h2 className="font-medium">Invite people</h2>
        <p className="muted text-xs">Invite a colleague into this organization. Send them the link — it only works for an account with the invited email. They build their own persona when they join.</p>
      </div>
      <form action={formAction} className="flex items-end gap-2">
        <div className="flex-1">
          <label className="label" htmlFor="invite-email">Email</label>
          <input id="invite-email" name="email" type="email" required className="input" placeholder="colleague@company.com" />
        </div>
        <button className="btn-primary shrink-0" disabled={busy} data-create-invite>{busy ? 'Creating…' : 'Create invite link'}</button>
      </form>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.ok && state.url && (
        <div className="space-y-1 rounded-md border border-green-300 bg-green-50 p-2 dark:border-green-800 dark:bg-green-950/30" data-invite-created>
          <p className="text-xs">Invite for <strong>{state.email}</strong> — share this link:</p>
          <CopyField url={state.url} />
        </div>
      )}
      {pending.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-sm font-medium">Pending invitations</h3>
          <ul className="divide-y divide-neutral-200 rounded-md border border-neutral-200 text-sm dark:divide-neutral-800 dark:border-neutral-800">
            {pending.map((inv) => (
              <li key={inv.id} className="space-y-1 px-3 py-2" data-pending-invite>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate">{inv.email}</span>
                  <span className="muted shrink-0 text-xs">expires {new Date(inv.expiresAt).toLocaleDateString()}</span>
                  <form action={cancelInviteAction}>
                    <input type="hidden" name="invitationId" value={inv.id} />
                    <button className="btn-secondary btn-sm" data-cancel-invite>Cancel</button>
                  </form>
                </div>
                <CopyField url={`${baseUrl}/accept-invite/${inv.id}`} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
