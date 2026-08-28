/** Behavioural similarity from blind scenario tests — per-dimension bars with an
 *  honest minimum-sample gate and an honest label: an internal model metric,
 *  LLM-judged, not a scientific measure of a person. Server component. */

export interface SimilarityData {
  scored: number;
  minSample: number;
  perDimension: Record<'decision' | 'reasoning' | 'preference' | 'communication' | 'calibration', { n: number; avg: number | null }>;
  overall: number | null;
  last10: number[];
}

const DIM_LABEL: Record<keyof SimilarityData['perDimension'], string> = {
  decision: 'Decision prediction',
  reasoning: 'Reasoning factors',
  preference: 'Preference match',
  communication: 'Communication style',
  calibration: 'Confidence calibration',
};

function Bar({ pct }: { pct: number }) {
  return (
    <span className="inline-block h-1.5 w-28 overflow-hidden rounded-full bg-neutral-200 align-middle dark:bg-neutral-800">
      <span className="block h-full rounded-full bg-amber-400" style={{ width: `${Math.round(pct * 100)}%` }} />
    </span>
  );
}

export function SimilarityCard({ data }: { data: SimilarityData }) {
  if (data.scored === 0) return null;
  const gated = data.overall == null;
  return (
    <section className="card space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-medium">Behavioural similarity</h3>
        {gated ? (
          <span className="muted text-sm">Not enough data yet — answer {Math.max(0, data.minSample - data.scored)} more scenario{data.minSample - data.scored === 1 ? '' : 's'}</span>
        ) : (
          <span className="text-lg font-semibold">{Math.round((data.overall ?? 0) * 100)}%</span>
        )}
      </div>
      {!gated && (
        <ul className="space-y-1.5">
          {(Object.keys(DIM_LABEL) as (keyof typeof DIM_LABEL)[]).map((k) => {
            const d = data.perDimension[k];
            return (
              <li key={k} className="flex items-center justify-between gap-3 text-sm">
                <span className="muted">{DIM_LABEL[k]}</span>
                {d.avg == null ? <span className="muted text-xs">—</span> : (
                  <span className="flex items-center gap-2">
                    <Bar pct={d.avg} />
                    <span className="muted w-8 text-right text-xs tabular-nums">{Math.round(d.avg * 100)}%</span>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {data.last10.length > 1 && (
        <div className="flex items-center gap-1" title="Last 10 scored scenarios, oldest → newest">
          {data.last10.map((v, i) => (
            <span key={i} className="w-2 rounded-sm bg-amber-400" style={{ height: `${4 + Math.round(v * 12)}px` }} />
          ))}
        </div>
      )}
      <p className="muted text-[11px]">LLM-judged over {data.scored} blind scenario{data.scored === 1 ? '' : 's'} — an internal model metric, not a scientific measure of you.</p>
    </section>
  );
}
