'use client';
import { useActionState } from 'react';
import { saveSettingsAction } from '@/actions/settings';
import type { ActionResult } from '@/actions/brief';

export interface SettingsValues { chatModel: string; extractModel: string; condenseModel: string; chatEffort: string; timezone: string; monthlyBudgetUsd: number | null }

const EFFORTS = ['low', 'medium', 'high', 'max'];

const MODELS = [
  { id: 'claude-fable-5', label: 'Fable 5 — most capable' },
  { id: 'claude-opus-5', label: 'Opus 5 — best' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5 — fast' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5 — cheapest' },
];
function ModelSelect({ id, name, value }: { id: string; name: string; value: string }) {
  return (
    <select id={id} name={name} className="input" defaultValue={value}>
      {!MODELS.some((m) => m.id === value) && <option value={value}>{value}</option>}
      {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
    </select>
  );
}

export function SettingsForm({ initial, readOnly }: { initial: SettingsValues; readOnly: boolean }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(saveSettingsAction, null);
  const tzs = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['UTC'];
  return (
    <form action={action} className="space-y-3">
      <fieldset disabled={readOnly} className="grid gap-3 sm:grid-cols-2">
        <div><label className="label" htmlFor="chatModel">Chat model</label><p className="muted mb-1 text-xs">Used when a chat’s model picker is on “Org default” — any chat can override it.</p><ModelSelect id="chatModel" name="chatModel" value={initial.chatModel} /></div>
        <div>
          <label className="label" htmlFor="chatEffort">Chat effort</label>
          <select id="chatEffort" name="chatEffort" className="input" defaultValue={initial.chatEffort}>
            {EFFORTS.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>
        <div><label className="label" htmlFor="extractModel">Extraction model</label><p className="muted mb-1 text-xs">Reads finished sessions in the background and learns your reasoning patterns.</p><ModelSelect id="extractModel" name="extractModel" value={initial.extractModel} /></div>
        <div><label className="label" htmlFor="condenseModel">Condense model</label><p className="muted mb-1 text-xs">Cheap model for housekeeping (merging duplicates, condensing).</p><ModelSelect id="condenseModel" name="condenseModel" value={initial.condenseModel} /></div>
        <div>
          <label className="label" htmlFor="timezone">Timezone</label>
          <select id="timezone" name="timezone" className="input" defaultValue={initial.timezone}>
            {!tzs.includes(initial.timezone) && <option value={initial.timezone}>{initial.timezone}</option>}
            {tzs.map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
        </div>
        <div><label className="label" htmlFor="monthlyBudgetUsd">Monthly budget (USD, optional)</label><p className="muted mb-1 text-xs">Spend cap — only applies in API-key mode; unused with the Claude login.</p><input id="monthlyBudgetUsd" name="monthlyBudgetUsd" type="number" min={0} step="1" className="input" defaultValue={initial.monthlyBudgetUsd ?? ''} /></div>
      </fieldset>
      {!readOnly && (
        <div className="flex items-center gap-3">
          <button className="btn-primary" disabled={pending}>{pending ? 'Saving…' : 'Save settings'}</button>
          {state?.ok && <span className="text-sm text-green-700 dark:text-green-400">Saved.</span>}
          {state && !state.ok && <span className="text-sm text-red-600">{state.error}</span>}
        </div>
      )}
    </form>
  );
}
