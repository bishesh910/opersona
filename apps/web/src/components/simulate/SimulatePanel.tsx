'use client';
/**
 * Simulation — ask your behavioural model what you'd probably do, say, or
 * choose. One structured prediction per question: likely behaviour + THEIR
 * ranked factors + honest confidence + what the model genuinely doesn't know.
 * Roleplay lives in Chat (persona mode); this surface is for predictions.
 */
import { useState } from 'react';
import Link from 'next/link';

const MODES = [
  { key: 'ask', label: 'What would I do?', placeholder: 'What would I probably do if I got offered a job paying twice my salary but I had to move?' },
  { key: 'respond', label: 'How would I reply?', placeholder: 'Paste the message — I’ll draft the reply you’d probably send.' },
  { key: 'decide', label: 'What would I choose?', placeholder: 'Describe the decision you’re facing.' },
  { key: 'compare', label: 'A or B?', placeholder: 'Optional framing for the options below…' },
  { key: 'explain', label: 'What factors would weigh?', placeholder: 'Describe the situation — I’ll lay out what would probably influence you, and how heavily.' },
] as const;
type ModeKey = (typeof MODES)[number]['key'];

interface Output {
  answer: string;
  factors: { factor: string; weight: 'major' | 'minor' }[];
  confidence: number;
  uncertainty: string[];
  evidence_used: string[];
  enough_information: boolean;
  comparison?: { option: string; verdict: string; lean: number }[];
}
interface SimResult { output: Output; evidence: { layer: string; id: string; text: string }[] }

export interface SimHistoryRow { id: string; mode: string; text: string; answer: string; confidence: number; createdAt: string }

export function SimulatePanel({ cloneId, history }: { cloneId: string; history: SimHistoryRow[] }) {
  const [mode, setMode] = useState<ModeKey>('ask');
  const [text, setText] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SimResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const active = MODES.find((m) => m.key === mode)!;
  const optionsReady = mode !== 'compare' || options.filter((o) => o.trim()).length >= 2;
  const textReady = mode === 'compare' ? true : text.trim().length >= 5;

  async function run() {
    setBusy(true); setErr(null); setResult(null);
    try {
      const body: Record<string, unknown> = { mode, text: text.trim() || (mode === 'compare' ? 'Which would I choose?' : '') };
      if (mode === 'compare') body.options = options.map((o) => o.trim()).filter(Boolean).slice(0, 4);
      const r = await fetch(`/api/engine/clones/${cloneId}/simulate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const j = (await r.json().catch(() => ({}))) as SimResult & { error?: string };
      if (!r.ok) throw new Error(j.error ?? `failed (${r.status})`);
      setResult(j);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'simulation failed');
    } finally { setBusy(false); }
  }

  const evidenceById = new Map((result?.evidence ?? []).map((e) => [e.id, e]));

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {MODES.map((m) => (
            <button key={m.key} type="button" disabled={busy}
              onClick={() => { setMode(m.key); setResult(null); }}
              className={'rounded-full border px-3 py-1.5 text-sm transition-colors ' + (mode === m.key
                ? 'border-neutral-900 bg-neutral-900 font-medium text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900'
                : 'border-neutral-300 text-neutral-600 dark:border-neutral-700 dark:text-neutral-300')}>
              {m.label}
            </button>
          ))}
        </div>
        <textarea className="input min-h-24 w-full text-sm" placeholder={active.placeholder}
          value={text} onChange={(e) => setText(e.target.value)} disabled={busy} />
        {mode === 'compare' && (
          <div className="space-y-1.5">
            {options.map((o, i) => (
              <input key={i} className="input w-full text-sm" placeholder={`Option ${String.fromCharCode(65 + i)}`}
                value={o} disabled={busy}
                onChange={(e) => setOptions((prev) => prev.map((x, j) => j === i ? e.target.value : x))} />
            ))}
            {options.length < 4 && (
              <button type="button" className="muted text-xs hover:underline" disabled={busy}
                onClick={() => setOptions((p) => [...p, ''])}>+ another option</button>
            )}
          </div>
        )}
        <div className="flex items-center gap-3">
          <button type="button" className="btn-primary" disabled={busy || !textReady || !optionsReady} onClick={() => void run()}>
            {busy ? 'Predicting…' : 'Predict me'}
          </button>
          {busy && <span className="muted text-xs">assembling your evidence, then predicting… ~30s</span>}
          {err && <span className="text-sm text-red-600" role="alert">{err}</span>}
        </div>
      </div>

      {result && (
        <section className="card space-y-3">
          <div className="flex items-start justify-between gap-3">
            <p className="whitespace-pre-wrap text-sm">{result.output.answer}</p>
            <span className="chip shrink-0" title="How well the evidence supports this prediction">
              {Math.round(result.output.confidence * 100)}%
            </span>
          </div>
          {result.output.comparison && (
            <ul className="space-y-1.5">
              {result.output.comparison.map((c, i) => (
                <li key={i} className="flex items-center gap-3 text-sm">
                  <span className="min-w-0 flex-1"><span className="font-medium">{c.option}</span> — <span className="muted">{c.verdict}</span></span>
                  <span className="inline-block h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
                    <span className="block h-full rounded-full bg-amber-400" style={{ width: `${Math.round(c.lean * 100)}%` }} />
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div>
            <p className="muted text-xs font-medium uppercase tracking-wide">Main factors</p>
            <ol className="mt-1 space-y-0.5">
              {result.output.factors.map((f, i) => (
                <li key={i} className="text-sm">
                  {i + 1}. {f.factor} {f.weight === 'major' && <span className="chip ml-1 border-amber-400 text-amber-700 dark:border-amber-600 dark:text-amber-400">major</span>}
                </li>
              ))}
            </ol>
          </div>
          {result.output.uncertainty.length > 0 && (
            <div>
              <p className="muted text-xs font-medium uppercase tracking-wide">What this doesn’t account for</p>
              <ul className="muted mt-1 list-inside list-disc text-xs">
                {result.output.uncertainty.map((u, i) => <li key={i}>{u}</li>)}
              </ul>
            </div>
          )}
          {result.output.evidence_used.length > 0 && (
            <details>
              <summary className="muted cursor-pointer text-xs">Built on {result.output.evidence_used.length} piece{result.output.evidence_used.length === 1 ? '' : 's'} of your evidence</summary>
              <ul className="mt-1.5 space-y-1 border-l-2 border-neutral-200 pl-3 dark:border-neutral-800">
                {result.output.evidence_used.map((id) => {
                  const e = evidenceById.get(id);
                  return e ? <li key={id} className="muted text-xs">[{e.layer}] {e.text}</li> : null;
                })}
              </ul>
            </details>
          )}
          <p className="muted text-[11px]">A behavioural prediction from your evidence — not a claim to know your thoughts.</p>
        </section>
      )}

      {history.length > 0 && (
        <details className="group border-t border-neutral-200 pt-4 dark:border-neutral-800">
          <summary className="muted cursor-pointer list-none text-sm">
            Past simulations ({history.length})
            <span className="ml-1 inline-block transition-transform group-open:rotate-90">›</span>
          </summary>
          <ul className="mt-3 space-y-2">
            {history.map((h) => (
              <li key={h.id} className="card space-y-1 py-3">
                <div className="flex items-center gap-2">
                  <span className="chip">{MODES.find((m) => m.key === h.mode)?.label ?? h.mode}</span>
                  <span className="muted ml-auto text-xs" suppressHydrationWarning>{new Date(h.createdAt).toLocaleDateString()}</span>
                </div>
                <p className="muted text-xs">{h.text}</p>
                <p className="text-sm">{h.answer.length > 280 ? h.answer.slice(0, 280) + '…' : h.answer} <span className="muted text-xs">({Math.round(h.confidence * 100)}%)</span></p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
