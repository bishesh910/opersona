'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AXIS_POLES, statedScores, type MbtiResult, type Axis } from '@opersona/shared';
import { MbtiTest } from './MbtiTest';
import { TypeEntry } from './TypeEntry';

const AXES: Axis[] = ['EI', 'SN', 'TF', 'JP'];

/** Diverging bars: one row per axis, bar grows from the center toward the dominant pole. */
function AxesChart({ scores }: { scores: Record<Axis, number> }) {
  return (
    <div className="space-y-2">
      {AXES.map((axis) => {
        const [left, right] = AXIS_POLES[axis];
        const s = Math.max(-100, Math.min(100, scores[axis] ?? 0));
        const towardRight = s >= 0; // scoreMbti breaks ties toward the second pole (I/N/F/P)
        const barPct = Math.abs(s) / 2; // half the track represents 100
        const domShare = Math.round((100 + Math.abs(s)) / 2);
        const otherShare = 100 - domShare;
        const domName = towardRight ? right : left;
        const otherName = towardRight ? left : right;
        const tooltip = `${domName} ${domShare}% · ${otherName} ${otherShare}%`;
        const domClass = 'text-xs font-semibold text-neutral-800 dark:text-neutral-200';
        const subClass = 'muted text-xs';
        return (
          <div key={axis} title={tooltip} className="flex items-center gap-3">
            <span className={`w-32 shrink-0 text-right ${towardRight ? subClass : domClass}`}>{left}{!towardRight && <span className="ml-1 tabular-nums">{domShare}%</span>}</span>
            <div className="relative h-6 flex-1">
              {/* track */}
              <div className="absolute top-1/2 h-2 w-full -translate-y-1/2 rounded-full bg-[#f0efec] dark:bg-[#383835]" />
              {/* bar: square at the center baseline, 4px rounded on the data end */}
              {barPct > 0 && (
                <div
                  className={`absolute top-1/2 h-2 -translate-y-1/2 ${
                    towardRight
                      ? 'left-1/2 rounded-r-[4px] bg-[#e34948] dark:bg-[#e66767]'
                      : 'right-1/2 rounded-l-[4px] bg-[#2a78d6] dark:bg-[#3987e5]'
                  }`}
                  style={{ width: `${barPct}%` }}
                />
              )}
              {/* neutral midpoint tick */}
              <div className="absolute left-1/2 top-1/2 h-2 w-[2px] -translate-x-1/2 -translate-y-1/2 bg-[#d8d6d1] dark:bg-[#4a4a46]" />

            </div>
            <span className={`w-32 shrink-0 ${towardRight ? domClass : subClass}`}>{towardRight && <span className="mr-1 tabular-nums">{domShare}%</span>}{right}</span>
          </div>
        );
      })}
    </div>
  );
}

export function PersonalityCard({ cloneId, readOnly, latest }: {
  cloneId: string;
  readOnly: boolean;
  latest: { type: string; scores: Record<Axis, number>; source: 'test' | 'stated' } | null;
}) {
  const router = useRouter();
  const [view, setView] = useState<'intro' | 'test' | 'stated' | 'result'>(latest ? 'result' : 'intro');
  const [warning, setWarning] = useState<string | null>(null);
  const [saved, setSaved] = useState<MbtiResult | null>(null);
  const [savedSource, setSavedSource] = useState<'test' | 'stated' | null>(null);

  const result: MbtiResult | null = saved ?? latest;
  const source: 'test' | 'stated' = savedSource ?? latest?.source ?? 'test';

  function startTest() {
    setWarning(null);
    setView('test');
  }

  return (
    <section className="card space-y-4">
      <div>
        <h2 className="font-medium">Personality lens</h2>
        <p className="muted mt-0.5 text-xs">
          A quick self-assessment that colours how your persona speaks. Your observed reasoning patterns always take priority.
        </p>
      </div>

      {view === 'intro' && (
        readOnly
          ? <p className="muted text-sm">No test taken yet.</p>
          : (
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="btn-primary" onClick={startTest}>Take the test</button>
              <button type="button" className="btn-secondary" onClick={() => setView('stated')}>I already know my type</button>
            </div>
          )
      )}

      {view === 'test' && (
        <MbtiTest
          cloneId={cloneId}
          onDone={(r, w) => { setSaved(r); setSavedSource('test'); setWarning(w); setView('result'); router.refresh(); }}
        />
      )}

      {view === 'stated' && (
        <TypeEntry
          cloneId={cloneId}
          initial={result?.type}
          onDone={(t) => { setSaved({ type: t, scores: statedScores(t) }); setSavedSource('stated'); setWarning(null); setView('result'); router.refresh(); }}
        />
      )}

      {view === 'result' && result && (
        <div className="space-y-4">
          <div className="flex items-baseline gap-3">
            <span className="text-[32px] font-semibold leading-none">{result.type}</span>
            {!readOnly && (
              <>
                <button type="button" className="muted text-xs underline underline-offset-2 hover:text-neutral-800 dark:hover:text-neutral-200" onClick={startTest}>
                  {source === 'stated' ? 'Measure it — take the test' : 'Retake'}
                </button>
                <button type="button" className="muted text-xs underline underline-offset-2 hover:text-neutral-800 dark:hover:text-neutral-200" onClick={() => setView('stated')}>
                  {source === 'stated' ? 'Change type' : 'Type it in instead'}
                </button>
              </>
            )}
          </div>
          {source === 'stated' ? (
            <p className="muted text-sm">
              You stated this type directly, so there are no per-axis strengths to show —
              honest bars need measured answers. Take the test to see how strong each lean is.
            </p>
          ) : (
            <AxesChart scores={result.scores} />
          )}
          {warning && <p className="text-sm text-amber-600">{warning}</p>}
        </div>
      )}
    </section>
  );
}
