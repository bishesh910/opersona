'use client';
import { useEffect, useRef, useState } from 'react';

export type EffortValue = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export const MODELS: { id: string | null; label: string; hint: string }[] = [
  { id: 'claude-fable-5', label: 'Fable 5', hint: 'most capable' },
  { id: 'claude-opus-5', label: 'Opus 5', hint: 'best' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5', hint: 'fast' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', hint: 'cheapest' },
  { id: null, label: 'Org default', hint: '' },
];

/** Thinking levels shown in the menu; "low"/"medium" exist in the engine but are not offered here. */
export const EFFORTS: { id: EffortValue | null; label: string; hint: string }[] = [
  { id: 'high', label: 'Normal', hint: '' },
  { id: 'xhigh', label: 'Extended', hint: 'thinks longer' },
  { id: 'max', label: 'Max', hint: 'slowest' },
  { id: null, label: 'Default', hint: '' },
];

export function MODEL_LABEL(id: string | null): string {
  const m = MODELS.find((x) => x.id === id);
  if (m) return m.id ? m.label : 'the org default model';
  return id ?? 'the org default model';
}
export function EFFORT_LABEL(e: EffortValue | null): string {
  const x = EFFORTS.find((y) => y.id === e);
  if (x) return x.label;
  return e ? e[0]!.toUpperCase() + e.slice(1) : 'Default';
}

function Check() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg>;
}

/** Small text dropdown inside the composer: "Claude Opus 5 ▾" → model + thinking level. */
export function ModelMenu({ model, effort, disabled, onModel, onEffort }: {
  model: string | null; effort: EffortValue | null; disabled?: boolean;
  onModel: (m: string | null) => void; onEffort: (e: EffortValue | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const current = MODELS.find((m) => m.id === model);
  const label = current ? (current.id ? current.label : 'Org default') : model ?? 'Org default';
  const thinking = effort && effort !== 'high' ? ` · ${EFFORT_LABEL(effort)}` : '';
  const row = 'flex w-full items-center justify-between gap-3 rounded px-2 py-1 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="inline-flex h-7 max-w-56 items-center gap-1 rounded-full px-2.5 text-xs text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-50 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        data-model-menu
      >
        <span className="truncate">{label}{thinking}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div role="menu" className="absolute bottom-full right-0 z-30 mb-1.5 max-h-72 w-56 overflow-y-auto rounded-xl border border-neutral-200 bg-white p-1.5 shadow-lg dark:border-neutral-800 dark:bg-neutral-900" data-model-menu-panel>
          <div className="px-2 pb-0.5 pt-1 text-[10px] font-medium uppercase tracking-wider text-neutral-400 dark:text-neutral-500">Model</div>
          {MODELS.map((m) => (
            <button key={m.id ?? 'default'} type="button" role="menuitemradio" aria-checked={model === m.id} className={row} data-model-option={m.id ?? 'default'}
              onClick={() => { setOpen(false); if (m.id !== model) onModel(m.id); }}>
              <span>{m.label}{m.hint && <span className="muted"> — {m.hint}</span>}</span>
              {model === m.id && <Check />}
            </button>
          ))}
          <div className="my-0.5 border-t border-neutral-200 dark:border-neutral-800" />
          <div className="px-2 pb-0.5 pt-1 text-[11px] font-medium text-neutral-500 dark:text-neutral-400">Thinking</div>
          {EFFORTS.map((e) => (
            <button key={e.id ?? 'default'} type="button" role="menuitemradio" aria-checked={effort === e.id} className={row} data-effort-option={e.id ?? 'default'}
              onClick={() => { setOpen(false); if (e.id !== effort) onEffort(e.id); }}>
              <span>{e.label}{e.hint && <span className="muted"> — {e.hint}</span>}</span>
              {effort === e.id && <Check />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
