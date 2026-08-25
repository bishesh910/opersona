// Shared palette + colour helpers for the legacy-grid engine (engine.ts) and
// the fine-grid refinement passes (fine.ts).
import type { AvatarRecipe, RGB } from '@opersona/shared';

export type Skin = AvatarRecipe['skin'];

export const OUTLINE: RGB = [38, 34, 46];
export const MOUTH_COLOR: RGB = [158, 86, 80];
export const GLASSES_FRAME: RGB = [60, 54, 62];

export const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

/** [highlight, base, shadow] triple for a colour. */
export function shades(rgb: RGB, dl = 1.22, dd = 0.68): [RGB, RGB, RGB] {
  return [
    [clamp(rgb[0] * dl), clamp(rgb[1] * dl), clamp(rgb[2] * dl)],
    [rgb[0], rgb[1], rgb[2]],
    [clamp(rgb[0] * dd), clamp(rgb[1] * dd), clamp(rgb[2] * dd)],
  ];
}

export interface SkinPal { hi: RGB; base: RGB; sh: RGB; line: RGB; }
export const SKIN: Record<Skin, SkinPal> = {
  light: { hi: [255, 221, 189], base: [247, 201, 170], sh: [212, 158, 126], line: [168, 112, 82] },
  tan:   { hi: [232, 182, 136], base: [214, 162, 116], sh: [176, 126, 86],  line: [138, 92, 60] },
  brown: { hi: [180, 130, 94],  base: [158, 112, 78],  sh: [124, 86, 58],   line: [90, 60, 40] },
  dark:  { hi: [142, 98, 70],   base: [120, 80, 56],   sh: [94, 62, 42],    line: [64, 42, 28] },
};

export function eqRGB(a: RGB, b: RGB): boolean { return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]; }

/** The glasses style actually in effect: `glassesStyle` wins; a bare
 *  `glasses: true` means 'classic' (back-compat with stored recipes). */
export function effectiveGlassesStyle(r: AvatarRecipe): 'classic' | 'round' | 'shades' | 'shades3d' | undefined {
  return r.glassesStyle ?? (r.glasses ? 'classic' : undefined);
}

/** Opaque lens styles cover the eyes — blink frames are skipped for these. */
export function glassesCoverEyes(r: AvatarRecipe): boolean {
  const s = effectiveGlassesStyle(r);
  return s === 'shades' || s === 'shades3d';
}
