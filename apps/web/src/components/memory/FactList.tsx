'use client';
import { useActionState, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveFactAction, deleteFactAction } from '@/actions/memory';
import type { ActionResult } from '@/actions/brief';
import { ActionStatus, SpineChips } from './Status';
import { ConfirmDialog } from '@/components/shell/Dialog';

export interface FactRow { id: string; statement: string; domain: string | null; tags: string[]; pinned: boolean; shareable: boolean; status: string; sourceKind: string; confidence: number }

function FactForm({ cloneId, fact, onDone }: { cloneId: string; fact?: FactRow; onDone: () => void }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(saveFactAction, null);
  useEffect(() => { if (state?.ok) { router.refresh(); onDone(); } }, [state, router, onDone]);
  return (
    <form action={action} className="card space-y-2">
      <input type="hidden" name="cloneId" value={cloneId} />
      {fact && <input type="hidden" name="id" value={fact.id} />}
      <div>
        <label className="label">Statement</label>
        <textarea name="statement" className="input min-h-16" required defaultValue={fact?.statement} placeholder="Our Wazuh manager runs 4.7 on wazuh-01; agents enrol with the group 'linux-prod'." />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div><label className="label">Domain</label><input name="domain" className="input" defaultValue={fact?.domain ?? ''} placeholder="wazuh" /></div>
        <div><label className="label">Tags (comma separated)</label><input name="tags" className="input" defaultValue={fact?.tags.join(', ')} placeholder="infra, siem" /></div>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-1.5"><input type="checkbox" name="pinned" defaultChecked={fact?.pinned} /> Pinned (always in prompt)</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" name="shareable" defaultChecked={fact?.shareable} /> Shareable with other clones</label>
      </div>
      <div className="flex items-center gap-2">
        <button className="btn-primary btn-sm" disabled={pending}>{pending ? 'Saving…' : fact ? 'Save' : 'Add fact'}</button>
        <button type="button" className="btn-secondary btn-sm" onClick={onDone}>Cancel</button>
        <ActionStatus state={state} />
      </div>
    </form>
  );
}

function DeleteFact({ cloneId, id }: { cloneId: string; id: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(deleteFactAction, null);
  useEffect(() => { if (state?.ok) router.refresh(); }, [state, router]);
  return (
    <form ref={formRef} action={action}>
      <input type="hidden" name="cloneId" value={cloneId} />
      <input type="hidden" name="id" value={id} />
      <button type="button" className="btn-secondary btn-sm" disabled={pending} onClick={() => setConfirming(true)}>Delete</button>
      {confirming && (
        <ConfirmDialog
          title="Delete this fact?"
          message="It leaves memory and the persona prompt."
          busy={pending}
          onConfirm={() => { setConfirming(false); formRef.current?.requestSubmit(); }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </form>
  );
}

export function FactList({ cloneId, facts, readOnly }: { cloneId: string; facts: FactRow[]; readOnly: boolean }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Facts <span className="muted text-sm">({facts.length})</span></h2>
        {!readOnly && !adding && <button type="button" className="btn-secondary btn-sm" onClick={() => setAdding(true)}>Add fact</button>}
      </div>
      {adding && <FactForm cloneId={cloneId} onDone={() => setAdding(false)} />}
      {facts.length === 0 && !adding && <p className="muted text-sm">Nothing taught yet. Facts are durable statements about you, your systems and your preferences.</p>}
      <ul className="space-y-2">
        {facts.map((f) => (
          <li key={f.id}>
            {editing === f.id ? (
              <FactForm cloneId={cloneId} fact={f} onDone={() => setEditing(null)} />
            ) : (
              <div className="card flex items-start justify-between gap-3 py-3">
                <div className="min-w-0 space-y-1">
                  <p className="text-sm">{f.pinned && <span title="pinned" className="mr-1">📌</span>}{f.statement}</p>
                  <div className="flex flex-wrap items-center gap-1 text-xs">
                    {f.domain && <span className="chip">{f.domain}</span>}
                    {f.tags.map((t) => <span key={t} className="chip">#{t}</span>)}
                    <SpineChips status={f.status} sourceKind={f.sourceKind} confidence={f.confidence} />
                  </div>
                </div>
                {!readOnly && (
                  <div className="flex shrink-0 gap-1">
                    <button type="button" className="btn-secondary btn-sm" onClick={() => setEditing(f.id)}>Edit</button>
                    <DeleteFact cloneId={cloneId} id={f.id} />
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
