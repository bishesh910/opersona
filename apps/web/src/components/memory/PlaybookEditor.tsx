'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { savePlaybookAction } from '@/actions/memory';
import type { PlaybookInput } from '@/lib/schemas';
import { ActionStatus } from './Status';
import type { ActionResult } from '@/actions/brief';

export type StepDraft = { action: string; command: string; check: string; expected: string; if_not: string };
export interface PlaybookDraft { id?: string; name: string; domain: string; trigger: string; preconditions: string[]; steps: StepDraft[]; pitfalls: string[]; shareable: boolean }

export const emptyStep = (): StepDraft => ({ action: '', command: '', check: '', expected: '', if_not: '' });
export const emptyPlaybook = (): PlaybookDraft => ({ name: '', domain: '', trigger: '', preconditions: [], steps: [emptyStep()], pitfalls: [], shareable: true });

function ListEditor({ label, items, onChange, placeholder }: { label: string; items: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="space-y-1">
        {items.map((it, i) => (
          <div key={i} className="flex gap-1">
            <input className="input" value={it} placeholder={placeholder} onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} />
            <button type="button" className="btn-secondary btn-sm" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label="remove">×</button>
          </div>
        ))}
        <button type="button" className="btn-secondary btn-sm" onClick={() => onChange([...items, ''])}>+ add</button>
      </div>
    </div>
  );
}

export function PlaybookEditor({ cloneId, initial, onDone }: { cloneId: string; initial: PlaybookDraft; onDone: () => void }) {
  const router = useRouter();
  const [d, setD] = useState<PlaybookDraft>(initial);
  const [state, setState] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const set = <K extends keyof PlaybookDraft>(k: K, v: PlaybookDraft[K]) => setD((p) => ({ ...p, [k]: v }));
  const setStep = (i: number, patch: Partial<StepDraft>) => set('steps', d.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir; if (j < 0 || j >= d.steps.length) return;
    const s = [...d.steps]; [s[i], s[j]] = [s[j]!, s[i]!]; set('steps', s);
  };

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const payload: PlaybookInput = {
      cloneId, id: d.id, name: d.name, domain: d.domain || undefined, trigger: d.trigger,
      preconditions: d.preconditions.map((s) => s.trim()).filter(Boolean),
      pitfalls: d.pitfalls.map((s) => s.trim()).filter(Boolean),
      shareable: d.shareable,
      steps: d.steps.filter((s) => s.action.trim()).map((s) => ({
        action: s.action.trim(), command: s.command.trim() || undefined, check: s.check.trim() || undefined, expected: s.expected.trim() || undefined, if_not: s.if_not.trim() || undefined,
      })),
    };
    start(async () => {
      const res = await savePlaybookAction(payload);
      setState(res);
      if (res.ok) { router.refresh(); onDone(); }
    });
  }

  return (
    <form onSubmit={submit} className="card space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <div><label className="label">Name</label><input className="input" required value={d.name} onChange={(e) => set('name', e.target.value)} placeholder="Agent shows Disconnected" /></div>
        <div><label className="label">Domain</label><input className="input" value={d.domain} onChange={(e) => set('domain', e.target.value)} placeholder="wazuh" /></div>
      </div>
      <div>
        <label className="label">Trigger — when does this apply?</label>
        <input className="input" required value={d.trigger} onChange={(e) => set('trigger', e.target.value)} placeholder="An agent shows status Disconnected in the manager UI" />
      </div>
      <ListEditor label="Preconditions" items={d.preconditions} onChange={(v) => set('preconditions', v)} placeholder="SSH access to the agent host" />
      <div>
        <label className="label">Steps (in your order)</label>
        <ol className="space-y-2">
          {d.steps.map((s, i) => (
            <li key={i} className="rounded border border-neutral-200 p-2 dark:border-neutral-800">
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="font-medium">Step {i + 1}</span>
                <span className="flex gap-1">
                  <button type="button" className="btn-secondary btn-sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label="move up">↑</button>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => move(i, 1)} disabled={i === d.steps.length - 1} aria-label="move down">↓</button>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => set('steps', d.steps.filter((_, j) => j !== i))} disabled={d.steps.length === 1} aria-label="remove">×</button>
                </span>
              </div>
              <div className="grid gap-1.5 sm:grid-cols-2">
                <input className="input sm:col-span-2" placeholder="Action (required)" required value={s.action} onChange={(e) => setStep(i, { action: e.target.value })} />
                <input className="input font-mono" placeholder="Command (optional)" value={s.command} onChange={(e) => setStep(i, { command: e.target.value })} />
                <input className="input" placeholder="Check — what to look at" value={s.check} onChange={(e) => setStep(i, { check: e.target.value })} />
                <input className="input" placeholder="Expected result" value={s.expected} onChange={(e) => setStep(i, { expected: e.target.value })} />
                <input className="input" placeholder="If not — what to do instead" value={s.if_not} onChange={(e) => setStep(i, { if_not: e.target.value })} />
              </div>
            </li>
          ))}
        </ol>
        <button type="button" className="btn-secondary btn-sm mt-2" onClick={() => set('steps', [...d.steps, emptyStep()])}>+ add step</button>
      </div>
      <ListEditor label="Pitfalls" items={d.pitfalls} onChange={(v) => set('pitfalls', v)} placeholder="Restarting the manager drops all agent sessions" />
      <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={d.shareable} onChange={(e) => set('shareable', e.target.checked)} /> Shareable with other clones in the org</label>
      <div className="flex items-center gap-2">
        <button className="btn-primary btn-sm" disabled={pending}>{pending ? 'Saving…' : d.id ? 'Save playbook' : 'Add playbook'}</button>
        <button type="button" className="btn-secondary btn-sm" onClick={onDone}>Cancel</button>
        <ActionStatus state={state} />
      </div>
    </form>
  );
}
