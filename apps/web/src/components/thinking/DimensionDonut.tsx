'use client';
import { useEffect, useState } from 'react';

/** One donut slice: a reasoning dimension with its summed strength across confirmed patterns. */
export interface DonutSlice { label: string; value: number; count: number }

// Fixed categorical order by value rank — exactly six, never cycled or generated.
// Palette validated (CVD + contrast, light & dark) with the dataviz validator.
const STROKES = [
  'stroke-[#2f6fdb] dark:stroke-[#4f83e8]',
  'stroke-[#e06b2d] dark:stroke-[#dd7038]',
  'stroke-[#159f77] dark:stroke-[#1fa87c]',
  'stroke-[#c9920a] dark:stroke-[#bd8a0c]',
  'stroke-[#d05a92] dark:stroke-[#d95f9b]',
  'stroke-[#8465e0] dark:stroke-[#7c68e0]',
];
const CHIPS = [
  'bg-[#2f6fdb] dark:bg-[#4f83e8]',
  'bg-[#e06b2d] dark:bg-[#dd7038]',
  'bg-[#159f77] dark:bg-[#1fa87c]',
  'bg-[#c9920a] dark:bg-[#bd8a0c]',
  'bg-[#d05a92] dark:bg-[#d95f9b]',
  'bg-[#8465e0] dark:bg-[#7c68e0]',
];

const SIZE = 200;
const C = SIZE / 2;
const R = 78;
const STROKE = 15; // slim ring
const GAP = 6; // surface gap between rounded segments, in arc px (on top of the round caps)

/**
 * Where my confirmed patterns live — slim segmented ring, rounded pill segments,
 * tap a segment (or legend row) to read it in the center.
 */
export function DimensionDonut({ slices, totalPatterns }: { slices: DonutSlice[]; totalPatterns: number }) {
  const [sel, setSel] = useState<number | null>(null);
  const [drawn, setDrawn] = useState(false);
  useEffect(() => { const t = requestAnimationFrame(() => setDrawn(true)); return () => cancelAnimationFrame(t); }, []);
  if (slices.length === 0) return null;
  const total = slices.reduce((s, d) => s + d.value, 0) || 1;
  const circ = 2 * Math.PI * R;
  // round linecaps extend STROKE/2 past each end of the dash, so reserve that arc too
  const pad = slices.length > 1 ? STROKE + GAP : 0;
  let cursor = 0;

  const active = sel != null ? slices[sel]! : null;
  const activePct = active ? Math.round((active.value / total) * 100) : null;

  return (
    <section className="card">
      <h2 className="font-medium">Where my patterns live</h2>
      <p className="muted mt-0.5 text-xs">Confirmed patterns by dimension, weighted by strength. Tap a segment.</p>
      <div className="mt-4 flex flex-col items-center gap-5 sm:flex-row sm:gap-8">
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label="Confirmed patterns by dimension" className="max-w-[min(60vw,200px)] shrink-0" onClick={() => setSel(null)}>
          {/* faint track so the ring reads as one object */}
          <circle cx={C} cy={C} r={R} fill="none" strokeWidth={STROKE} className="stroke-neutral-200/50 dark:stroke-neutral-800/60" />
          {slices.map((d, i) => {
            const frac = d.value / total;
            const len = Math.max(frac * circ - pad, 2);
            const rotate = ((cursor + pad / 2) / circ) * 360 - 90;
            cursor += frac * circ;
            const pct = Math.round(frac * 100);
            const dim = sel != null && sel !== i;
            return (
              <circle
                key={d.label}
                cx={C}
                cy={C}
                r={R}
                fill="none"
                strokeLinecap="round"
                strokeWidth={sel === i ? STROKE + 4 : STROKE}
                strokeDasharray={`${drawn ? len : 0.01} ${circ}`}
                transform={`rotate(${rotate} ${C} ${C})`}
                onClick={(e) => { e.stopPropagation(); setSel(sel === i ? null : i); }}
                className={`${STROKES[i]} cursor-pointer transition-all duration-700 ease-out ${dim ? 'opacity-25' : ''}`}
                style={{ transitionDelay: drawn ? '0ms' : `${i * 70}ms` }}
              >
                <title>{`${d.label} — ${d.count} ${d.count === 1 ? 'pattern' : 'patterns'} · ${pct}%`}</title>
              </circle>
            );
          })}
          {active ? (
            <>
              <text x={C} y={C - 4} textAnchor="middle" className="fill-neutral-900 text-3xl font-semibold [font-variant-numeric:tabular-nums] dark:fill-neutral-100">{activePct}%</text>
              <text x={C} y={C + 16} textAnchor="middle" className="fill-neutral-500 text-[11px] dark:fill-neutral-400">{active.label}</text>
            </>
          ) : (
            <>
              <text x={C} y={C - 4} textAnchor="middle" className="fill-neutral-900 text-3xl font-semibold [font-variant-numeric:tabular-nums] dark:fill-neutral-100">{totalPatterns}</text>
              <text x={C} y={C + 16} textAnchor="middle" className="fill-neutral-500 text-[11px] dark:fill-neutral-400">confirmed patterns</text>
            </>
          )}
        </svg>
        <ul className="w-full space-y-0.5 sm:max-w-xs">
          {slices.map((d, i) => {
            const pct = Math.round((d.value / total) * 100);
            const dim = sel != null && sel !== i;
            return (
              <li key={d.label}>
                <button
                  type="button"
                  onClick={() => setSel(sel === i ? null : i)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${sel === i ? 'bg-neutral-100 dark:bg-neutral-800/70' : 'hover:bg-neutral-100/70 dark:hover:bg-neutral-800/40'} ${dim ? 'opacity-40' : ''}`}
                >
                  <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ${CHIPS[i]}`} />
                  <span className="min-w-0 flex-1 truncate text-neutral-800 dark:text-neutral-200">{d.label}</span>
                  <span className="muted text-xs">{d.count}</span>
                  <span className="w-10 text-right font-medium [font-variant-numeric:tabular-nums] text-neutral-900 dark:text-neutral-100">{pct}%</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
