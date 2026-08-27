'use client';
import { useState, useTransition } from 'react';
import { reportPersonaAction } from '@/actions/report';

const REASONS = [
  ['impersonation', 'Impersonates someone'],
  ['private-info', 'Contains private information'],
  ['harmful', 'Harmful or abusive'],
  ['spam', 'Spam or misleading'],
  ['other', 'Something else'],
] as const;

export function ReportForm({ slug }: { slug: string }) {
  const [reason, setReason] = useState('impersonation');
  const [details, setDetails] = useState('');
  const [state, setState] = useState<'idle' | 'sent' | string>('idle');
  const [pending, start] = useTransition();
  if (state === 'sent') return <p className="muted text-xs">Thanks — a human will look at this report.</p>;
  return (
    <details className="text-xs">
      <summary className="muted cursor-pointer hover:underline">Report this persona</summary>
      <div className="mt-2 space-y-2">
        <select className="input w-full text-xs" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason">
          {REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <textarea className="input w-full text-xs" rows={2} maxLength={2000} placeholder="anything that helps us check (optional)"
          value={details} onChange={(e) => setDetails(e.target.value)} />
        <button type="button" className="btn-secondary btn-sm" disabled={pending}
          onClick={() => start(async () => {
            const r = await reportPersonaAction(slug, reason, details);
            setState(r.ok ? 'sent' : (r.error ?? 'could not send'));
          })}>
          {pending ? 'Sending…' : 'Send report'}
        </button>
        {state !== 'idle' && state !== 'sent' && <p className="text-red-600 dark:text-red-400" role="alert">{state}</p>}
      </div>
    </details>
  );
}
