'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { resolveReportAction } from '@/actions/report';

export function ReportRow({ id, slug, personaName, reason, details, status, createdAt }: {
  id: string; slug: string; personaName: string; reason: string; details: string | null; status: string; createdAt: string;
}) {
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const act = (a: 'delist' | 'restore' | 'dismiss') => start(async () => {
    try { setErr(null); await resolveReportAction(id, a); router.refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'failed'); }
  });
  return (
    <li className="card space-y-2 p-4 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <a href={`/p/${slug}`} target="_blank" className="font-medium hover:underline">{personaName}</a>
        <span className="muted text-xs">{new Date(createdAt).toLocaleString()} · currently {status}</span>
      </div>
      <p><span className="chip">{reason}</span>{details && <span className="muted ml-2">{details}</span>}</p>
      <div className="flex gap-2">
        {status !== 'delisted'
          ? <button className="btn-secondary btn-sm" disabled={pending} onClick={() => act('delist')}>Delist</button>
          : <button className="btn-secondary btn-sm" disabled={pending} onClick={() => act('restore')}>Restore</button>}
        <button className="btn-secondary btn-sm" disabled={pending} onClick={() => act('dismiss')}>Dismiss report</button>
      </div>
      {err && <p className="text-xs text-red-600" role="alert">{err}</p>}
    </li>
  );
}
