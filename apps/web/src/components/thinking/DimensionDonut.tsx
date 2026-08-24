/** One donut slice: a reasoning dimension with its summed strength across confirmed patterns. */
export interface DonutSlice { label: string; value: number; count: number }

// Fixed categorical order by value rank — exactly six, never cycled or generated.
const SLICE_STROKE = [
  'stroke-[#2a78d6] dark:stroke-[#3987e5]',
  'stroke-[#eb6834] dark:stroke-[#d95926]',
  'stroke-[#1baf7a] dark:stroke-[#199e70]',
  'stroke-[#eda100] dark:stroke-[#c98500]',
  'stroke-[#e87ba4] dark:stroke-[#d55181]',
  'stroke-[#008300] dark:stroke-[#008300]',
];
const SLICE_CHIP = [
  'bg-[#2a78d6] dark:bg-[#3987e5]',
  'bg-[#eb6834] dark:bg-[#d95926]',
  'bg-[#1baf7a] dark:bg-[#199e70]',
  'bg-[#eda100] dark:bg-[#c98500]',
  'bg-[#e87ba4] dark:bg-[#d55181]',
  'bg-[#008300] dark:bg-[#008300]',
];

const SIZE = 160;
const C = SIZE / 2;
const R = 62; // stroke centerline; outer 80, inner 44 (~55%)
const STROKE = 36;
const GAP = 2; // px of arc between slices

/**
 * Where my confirmed patterns live: SVG donut of pattern strength by dimension.
 * Server-renderable — no state, tooltips via <title>.
 */
export function DimensionDonut({ slices, totalPatterns }: { slices: DonutSlice[]; totalPatterns: number }) {
  if (slices.length === 0) return null;
  const total = slices.reduce((s, d) => s + d.value, 0) || 1;
  const circ = 2 * Math.PI * R;
  const gap = slices.length > 1 ? GAP : 0;
  let start = 0; // arc position in px along the circumference

  return (
    <section className="card">
      <h2 className="font-medium">Where my patterns live</h2>
      <p className="muted mt-0.5 text-xs">Confirmed patterns by dimension, weighted by strength.</p>
      <div className="mt-4 flex flex-col items-center gap-6 sm:flex-row">
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label="Confirmed patterns by dimension" className="shrink-0">
          {slices.map((d, i) => {
            const frac = d.value / total;
            const len = Math.max(frac * circ - gap, 0.5);
            const rotate = ((start + gap / 2) / circ) * 360 - 90;
            start += frac * circ;
            const pct = Math.round(frac * 100);
            return (
              <circle
                key={d.label}
                cx={C}
                cy={C}
                r={R}
                fill="none"
                strokeWidth={STROKE}
                strokeDasharray={`${len} ${circ - len}`}
                transform={`rotate(${rotate} ${C} ${C})`}
                className={SLICE_STROKE[i]}
              >
                <title>{`${d.label} — ${d.count} ${d.count === 1 ? 'pattern' : 'patterns'} · ${pct}%`}</title>
              </circle>
            );
          })}
          <text x={C} y={C - 2} textAnchor="middle" className="fill-neutral-900 text-2xl font-semibold dark:fill-neutral-100">
            {totalPatterns}
          </text>
          <text x={C} y={C + 14} textAnchor="middle" className="fill-neutral-500 text-[10px] dark:fill-neutral-400">
            confirmed patterns
          </text>
        </svg>
        <ul className="space-y-1.5">
          {slices.map((d, i) => (
            <li key={d.label} className="flex items-center gap-2 text-sm">
              <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-[3px] ${SLICE_CHIP[i]}`} />
              <span className="text-neutral-800 dark:text-neutral-200">{d.label}</span>
              <span className="muted">{Math.round((d.value / total) * 100)}%</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
