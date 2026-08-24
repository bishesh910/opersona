'use client';
import { SKIN_TONES, HAIR_STYLES, CLOTHES, BROWS, MOUTHS, FACIAL, type AvatarRecipe, type RGB } from '@opersona/shared';

const rgbToHex = (c: RGB) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
const hexToRgb = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

type Enum<T extends readonly string[]> = T[number];

function Select<T extends readonly string[]>({ label, value, options, onChange, allowNone }: { label: string; value: Enum<T> | undefined; options: T; onChange: (v: Enum<T> | undefined) => void; allowNone?: boolean }) {
  return (
    <div>
      <label className="label">{label}</label>
      <select className="input" value={value ?? ''} onChange={(e) => onChange((e.target.value || undefined) as Enum<T> | undefined)}>
        {allowNone && <option value="">none</option>}
        {options.map((o) => <option key={o} value={o}>{o.replace(/^style/, '')}</option>)}
      </select>
    </div>
  );
}

function Color({ label, value, onChange, optional }: { label: string; value: RGB | undefined; onChange: (v: RGB | undefined) => void; optional?: boolean }) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex items-center gap-2">
        <input type="color" className="h-8 w-12 cursor-pointer rounded border border-neutral-300 bg-transparent dark:border-neutral-700" value={value ? rgbToHex(value) : '#808080'} onChange={(e) => onChange(hexToRgb(e.target.value))} />
        <span className="muted font-mono text-xs">{value ? rgbToHex(value) : '—'}</span>
        {optional && value && <button type="button" className="btn-secondary btn-sm" onClick={() => onChange(undefined)}>clear</button>}
        {optional && !value && <button type="button" className="btn-secondary btn-sm" onClick={() => onChange([60, 60, 60])}>set</button>}
      </div>
    </div>
  );
}

function Check({ label, value, onChange }: { label: string; value: boolean | undefined; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function Num({ label, value, min, max, onChange }: { label: string; value: number | undefined; min: number; max: number; onChange: (v: number | undefined) => void }) {
  return (
    <div>
      <label className="label">{label} <span className="muted">({min}–{max})</span></label>
      <input type="number" className="input" min={min} max={max} value={value ?? ''} placeholder="auto" onChange={(e) => onChange(e.target.value === '' ? undefined : Math.max(min, Math.min(max, Number(e.target.value))))} />
    </div>
  );
}

export function RecipeEditor({ recipe, onChange, disabled }: { recipe: AvatarRecipe; onChange: (r: AvatarRecipe) => void; disabled?: boolean }) {
  const set = <K extends keyof AvatarRecipe>(k: K, v: AvatarRecipe[K]) => onChange({ ...recipe, [k]: v });
  const setHair = (k: keyof NonNullable<AvatarRecipe['hairargs']>, v: unknown) => {
    const next = { ...(recipe.hairargs ?? {}), [k]: v } as NonNullable<AvatarRecipe['hairargs']>;
    if (v === undefined) delete next[k];
    onChange({ ...recipe, hairargs: Object.keys(next).length ? next : undefined });
  };
  return (
    <fieldset disabled={disabled} className="space-y-4 disabled:opacity-60">
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Skin tone" value={recipe.skin} options={SKIN_TONES} onChange={(v) => v && set('skin', v)} />
        <Select label="Hair style" value={recipe.hair} options={HAIR_STYLES} onChange={(v) => v && set('hair', v)} />
        <Color label="Hair colour" value={recipe.hairc} onChange={(v) => v && set('hairc', v)} />
        <Select label="Clothes" value={recipe.cloth} options={CLOTHES} onChange={(v) => v && set('cloth', v)} />
        <Color label="Primary colour (c1)" value={recipe.c1} onChange={(v) => v && set('c1', v)} />
        <Color label="Secondary colour (c2)" value={recipe.c2} onChange={(v) => set('c2', v)} optional />
        <Color label="Tie" value={recipe.tie} onChange={(v) => set('tie', v)} optional />
        <Color label="Pants" value={recipe.pants} onChange={(v) => set('pants', v)} optional />
        <Select label="Brows" value={recipe.brow} options={BROWS} onChange={(v) => set('brow', v)} allowNone />
        <Select label="Mouth" value={recipe.mouth} options={MOUTHS} onChange={(v) => set('mouth', v)} allowNone />
        <Select label="Facial hair" value={recipe.facial} options={FACIAL} onChange={(v) => set('facial', v)} allowNone />
      </div>
      <div className="flex flex-wrap gap-4">
        <Check label="Glasses" value={recipe.glasses} onChange={(v) => set('glasses', v || undefined)} />
        <Check label="Lashes" value={recipe.lashes} onChange={(v) => set('lashes', v || undefined)} />
        <Check label="Heavy build" value={recipe.heavy} onChange={(v) => set('heavy', v || undefined)} />
        <Check label="Blush" value={recipe.blush} onChange={(v) => set('blush', v || undefined)} />
      </div>
      <details className="card">
        <summary className="cursor-pointer text-sm font-medium">Hair details</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <div>
            <label className="label">Part</label>
            <select className="input" value={recipe.hairargs?.part ?? ''} onChange={(e) => setHair('part', e.target.value || undefined)}>
              <option value="">auto</option><option value="L">L</option><option value="R">R</option>
            </select>
          </div>
          <Num label="Recede" min={0} max={3} value={recipe.hairargs?.recede} onChange={(v) => setHair('recede', v)} />
          <Num label="Length" min={10} max={22} value={recipe.hairargs?.length} onChange={(v) => setHair('length', v)} />
          <Num label="Volume" min={0} max={3} value={recipe.hairargs?.vol} onChange={(v) => setHair('vol', v)} />
        </div>
      </details>
    </fieldset>
  );
}
