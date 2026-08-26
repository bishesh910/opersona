'use client';
import { memo, useEffect, useRef } from 'react';
import type { AvatarRecipe } from '@opersona/shared';
import { renderPortrait, paintToCanvas, PORTRAIT_W, PORTRAIT_H } from '@/lib/pixel-avatar';

/** One static mini render (no blink loop — these are try-on thumbnails). */
const StaticPixie = memo(function StaticPixie({ recipe, crop }: { recipe: AvatarRecipe; crop: 'head' | 'full' }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const scale = crop === 'head' ? 3 : 2; // head window renders larger for legibility
  useEffect(() => {
    const c = ref.current; const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    try { paintToCanvas(ctx, renderPortrait(recipe), PORTRAIT_W, PORTRAIT_H, scale); } catch { /* ignore */ }
  }, [recipe, scale]);
  const cssW = (PORTRAIT_W * scale) / 2, cssH = (PORTRAIT_H * scale) / 2;
  const canvas = (
    <canvas ref={ref} width={PORTRAIT_W * scale} height={PORTRAIT_H * scale} aria-hidden
      style={{ imageRendering: 'pixelated', width: cssW, height: cssH }} className="block" />
  );
  if (crop === 'full') return canvas;
  // head window: fine x6..30, y0..25 → CSS (at scale 3): 36×39 from offset (9,0)
  return (
    <span className="block h-[39px] w-9 overflow-hidden">
      <span className="block" style={{ marginLeft: -9 }}>{canvas}</span>
    </span>
  );
}, (a, b) => a.crop === b.crop && JSON.stringify(a.recipe) === JSON.stringify(b.recipe));

const pretty = (v: string | undefined) =>
  v === undefined ? 'none' : v.replace(/^style/, '').replace(/^([a-z])/, (m) => m.toUpperCase());

/**
 * Try-on picker: every option rendered as YOUR Pixie with only that attribute
 * changed — no more clicking through a blind dropdown. Wrapping grid on
 * desktop, swipeable snap-scroll strip on phones.
 */
export function SwatchGrid<T extends string>({ label, options, value, none, recipe, apply, onPick, crop = 'head' }: {
  label: string;
  options: readonly T[];
  value: T | undefined;
  /** include a "none" tile (for optional attributes) */
  none?: boolean;
  recipe: AvatarRecipe;
  /** produce the preview/selection recipe for an option (undefined = none) */
  apply: (r: AvatarRecipe, v: T | undefined) => AvatarRecipe;
  onPick: (v: T | undefined) => void;
  crop?: 'head' | 'full';
}) {
  const opts: (T | undefined)[] = none ? [undefined, ...options] : [...options];
  return (
    <div className="min-w-0">
      <span className="label">{label}</span>
      <div
        role="radiogroup"
        aria-label={label}
        className="-mx-1 flex snap-x snap-mandatory gap-1.5 overflow-x-auto px-1 pb-1.5 pt-0.5 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
      >
        {opts.map((o) => {
          const selected = o === value;
          return (
            <button
              key={o ?? '(none)'}
              type="button"
              role="radio"
              aria-checked={selected}
              title={pretty(o)}
              onClick={() => onPick(o)}
              className={
                'flex shrink-0 snap-start flex-col items-center gap-0.5 rounded-lg border p-1 transition-colors ' +
                (selected
                  ? 'border-neutral-900 bg-neutral-100 dark:border-neutral-100 dark:bg-neutral-800'
                  : 'border-neutral-200 hover:border-neutral-400 dark:border-neutral-800 dark:hover:border-neutral-600')
              }
            >
              <StaticPixie recipe={apply(recipe, o)} crop={crop} />
              <span className={'block max-w-12 truncate text-[10px] leading-tight ' + (selected ? 'font-semibold' : 'text-neutral-500')}>{pretty(o)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
