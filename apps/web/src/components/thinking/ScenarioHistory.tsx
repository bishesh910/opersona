/**
 * Past blind scenarios — the comparison the reveal showed once, kept forever.
 * The side-by-side needs NO judge (both texts exist the moment you answer);
 * only the score bars wait for judging, which retries automatically whenever
 * the owner's Claude rail comes back.
 */
const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`);

export interface HistoryRow {
  id: string;
  category: string;
  status: string; // scored | failed | answered | skipped
  scenario: string;
  question: string;
  humanAnswer: string | null;
  humanFactors: string | null;
  prediction: { decision: string; factors: string[]; communication: string; confidence: number } | null;
  scoreOverall: number | null;
  scores: { label: string; value: number | null }[];
  keyDifferences: string[];
  answeredAt: string | null;
}

export function ScenarioHistory({ rows }: { rows: HistoryRow[] }) {
  if (!rows.length) return null;
  return (
    <section className="space-y-2">
      <div>
        <h3 className="font-medium">Answered scenarios ({rows.length})</h3>
        <p className="muted text-xs">Every comparison, kept — your answer next to the prediction that was sealed before you gave it.</p>
      </div>
      <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
        {rows.map((r) => (
          <li key={r.id}>
            <details className="group px-4 py-2.5">
              <summary className="flex cursor-pointer list-none items-center gap-3">
                <span className="min-w-0 flex-1 truncate text-sm">{r.question}</span>
                <span className="muted shrink-0 text-xs">{r.category.replace('_', ' ')}</span>
                {r.status === 'scored'
                  ? <span className="shrink-0 text-xs font-semibold tabular-nums">{pct(r.scoreOverall)}</span>
                  : <span className="shrink-0 text-xs text-amber-600">scores pending</span>}
                <span aria-hidden className="muted inline-block transition-transform group-open:rotate-90">›</span>
              </summary>
              <div className="space-y-3 pb-1 pt-3">
                <p className="muted text-xs">{r.scenario}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-neutral-200 p-2.5 dark:border-neutral-800">
                    <p className="muted mb-1 text-[11px] font-medium uppercase tracking-wide">You said</p>
                    <p className="text-sm">{r.humanAnswer ?? '—'}</p>
                    {r.humanFactors && <p className="muted mt-1 text-xs">why: {r.humanFactors}</p>}
                  </div>
                  <div className="rounded-lg border border-neutral-200 p-2.5 dark:border-neutral-800">
                    <p className="muted mb-1 text-[11px] font-medium uppercase tracking-wide">Your twin predicted (blind)</p>
                    {r.prediction ? (
                      <>
                        <p className="text-sm">{r.prediction.decision}</p>
                        {r.prediction.factors.length > 0 && <p className="muted mt-1 text-xs">weighing: {r.prediction.factors.join(' · ')}</p>}
                      </>
                    ) : <p className="muted text-sm">—</p>}
                  </div>
                </div>
                {r.status === 'scored' ? (
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums">
                      {r.scores.map((s) => <span key={s.label}><span className="muted">{s.label}</span> {pct(s.value)}</span>)}
                    </div>
                    {r.keyDifferences.length > 0 && (
                      <ul className="muted list-inside list-disc text-xs">
                        {r.keyDifferences.map((d, i) => <li key={i}>{d}</li>)}
                      </ul>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-amber-600">
                    Scoring couldn&rsquo;t run — no Claude was reachable when you answered. Your answer is safe; judging
                    retries automatically when your bridge reconnects (or with an API key), and the scores appear here.
                  </p>
                )}
              </div>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}
