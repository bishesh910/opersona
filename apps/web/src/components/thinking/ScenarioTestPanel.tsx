'use client';
/**
 * Blind prediction tests — the honesty loop. The page hands this component
 * OPEN scenarios only (the model's prediction is structurally absent from the
 * payload; it was made and sealed when the scenario was created). The person
 * answers, THEN the reveal shows both answers side by side with the judge's
 * per-dimension scores — and when the model missed, "What did I get wrong?"
 * turns the miss into corrections the model learns from.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export interface OpenScenario {
  id: string;
  category: string;
  format: 'open' | 'choice';
  choices: string[];
  scenario: string;
  question: string;
}

interface ScoredScenario {
  id: string;
  status: string;
  scenario: string;
  question: string;
  humanAnswer: string | null;
  aiPrediction: { decision: string; factors: string[]; communication: string; confidence: number } | null;
  predictedAt: string | null;
  answeredAt: string | null;
  judge: { rationale: Record<string, string>; key_differences: string[]; summary: string } | null;
  scoreDecision: number | null;
  scoreReasoning: number | null;
  scorePreference: number | null;
  scoreCommunication: number | null;
  scoreCalibration: number | null;
  scoreOverall: number | null;
}

const CORRECTION_CHIPS: { key: string; label: string }[] = [
  { key: 'wrong_decision', label: 'Wrong decision' },
  { key: 'wrong_reasoning', label: 'Wrong reason' },
  { key: 'missing_context', label: 'Missing context' },
  { key: 'exception', label: 'This was an exception' },
  { key: 'outdated_belief', label: 'Outdated belief' },
  { key: 'misunderstood_preference', label: 'Misread preference' },
  { key: 'other', label: 'Other' },
];

/** Backgrounding a tab (or leaving the page) aborts in-flight fetches, but the
 *  engine finished the work anyway — generation inserts rows, the judge updates
 *  one. So on ANY request error we ask the server what actually happened before
 *  telling the user something went wrong. */
async function fetchScenarios(cloneId: string, view: 'open' | 'history'): Promise<Record<string, unknown>[]> {
  const r = await fetch(`/api/engine/clones/${cloneId}/scenarios?view=${view}`);
  if (!r.ok) return [];
  const j = (await r.json()) as { scenarios?: Record<string, unknown>[] };
  return j.scenarios ?? [];
}

async function post<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error((j as { error?: string }).error ?? `failed (${r.status})`);
  return j;
}

function ScoreRow({ label, value }: { label: string; value: number | null }) {
  if (value == null) return null;
  return (
    <li className="flex items-center justify-between gap-3 text-sm">
      <span className="muted">{label}</span>
      <span className="flex items-center gap-2">
        <span className="inline-block h-1.5 w-24 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
          <span className="block h-full rounded-full bg-amber-400" style={{ width: `${Math.round(value * 100)}%` }} />
        </span>
        <span className="muted w-8 text-right text-xs tabular-nums">{Math.round(value * 100)}%</span>
      </span>
    </li>
  );
}

const lockedFor = (predictedAt: string | null, answeredAt: string | null): string | null => {
  if (!predictedAt || !answeredAt) return null;
  const mins = Math.max(0, Math.round((new Date(answeredAt).getTime() - new Date(predictedAt).getTime()) / 60_000));
  return mins < 1 ? 'moments' : mins < 60 ? `${mins} min` : mins < 2880 ? `${Math.round(mins / 60)} h` : `${Math.round(mins / 1440)} days`;
};

function CorrectionForm({ cloneId, scenarioId, onDone }: { cloneId: string; scenarioId: string; onDone: () => void }) {
  const [kinds, setKinds] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const elapsed = useElapsed(busy);
  async function send() {
    setBusy(true); setErr(null);
    try {
      await post(`/api/engine/clones/${cloneId}/scenarios/${scenarioId}/correct`, { kinds, note: note.trim() });
      onDone();
    } catch (e) {
      // Same durability rule as answering: the correction may have landed while
      // the connection dropped — the row carries its correction id once it has.
      const landed = (await fetchScenarios(cloneId, 'history').catch(() => []))
        .find((x) => x.id === scenarioId) as { correctionId?: string | null } | undefined;
      if (landed?.correctionId) onDone();
      else setErr(e instanceof Error ? e.message : 'failed');
    } finally { setBusy(false); }
  }
  return (
    <div className="space-y-2 rounded-lg border border-amber-300/70 bg-amber-50 p-3 dark:border-amber-800/60 dark:bg-amber-950/30">
      <p className="text-sm font-medium">What did it get wrong?</p>
      <div className="flex flex-wrap gap-1.5">
        {CORRECTION_CHIPS.map((c) => {
          const on = kinds.includes(c.key);
          return (
            <button key={c.key} type="button" disabled={busy}
              onClick={() => setKinds((k) => on ? k.filter((x) => x !== c.key) : k.length < 3 ? [...k, c.key] : k)}
              className={'rounded-full border px-2.5 py-1 text-xs transition-colors ' + (on
                ? 'border-amber-500 bg-amber-500/15 font-medium text-amber-800 dark:text-amber-300'
                : 'border-neutral-300 text-neutral-600 dark:border-neutral-700 dark:text-neutral-300')}>
              {c.label}
            </button>
          );
        })}
      </div>
      <textarea className="input min-h-20 w-full text-sm" placeholder="Set it straight — what would you actually do, and why?"
        value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
      <div className="flex items-center gap-2">
        <button type="button" className="btn-primary btn-sm" disabled={busy || !kinds.length || note.trim().length < 5} onClick={() => void send()}>
          {busy ? 'Teaching…' : 'Teach it'}
        </button>
        {err && <span className="text-xs text-red-600">{err}</span>}
      </div>
      {busy && (
        <Progress
          pct={creep(elapsed, 14)}
          label="Folding this into your persona…"
          sub={`Turning your words into counter-observations and candidate rules, then republishing the model — on your own Claude, usually 15–40s${elapsed > 6 ? ` · ${elapsed}s` : ''}. Safe to leave; it finishes without you.`}
        />
      )}
    </div>
  );
}

function Reveal({ cloneId, scored, humanAnswer, onCorrectionDone }: { cloneId: string; scored: ScoredScenario; humanAnswer: string; onCorrectionDone: () => void }) {
  const [correcting, setCorrecting] = useState(false);
  const [corrected, setCorrected] = useState(false);
  const pred = scored.aiPrediction;
  const locked = lockedFor(scored.predictedAt, scored.answeredAt);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
          <p className="muted mb-1 text-xs font-medium uppercase tracking-wide">You said</p>
          <p className="whitespace-pre-wrap text-sm">{humanAnswer}</p>
        </div>
        <div className="rounded-lg border border-amber-300/70 p-3 dark:border-amber-800/60">
          <p className="muted mb-1 text-xs font-medium uppercase tracking-wide">Your twin predicted</p>
          {pred ? (
            <div className="space-y-1.5 text-sm">
              <p className="whitespace-pre-wrap">{pred.decision}</p>
              {pred.factors.length > 0 && (
                <ol className="muted list-inside list-decimal text-xs">
                  {pred.factors.map((f, i) => <li key={i}>{f}</li>)}
                </ol>
              )}
              <p className="muted text-xs">confidence {Math.round(pred.confidence * 100)}%</p>
            </div>
          ) : <p className="muted text-sm">—</p>}
        </div>
      </div>
      {locked && <p className="muted text-[11px]">Prediction locked in {locked} before you answered — it never saw your answer.</p>}
      {scored.status === 'scored' ? (
        <>
          <ul className="space-y-1">
            <ScoreRow label="Decision" value={scored.scoreDecision} />
            <ScoreRow label="Reasoning factors" value={scored.scoreReasoning} />
            <ScoreRow label="Preferences" value={scored.scorePreference} />
            <ScoreRow label="Communication" value={scored.scoreCommunication} />
            <ScoreRow label="Calibration" value={scored.scoreCalibration} />
          </ul>
          {scored.judge?.key_differences?.length ? (
            <div>
              <p className="muted text-xs font-medium">Key differences</p>
              <ul className="muted list-inside list-disc text-xs">
                {scored.judge.key_differences.map((d, i) => <li key={i}>{d}</li>)}
              </ul>
            </div>
          ) : null}
        </>
      ) : (
        <p className="text-xs text-amber-600">The prediction above was already made and sealed before you answered — that part is done. Only the REFEREE (scoring the match) needs your Claude, and none was reachable just now. This comparison stays in Answered scenarios below; scoring retries automatically when your bridge reconnects.</p>
      )}
      {corrected ? (
        <p className="text-xs text-emerald-700 dark:text-emerald-400">Taught — the correction is folding into your persona.</p>
      ) : correcting ? (
        <CorrectionForm cloneId={cloneId} scenarioId={scored.id} onDone={() => { setCorrected(true); onCorrectionDone(); }} />
      ) : (
        <div className="flex items-center gap-3">
          <button type="button" className="btn-secondary btn-sm" onClick={() => setCorrecting(true)}>It got me wrong</button>
          <span className="muted text-xs">Misses teach it the most.</span>
        </div>
      )}
    </div>
  );
}

/** Honest progress: a bar that only advances on REAL signal where we have one
 *  (scenarios appearing), and otherwise creeps toward — never reaches — done,
 *  with the elapsed seconds shown so a slow rail looks slow instead of stuck. */
function Progress({ pct, label, sub }: { pct: number; label: string; sub?: string }) {
  return (
    <div className="w-full max-w-sm space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium text-neutral-700 dark:text-neutral-300">{label}</span>
        <span className="muted tabular-nums">{Math.round(pct * 100)}%</span>
      </div>
      <span className="block h-1.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
        <span className="block h-full rounded-full bg-amber-400 transition-[width] duration-700 ease-out" style={{ width: `${Math.max(3, Math.round(pct * 100))}%` }} />
      </span>
      {sub && <p className="muted text-[11px]">{sub}</p>}
    </div>
  );
}

/** Seconds since `active` went true (0 while idle). */
function useElapsed(active: boolean): number {
  const [s, setS] = useState(0);
  useEffect(() => {
    if (!active) { setS(0); return; }
    const t0 = Date.now();
    const id = setInterval(() => setS(Math.round((Date.now() - t0) / 1000)), 500);
    return () => clearInterval(id);
  }, [active]);
  return s;
}

/** Asymptotic creep for work with no progress signal: fast at first, never
 *  past ~92%, so it can't imply a finish it hasn't reached. */
const creep = (elapsed: number, typical: number) => 0.92 * (1 - Math.exp(-elapsed / typical));

function ScenarioCard({ cloneId, item }: { cloneId: string; item: OpenScenario }) {
  const router = useRouter();
  const [answer, setAnswer] = useState('');
  const [factors, setFactors] = useState('');
  const [busy, setBusy] = useState(false);
  const [scored, setScored] = useState<ScoredScenario | null>(null);
  const [skippedAway, setSkippedAway] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const elapsed = useElapsed(busy);

  async function submit() {
    if (!answer.trim()) return;
    setBusy(true); setErr(null);
    try {
      const r = await post<{ scenario: ScoredScenario }>(`/api/engine/clones/${cloneId}/scenarios/${item.id}/answer`,
        { answer: answer.trim(), factors: factors.trim() || undefined });
      setScored(r.scenario); // NO refresh here — see the Done button below
    } catch (e) {
      // Dropped connection ≠ lost answer: the row may already be answered/scored.
      const landed = (await fetchScenarios(cloneId, 'history').catch(() => []))
        .find((x) => x.id === item.id) as ScoredScenario | undefined;
      if (landed) setScored(landed);
      else setErr(e instanceof Error ? e.message : 'could not submit');
    } finally { setBusy(false); }
  }
  async function skip() {
    setBusy(true);
    try { await post(`/api/engine/clones/${cloneId}/scenarios/${item.id}/skip`); setSkippedAway(true); router.refresh(); }
    catch { /* refresh covers it */ } finally { setBusy(false); }
  }

  if (skippedAway) return null;
  return (
    <li className="card space-y-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <span className="chip shrink-0">{item.category}</span>
        {!scored && <button type="button" className="muted text-xs hover:underline" disabled={busy} onClick={() => void skip()}>skip</button>}
      </div>
      <p className="text-sm">{item.scenario}</p>
      <p className="text-sm font-medium">{item.question}</p>
      {scored ? (
        <>
          <Reveal cloneId={cloneId} scored={scored} humanAnswer={answer.trim()} onCorrectionDone={() => { /* stays put until Done */ }} />
          <div className="flex items-center gap-3 border-t border-neutral-200 pt-2.5 dark:border-neutral-800">
            <button type="button" className="btn-secondary btn-sm" onClick={() => router.refresh()}>Done</button>
            <span className="muted text-xs">Kept in Answered scenarios below — Done clears it from here.</span>
          </div>
        </>
      ) : (
        <div className="space-y-2">
          {item.format === 'choice' && item.choices.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {item.choices.map((c, i) => {
                const tag = String.fromCharCode(65 + i);
                const on = answer.startsWith(`${tag}.`);
                return (
                  <button key={i} type="button" disabled={busy}
                    onClick={() => setAnswer(`${tag}. ${c}`)}
                    className={'rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors ' + (on
                      ? 'border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900'
                      : 'border-neutral-300 text-neutral-700 dark:border-neutral-700 dark:text-neutral-200')}>
                    <span className="font-medium">{tag}.</span> {c}
                  </button>
                );
              })}
            </div>
          )}
          <textarea className="input min-h-20 w-full text-sm"
            placeholder={item.format === 'choice' ? 'Picked one above? That\u2019s enough — add a line if it misses what you\u2019d really do.' : 'What would you actually do?'}
            value={answer} onChange={(e) => setAnswer(e.target.value)} disabled={busy} />
          <input className="input w-full text-sm" placeholder="Why did you pick that? (one line)"
            value={factors} onChange={(e) => setFactors(e.target.value)} disabled={busy} />
          <p className="muted text-[11px]">
            Optional — but it&rsquo;s the only way the &ldquo;reasoning&rdquo; dimension can be scored. Leave it blank and
            that dimension is simply left unscored, never counted against your twin.
          </p>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-primary btn-sm" disabled={busy || !answer.trim()} onClick={() => void submit()}>
              {busy ? 'Comparing…' : 'Lock in my answer'}
            </button>
            {!busy && <span className="muted text-xs">Your twin answered this before you — you’ll see its prediction after you commit.</span>}
          </div>
          {busy && (
            <Progress
              pct={creep(elapsed, 12)}
              label="Scoring the match…"
              sub={`Your answer is saved. The referee compares it with the sealed prediction on your own Claude — usually 10–30s${elapsed > 5 ? ` · ${elapsed}s` : ''}.`}
            />
          )}
          {err && <p className="text-xs text-red-600" role="alert">{err}</p>}
        </div>
      )}
    </li>
  );
}

export function ScenarioTestPanel({ cloneId, open, readOnly }: { cloneId: string; open: OpenScenario[]; readOnly: boolean }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [ready, setReady] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const elapsed = useElapsed(running);
  const WANTED = 3;
  async function generate() {
    setRunning(true); setReady(0); setErr(null);
    // Real progress: createScenarioBatch inserts each scenario as it finishes,
    // so polling the open list shows genuine "2 of 3 ready" — not a fake bar.
    const poll = setInterval(() => {
      void fetch(`/api/engine/clones/${cloneId}/scenarios?view=open`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { scenarios?: unknown[] } | null) => { if (j?.scenarios) setReady(j.scenarios.length); })
        .catch(() => {});
    }, 3000);
    try {
      await post(`/api/engine/clones/${cloneId}/scenarios`, { count: WANTED });
      router.refresh();
    } catch (e) {
      // Same rule: if scenarios exist now, generation finished without us.
      const open = await fetchScenarios(cloneId, 'open').catch(() => []);
      if (open.length > 0) { setReady(open.length); router.refresh(); }
      else setErr(e instanceof Error ? e.message : 'failed');
    } finally { clearInterval(poll); setRunning(false); }
  }
  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-medium">Would it have called it?</h2>
        <p className="muted max-w-2xl text-sm">
          Fresh situations, answered blind by your twin before you see them. Answer honestly, then compare — every miss you correct makes it more you.
        </p>
      </div>
      {open.length > 0 ? (
        <ul className="space-y-2">
          {open.map((s) => <ScenarioCard key={s.id} cloneId={cloneId} item={s} />)}
        </ul>
      ) : !readOnly ? (
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <button type="button" className="btn-secondary btn-sm" onClick={() => void generate()} disabled={running}>
              {running ? 'Preparing…' : 'New scenarios'}
            </button>
            {err && <span className="text-xs text-red-600">{err}</span>}
          </div>
          {running && (
            <Progress
              // 20% for writing the batch, then a real fifth per sealed scenario.
              pct={Math.min(0.97, 0.2 * creep(elapsed, 15) / 0.92 + (ready / WANTED) * 0.8)}
              label={ready > 0 ? `${ready} of ${WANTED} ready` : 'Writing your scenarios…'}
              sub={`Each one is written, then answered blind by your twin and sealed before you see it — that's two passes on your own Claude, so a minute or two is normal${elapsed > 8 ? ` · ${elapsed}s` : ''}.`}
            />
          )}
        </div>
      ) : (
        <p className="muted text-xs">No open scenarios.</p>
      )}
    </section>
  );
}
