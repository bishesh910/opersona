'use client';
import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { saveBriefAction, type ActionResult } from '@/actions/brief';

export interface BriefValues { displayName: string; roleTitle: string; team: string; briefMd: string; operatingRules: string }

export function BriefForm({ cloneId, initial, readOnly }: { cloneId: string; initial: BriefValues; readOnly: boolean }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(saveBriefAction, null);
  // React 19 resets uncontrolled fields after a form action — refresh so the reset value is the SAVED one, not the stale page-load one.
  useEffect(() => { if (state?.ok) router.refresh(); }, [state, router]);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="cloneId" value={cloneId} />
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="displayName">Display name</label>
          <input id="displayName" name="displayName" className="input" defaultValue={initial.displayName} readOnly={readOnly} />
        </div>
        <div>
          <label className="label" htmlFor="roleTitle">Role title</label>
          <input id="roleTitle" name="roleTitle" className="input" defaultValue={initial.roleTitle} readOnly={readOnly} placeholder="SOC engineer" />
        </div>
        <div>
          <label className="label" htmlFor="team">Team</label>
          <input id="team" name="team" className="input" defaultValue={initial.team} readOnly={readOnly} placeholder="Security" />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="briefMd">Brief (markdown)</label>
        <p className="muted mb-1 text-xs">What you do, what you own, how you like to work. Injected verbatim as the first block of your persona&apos;s prompt.</p>
        <textarea id="briefMd" name="briefMd" className="input min-h-56 font-mono text-xs" defaultValue={initial.briefMd} readOnly={readOnly} />
      </div>
      <div>
        <label className="label" htmlFor="operatingRules">Operating rules</label>
        <p className="muted mb-1 text-xs">Hard rules, one per line. e.g. &quot;Never run destructive Wazuh API calls.&quot;</p>
        <textarea id="operatingRules" name="operatingRules" className="input min-h-28 font-mono text-xs" defaultValue={initial.operatingRules} readOnly={readOnly} />
      </div>
      {!readOnly && (
        <div className="flex items-center gap-3">
          <button className="btn-primary" disabled={pending}>{pending ? 'Saving…' : 'Save brief'}</button>
          {state?.ok && <span className="text-sm text-green-700 dark:text-green-400">Saved{state.warning ? '' : ' and snapshot rendered'}.</span>}
          {state?.warning && <span className="text-sm text-amber-600">{state.warning}</span>}
          {state && !state.ok && <span className="text-sm text-red-600">{state.error}</span>}
        </div>
      )}
    </form>
  );
}
