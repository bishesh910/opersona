'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveBriefAction, type ActionResult } from '@/actions/brief';

export interface BriefValues { displayName: string; roleTitle: string; team: string; briefMd: string; operatingRules: string }

/** Autosaving brief editor: fields save 1.5s after the last keystroke. */
export function BriefForm({ cloneId, initial, readOnly }: { cloneId: string; initial: BriefValues; readOnly: boolean }) {
  const router = useRouter();
  const [v, setV] = useState<BriefValues>(initial);
  const [status, setStatus] = useState<{ kind: 'idle' | 'saving' | 'ok' | 'err'; text: string }>({ kind: 'idle', text: 'Changes save automatically' });
  const firstRun = useRef(true);
  const seq = useRef(0);

  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    if (readOnly) return;
    setStatus({ kind: 'idle', text: 'Unsaved changes…' });
    const mySeq = ++seq.current;
    const t = setTimeout(async () => {
      setStatus({ kind: 'saving', text: 'Saving…' });
      const f = new FormData();
      f.set('cloneId', cloneId);
      f.set('displayName', v.displayName); f.set('roleTitle', v.roleTitle); f.set('team', v.team);
      f.set('briefMd', v.briefMd); f.set('operatingRules', v.operatingRules);
      const res: ActionResult = await saveBriefAction(null, f);
      if (mySeq !== seq.current) return; // a newer edit superseded this save
      if (res.ok) { setStatus({ kind: 'ok', text: res.warning ?? 'Saved ✓' }); router.refresh(); }
      else setStatus({ kind: 'err', text: res.error ?? 'Could not save' });
    }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);

  const set = (k: keyof BriefValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV((p) => ({ ...p, [k]: e.target.value }));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="displayName">Display name</label>
          <input id="displayName" className="input" value={v.displayName} onChange={set('displayName')} readOnly={readOnly} />
        </div>
        <div>
          <label className="label" htmlFor="roleTitle">Role title</label>
          <input id="roleTitle" className="input" value={v.roleTitle} onChange={set('roleTitle')} readOnly={readOnly} placeholder="SOC engineer" />
        </div>
        <div>
          <label className="label" htmlFor="team">Team</label>
          <input id="team" className="input" value={v.team} onChange={set('team')} readOnly={readOnly} placeholder="Security" />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="briefMd">Brief (markdown)</label>
        <p className="muted mb-1 text-xs">What you do, what you own, how you like to work. Injected verbatim as the first block of your persona&apos;s prompt.</p>
        <textarea id="briefMd" className="input min-h-56 font-mono text-xs" value={v.briefMd} onChange={set('briefMd')} readOnly={readOnly} />
      </div>
      <div>
        <label className="label" htmlFor="operatingRules">Operating rules</label>
        <p className="muted mb-1 text-xs">Hard rules, one per line. e.g. &quot;Never run destructive Wazuh API calls.&quot;</p>
        <textarea id="operatingRules" className="input min-h-28 font-mono text-xs" value={v.operatingRules} onChange={set('operatingRules')} readOnly={readOnly} />
      </div>
      {!readOnly && (
        <p className={'text-sm ' + (status.kind === 'err' ? 'text-red-600' : status.kind === 'ok' ? 'text-green-700 dark:text-green-400' : 'muted')} aria-live="polite">
          {status.text}
        </p>
      )}
    </div>
  );
}
