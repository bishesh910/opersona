'use client';
/** Per-category progress — meaning, not question counts. Mirrors the MiniBar
 *  look from PatternsPanel; categories with under 2 answers say "just getting
 *  started" instead of pretending a % means anything. */

export interface CategoryProgress {
  category: string;
  label: string;
  coverage: number;
  answered: number;
  justStarted: boolean;
}

function Bar({ pct }: { pct: number }) {
  return (
    <span className="inline-block h-1.5 w-24 overflow-hidden rounded-full bg-neutral-200 align-middle dark:bg-neutral-800">
      <span className="block h-full rounded-full bg-amber-400" style={{ width: `${Math.round(pct * 100)}%` }} />
    </span>
  );
}

export function CategoryBars({ categories, compactSummary }: { categories: CategoryProgress[]; compactSummary?: boolean }) {
  const started = categories.filter((c) => !c.justStarted);
  const overall = started.length ? started.reduce((s, c) => s + c.coverage, 0) / categories.length : 0;
  const rows = (
    <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
      {categories.map((c) => (
        <li key={c.category} className="flex items-center justify-between gap-3 text-sm">
          <span className="min-w-0 truncate text-neutral-600 dark:text-neutral-300">{c.label}</span>
          {c.justStarted
            ? <span className="muted shrink-0 text-xs">just getting started</span>
            : <span className="flex shrink-0 items-center gap-2"><Bar pct={c.coverage} /><span className="muted w-8 text-right text-xs tabular-nums">{Math.round(c.coverage * 100)}%</span></span>}
        </li>
      ))}
    </ul>
  );
  if (!compactSummary) return rows;
  return (
    <details className="group">
      <summary className="muted cursor-pointer list-none text-sm">
        How well I know you so far
        {started.length > 0 && <span className="ml-2 font-medium text-neutral-700 dark:text-neutral-300">{Math.round(overall * 100)}%</span>}
        <span className="ml-1 inline-block transition-transform group-open:rotate-90">›</span>
      </summary>
      <div className="mt-3">{rows}</div>
    </details>
  );
}
