'use client';
import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { renameOrgAction, renameSelfAction } from '@/actions/settings';
import type { ActionResult } from '@/actions/brief';

function NameForm({ label, hint, initial, action: serverAction }: {
  label: string; hint: string; initial: string;
  action: (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(serverAction, null);
  const [name, setName] = useState(initial);
  useEffect(() => { if (state?.ok) router.refresh(); }, [state, router]);
  return (
    <form action={action} className="space-y-1.5">
      <label className="label">{label}</label>
      <p className="muted text-xs">{hint}</p>
      <div className="flex gap-2">
        <input name="name" className="input flex-1" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
        <button className="btn-secondary shrink-0" disabled={pending || name.trim() === initial}>{pending ? 'Saving…' : 'Rename'}</button>
      </div>
      {state?.ok && <p className="text-xs text-green-700 dark:text-green-400">Renamed.</p>}
      {state && !state.ok && <p className="text-xs text-red-600">{state.error}</p>}
    </form>
  );
}

export function NamesCard({ orgName, userName, canRenameOrg }: { orgName: string; userName: string; canRenameOrg: boolean }) {
  return (
    <section className="card space-y-4">
      <h2 className="font-medium">Names</h2>
      {canRenameOrg && <NameForm label="Organization name" hint="Shown in the header and on invites." initial={orgName} action={renameOrgAction} />}
      <NameForm label="Your name" hint="Shown in the header, roster, and your persona's replies." initial={userName} action={renameSelfAction} />
    </section>
  );
}
