'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { PlaybookStep } from '@opersona/db';
import { deletePlaybookAction } from '@/actions/memory';
import { PlaybookEditor, emptyPlaybook, type PlaybookDraft } from './PlaybookEditor';
import { SpineChips } from './Status';
import { ConfirmDialog } from '@/components/shell/Dialog';

export interface PlaybookRow {
  id: string; name: string; domain: string | null; trigger: string; preconditions: string[]; steps: PlaybookStep[]; pitfalls: string[];
  shareable: boolean; status: string; version: number; sourceKind: string; outcomeStats: { used: number; succeeded: number; failed: number };
}

const toDraft = (p: PlaybookRow): PlaybookDraft => ({
  id: p.id, name: p.name, domain: p.domain ?? '', trigger: p.trigger, preconditions: [...p.preconditions], pitfalls: [...p.pitfalls], shareable: p.shareable,
  steps: p.steps.length ? p.steps.map((s) => ({ action: s.action, command: s.command ?? '', check: s.check ?? '', expected: s.expected ?? '', if_not: s.if_not ?? '' })) : [{ action: '', command: '', check: '', expected: '', if_not: '' }],
});

export function PlaybookList({ cloneId, playbooks, readOnly }: { cloneId: string; playbooks: PlaybookRow[]; readOnly: boolean }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function remove(id: string) {
    setConfirmingId(null);
    start(async () => {
      const res = await deletePlaybookAction(cloneId, id);
      if (!res.ok) setErr(res.error ?? 'Delete failed'); else { setErr(res.warning ?? null); router.refresh(); }
    });
  }

  return (
    <section className="space-y-3">
      {confirmingId && (
        <ConfirmDialog
          title="Delete this playbook?"
          message="The playbook and its revision history are removed."
          busy={pending}
          onConfirm={() => remove(confirmingId)}
          onCancel={() => setConfirmingId(null)}
        />
      )}
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Playbooks <span className="muted text-sm">({playbooks.length})</span></h2>
        {!readOnly && !adding && <button type="button" className="btn-secondary btn-sm" onClick={() => setAdding(true)}>Add playbook</button>}
      </div>
      {err && <p className="text-xs text-amber-600">{err}</p>}
      {adding && <PlaybookEditor cloneId={cloneId} initial={emptyPlaybook()} onDone={() => setAdding(false)} />}
      {playbooks.length === 0 && !adding && <p className="muted text-sm">No playbooks yet. A playbook is how <em>you</em> troubleshoot something: trigger, checks in order, what to do when a check fails.</p>}
      <ul className="space-y-2">
        {playbooks.map((p) => (
          <li key={p.id}>
            {editing === p.id ? (
              <PlaybookEditor cloneId={cloneId} initial={toDraft(p)} onDone={() => setEditing(null)} />
            ) : (
              <div className="card py-3">
                <div className="flex items-start justify-between gap-3">
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpen(open === p.id ? null : p.id)}>
                    <div className="text-sm font-medium">{p.name} <span className="muted font-normal">v{p.version}</span></div>
                    <div className="muted text-xs">when: {p.trigger}</div>
                    <div className="mt-1 flex flex-wrap gap-1 text-xs">
                      {p.domain && <span className="chip">{p.domain}</span>}
                      <span className="chip">{p.steps.length} steps</span>
                      <span className="chip">used {p.outcomeStats.used}</span>
                      <SpineChips status={p.status} sourceKind={p.sourceKind} confidence={1} />
                    </div>
                  </button>
                  {!readOnly && (
                    <div className="flex shrink-0 gap-1">
                      <button type="button" className="btn-secondary btn-sm" onClick={() => setEditing(p.id)}>Edit</button>
                      <button type="button" className="btn-secondary btn-sm" onClick={() => setConfirmingId(p.id)} disabled={pending}>Delete</button>
                    </div>
                  )}
                </div>
                {open === p.id && (
                  <div className="mt-3 space-y-2 text-sm">
                    {p.preconditions.length > 0 && <div><div className="label">Preconditions</div><ul className="list-disc pl-5">{p.preconditions.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
                    <div>
                      <div className="label">Steps</div>
                      <ol className="list-decimal space-y-1 pl-5">
                        {p.steps.map((s) => (
                          <li key={s.n}>
                            <div>{s.action}</div>
                            {s.command && <code className="block rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs dark:bg-neutral-800">{s.command}</code>}
                            <div className="muted text-xs">
                              {s.check && <span>check: {s.check}. </span>}
                              {s.expected && <span>expect: {s.expected}. </span>}
                              {s.if_not && <span>if not: {s.if_not}</span>}
                            </div>
                          </li>
                        ))}
                      </ol>
                    </div>
                    {p.pitfalls.length > 0 && <div><div className="label">Pitfalls</div><ul className="list-disc pl-5">{p.pitfalls.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
