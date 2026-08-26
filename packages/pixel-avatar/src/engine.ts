// Procedural pixel-art avatar engine ("Pixie HD").
//
// Ported from the original office app's `portraitArt.ts`: fully custom-drawn busts — each
// avatar is an explicit recipe layering skin → clothing → face → facial hair →
// hairstyle → glasses. The base art is drawn on the legacy 18×28 grid (18×32
// for the full-body scene sprite, front + back, 3 walk phases), then upscaled
// 2× nearest-neighbour to the exported 36×56 / 36×64 fine grid, where fine.ts
// applies bounded refinement (hair texture, soft shading, corner rounding,
// finer brows/mouth) and fine-only feature art (headband, round/shades/shades3d
// glasses, buzz stipple, mohawk jags). The recipe shape is `AvatarRecipe` from
// @opersona/shared; this module contains only the drawing code.

import type { AvatarRecipe, RGB } from '@opersona/shared';
import { OUTLINE, MOUTH_COLOR, GLASSES_FRAME, SKIN, shades, clamp, eqRGB as eq, effectiveGlassesStyle } from './palette.js';
import { upscale2x, refine, drawFineFeatures } from './fine.js';

export { effectiveGlassesStyle, glassesCoverEyes, shades, SKIN } from './palette.js';
export { upscale2x } from './fine.js';

// Legacy (base-art) grid — all draw calls below use these coordinates.
const LEGACY_PORTRAIT_W = 18;
const LEGACY_PORTRAIT_H = 28;
const LEGACY_SCENE_W = 18;
const LEGACY_SCENE_H = 32;
// Exported fine grid: 2× the legacy grid.
export const PORTRAIT_W = LEGACY_PORTRAIT_W * 2;
export const PORTRAIT_H = LEGACY_PORTRAIT_H * 2;
export const SCENE_W = LEGACY_SCENE_W * 2;
export const SCENE_H = LEGACY_SCENE_H * 2;
const HX0 = 4, HX1 = 13; // head skin columns

type Buf = Uint8ClampedArray;
type Skin = AvatarRecipe['skin'];
type Brow = NonNullable<AvatarRecipe['brow']>;
type Mouth = NonNullable<AvatarRecipe['mouth']>;
type Facial = NonNullable<AvatarRecipe['facial']>;
type Cloth = AvatarRecipe['cloth'];
type HairStyle = AvatarRecipe['hair'];
type HairArgs = NonNullable<AvatarRecipe['hairargs']>;

// Current canvas dims — set per compose() so the same drawing primitives serve
// both the 18×28 portrait and the 18×32 scene sprite. (Rendering is synchronous.)
let CUR_W = LEGACY_PORTRAIT_W, CUR_H = LEGACY_PORTRAIT_H;

function set(buf: Buf, x: number, y: number, c: RGB, a = 255): void {
  if (x < 0 || x >= CUR_W || y < 0 || y >= CUR_H) return;
  const i = (y * CUR_W + x) * 4;
  buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = a;
}
function alphaAt(buf: Buf, x: number, y: number): number {
  if (x < 0 || x >= CUR_W || y < 0 || y >= CUR_H) return 0;
  return buf[(y * CUR_W + x) * 4 + 3]!;
}
function rgbAt(buf: Buf, x: number, y: number): RGB {
  const i = (y * CUR_W + x) * 4;
  return [buf[i]!, buf[i + 1]!, buf[i + 2]!];
}
function rect(buf: Buf, x0: number, y0: number, x1: number, y1: number, c: RGB): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(buf, x, y, c);
}

// ─── head + face ─────────────────────────────────────────────────────────────
function drawHead(buf: Buf, skin: Skin): void {
  const s = SKIN[skin];
  for (let y = 4; y <= 16; y++) {
    for (let x = HX0; x <= HX1; x++) {
      if (((x === HX0 || x === HX1) && (y === 4 || y === 5 || y === 16)) || ((x === 5 || x === 12) && y === 4)) continue;
      set(buf, x, y, s.base);
    }
  }
  for (let y = 6; y < 12; y++) set(buf, 5, y, s.hi);
  set(buf, 6, 5, s.hi); set(buf, 7, 5, s.hi);
  for (let y = 6; y < 15; y++) set(buf, 12, y, s.sh);
  for (const x of [7, 8, 9, 10, 11]) set(buf, x, 16, s.sh);
  for (const ex of [HX0 - 1, HX1 + 1]) { set(buf, ex, 9, s.base); set(buf, ex, 10, s.base); set(buf, ex, 11, s.sh); }
  rect(buf, 7, 17, 10, 18, s.sh); rect(buf, 7, 17, 9, 17, s.base);
}

function drawFace(buf: Buf, skin: Skin, brow: Brow, mouth: Mouth, blush: boolean, lashes = false, iris?: RGB): void {
  const s = SKIN[skin];
  const white: RGB = [250, 248, 244], pup: RGB = iris ?? [46, 38, 42];
  for (const [a, b, p] of [[5, 6, 6], [10, 11, 10]] as const) {
    set(buf, a, 9, white); set(buf, b, 9, white); set(buf, p, 9, pup);
  }
  // Feminine eyes: a dark upper lash line + an outer flick, and a bright glint
  // in each pupil so they read as bigger, rounder, more expressive.
  if (lashes) {
    const lash: RGB = [54, 40, 48], glint: RGB = [252, 250, 248];
    for (const x of [5, 6, 10, 11]) set(buf, x, 8, lash);
    set(buf, 4, 8, lash); set(buf, 12, 8, lash);
    set(buf, 5, 9, glint); set(buf, 10, 9, glint);
  }
  if (brow === 'flat') for (const x of [5, 6, 10, 11]) set(buf, x, 7, s.line);
  else if (brow === 'angry') { set(buf, 5, 8, s.line); set(buf, 6, 7, s.line); set(buf, 10, 7, s.line); set(buf, 11, 8, s.line); }
  else if (brow === 'raised') for (const x of [5, 6, 10, 11]) set(buf, x, 6, s.line);
  else if (brow === 'soft') { for (const x of [5, 11]) set(buf, x, 7, s.line); for (const x of [6, 10]) set(buf, x, 7, s.sh); }
  set(buf, 8, 11, s.sh); set(buf, 8, 12, s.sh); set(buf, 7, 12, s.sh);
  const mc: RGB = MOUTH_COLOR;
  const mouths: Record<Mouth, [number, number][]> = {
    neutral: [[7, 14], [8, 14], [9, 14], [10, 14]],
    smile: [[7, 14], [8, 14], [9, 14], [10, 14], [6, 13], [11, 13]],
    frown: [[7, 15], [8, 15], [9, 15], [10, 15], [6, 14], [11, 14]],
    grin: [[7, 14], [8, 14], [9, 14], [10, 14], [7, 13], [8, 13], [9, 13], [10, 13], [6, 13], [11, 13]],
  };
  for (const [x, y] of mouths[mouth]) set(buf, x, y, mc);
  if (blush) for (const x of [5, 12]) set(buf, x, 12, [235, 150, 140], 140);
}

// ─── hairstyles ──────────────────────────────────────────────────────────────
type HairFn = (buf: Buf, color: RGB, skinBase: RGB, a: HairArgs) => void;

const styleShort: HairFn = (buf, color, skinBase, a) => {
  const [hi, base, sh] = shades(color);
  const part = a.part ?? 'L', recede = a.recede ?? 0;
  rect(buf, HX0, 2, HX1, 4, base);
  for (let x = HX0 - 1; x <= HX1 + 1; x++) set(buf, x, 3, base);
  rect(buf, HX0 - 1, 4, HX1 + 1, 5, base);
  for (let y = 6; y < 9; y++) { set(buf, HX0 - 1, y, base); set(buf, HX0, y, base); set(buf, HX1, y, base); set(buf, HX1 + 1, y, base); }
  for (let x = HX0; x <= HX1; x++) set(buf, x, 5, base);
  if (recede) {
    for (let y = 3; y < 6; y++) for (let x = 6; x < 12; x++) if (eq(rgbAt(buf, x, y), base)) set(buf, x, y, skinBase);
    set(buf, 8, 5, base); // widow's peak
  }
  const hx = part === 'L' ? 6 : 11;
  for (let y = 2; y < 6; y++) set(buf, hx, y, sh);
  for (let x = HX0; x < hx; x++) if (alphaAt(buf, x, 3)) set(buf, x, 3, hi);
  for (let x = HX0; x <= HX1; x++) if (alphaAt(buf, x, 2)) set(buf, x, 2, hi);
};

const styleFloppy: HairFn = (buf, color) => {
  const [hi, base] = shades(color);
  rect(buf, HX0, 2, HX1, 4, base);
  for (let x = HX0 - 1; x <= HX1 + 1; x++) set(buf, x, 3, base);
  rect(buf, HX0 - 1, 4, HX1 + 1, 5, base);
  for (let x = HX0; x <= HX1; x++) set(buf, x, 5, base);
  for (let x = 6; x <= 12; x++) set(buf, x, 6, base);
  set(buf, 9, 7, base); set(buf, 10, 7, base); set(buf, 11, 7, base);
  for (let y = 6; y < 9; y++) { set(buf, HX0 - 1, y, base); set(buf, HX0, y, base); set(buf, HX1, y, base); set(buf, HX1 + 1, y, base); }
  for (let x = HX0; x <= HX1; x++) if (alphaAt(buf, x, 2)) set(buf, x, 2, hi);
  for (const x of [7, 8, 9]) set(buf, x, 6, hi);
};

const styleFrame: HairFn = (buf, color, skinBase, a) => {
  const [hi, base, sh] = shades(color);
  const length = a.length ?? 17, vol = a.vol ?? 1;
  rect(buf, HX0 - 1, 2, HX1 + 1, 5, base);
  for (let x = HX0 - 1; x <= HX1 + 1; x++) set(buf, x, 3, base);
  for (let x = HX0; x <= HX1; x++) set(buf, x, 5, base);
  for (let x = 6; x < 12; x++) set(buf, x, 6, base);
  set(buf, 8, 6, skinBase); set(buf, 9, 6, skinBase);
  for (let y = 6; y <= length; y++) {
    for (let dx = 0; dx < vol; dx++) { set(buf, HX0 - 1 - dx, y, base); set(buf, HX1 + 1 + dx, y, base); }
    set(buf, HX0, y, base); set(buf, HX1, y, base);
  }
  for (let x = HX0 - 1; x < HX0 + 1; x++) set(buf, x, length + 1, base);
  for (let x = HX1; x < HX1 + 2; x++) set(buf, x, length + 1, base);
  for (let y = 2; y < 6; y++) if (alphaAt(buf, HX1, y)) set(buf, HX1, y, sh);
  for (let x = HX0; x < 9; x++) if (alphaAt(buf, x, 2)) set(buf, x, 2, hi);
};

const styleBun: HairFn = (buf, color, skinBase) => {
  const [hi, base] = shades(color);
  rect(buf, HX0, 3, HX1, 5, base);
  for (let x = HX0 - 1; x <= HX1 + 1; x++) set(buf, x, 4, base);
  for (let x = HX0; x <= HX1; x++) set(buf, x, 5, base);
  for (let x = 6; x < 12; x++) set(buf, x, 6, base);
  set(buf, 8, 6, skinBase); set(buf, 9, 6, skinBase);
  for (let y = 6; y < 9; y++) { set(buf, HX0, y, base); set(buf, HX1, y, base); }
  rect(buf, 7, 1, 10, 2, base);
  for (let x = HX0; x <= HX1; x++) if (alphaAt(buf, x, 3)) set(buf, x, 3, hi);
};

const styleCurly: HairFn = (buf, color, skinBase) => {
  const [hi, base] = shades(color);
  const pts: [number, number][] = [[4, 3], [5, 2], [6, 3], [7, 2], [8, 3], [9, 2], [10, 3], [11, 2], [12, 3], [13, 3],
    [3, 4], [4, 4], [13, 4], [14, 4], [3, 5], [4, 5], [13, 5], [14, 5], [3, 6], [13, 6], [4, 6], [12, 6], [3, 7], [13, 7], [4, 7]];
  rect(buf, HX0, 3, HX1, 5, base);
  for (let x = HX0 - 1; x <= HX1 + 1; x++) set(buf, x, 4, base);
  for (const [x, y] of pts) set(buf, x, y, base);
  for (let x = 6; x < 12; x++) set(buf, x, 6, base);
  set(buf, 8, 6, skinBase); set(buf, 9, 6, skinBase);
  for (const [x, y] of [[5, 2], [7, 2], [9, 2], [11, 2]] as const) set(buf, x, y, hi);
};

const styleMessy: HairFn = (buf, color, skinBase, a) => {
  const [hi, base] = shades(color);
  const length = a.length ?? 8;
  rect(buf, HX0 - 1, 2, HX1 + 1, 5, base);
  const spikes: [number, number][] = [[3, 2], [5, 1], [7, 2], [9, 1], [11, 2], [13, 1], [14, 2], [4, 2], [12, 2]];
  for (const [x, y] of spikes) set(buf, x, y, base);
  for (let x = HX0; x <= HX1; x++) set(buf, x, 5, base);
  for (let x = 6; x < 12; x++) set(buf, x, 6, base);
  set(buf, 8, 6, skinBase); set(buf, 9, 6, skinBase);
  for (let y = 6; y <= length; y++) { set(buf, HX0 - 1, y, base); set(buf, HX0, y, base); set(buf, HX1, y, base); set(buf, HX1 + 1, y, base); }
  for (const [x, y] of spikes) set(buf, x, y, hi);
};

const styleRecede: HairFn = (buf, color, skinBase) => {
  const [, base, sh] = shades(color);
  for (let y = 4; y < 10; y++) { set(buf, HX0 - 1, y, base); set(buf, HX0, y, base); set(buf, HX1, y, base); set(buf, HX1 + 1, y, base); }
  for (let x = HX0; x <= HX1; x++) set(buf, x, 4, base);
  for (let x = HX0 + 1; x < HX1; x++) set(buf, x, 5, base);
  for (let y = 5; y < 9; y++) for (let x = 6; x < 12; x++) if (eq(rgbAt(buf, x, y), base)) set(buf, x, y, skinBase);
  for (let x = HX0; x <= HX1; x++) if (alphaAt(buf, x, 4)) set(buf, x, 4, sh);
};

const styleSpiky: HairFn = (buf, color, skinBase) => {
  const [hi, base] = shades(color);
  rect(buf, HX0, 3, HX1, 5, base);
  for (let x = HX0 - 1; x <= HX1 + 1; x++) set(buf, x, 4, base);
  for (let x = HX0; x <= HX1; x++) set(buf, x, 5, base);
  const spikes: [number, number][] = [[5, 2], [7, 1], [9, 2], [11, 1], [6, 2], [8, 2], [10, 2], [12, 2]];
  for (const [x, y] of spikes) set(buf, x, y, base);
  for (let x = 6; x < 12; x++) set(buf, x, 6, base);
  set(buf, 8, 6, skinBase); set(buf, 9, 6, skinBase);
  for (let y = 6; y < 8; y++) { set(buf, HX0, y, base); set(buf, HX1, y, base); }
  for (const [x, y] of spikes) set(buf, x, y, hi);
};

// Bald: a rounded skin crown (with a sheen) and only a low horseshoe fringe of
// hair around the temples / back of the head.
const styleBald: HairFn = (buf, color, skinBase, a) => {
  const [shi, sbase, ssh] = shades(skinBase, 1.1, 0.82);
  // rounded skin dome above the forehead
  for (let x = 6; x <= 11; x++) set(buf, x, 2, sbase);
  for (let x = 5; x <= 12; x++) set(buf, x, 3, sbase);
  for (let x = HX0; x <= HX1; x++) set(buf, x, 4, sbase);
  // bald-head sheen + side falloff
  for (const x of [7, 8, 9]) set(buf, x, 2, shi);
  set(buf, 6, 3, shi); set(buf, 7, 3, shi);
  set(buf, 5, 3, ssh); set(buf, 12, 3, ssh); set(buf, HX1, 4, ssh);
  // low horseshoe hair fringe — sides only, leaving the crown bald.
  const [, base, sh] = shades(color);
  const top = a.recede ? 8 : 6; // recede:1 → only a thin fringe very low
  for (let y = top; y <= 10; y++) {
    set(buf, HX0 - 1, y, base); set(buf, HX0, y, base);
    set(buf, HX1, y, base); set(buf, HX1 + 1, y, base);
  }
  for (let y = top; y <= 10; y++) { set(buf, HX0 - 1, y, sh); set(buf, HX1 + 1, y, sh); }
};

// Mohawk: shaved skin sides (bald-style dome) with a bold central strip rising
// from the crown. The fine pass jags the strip top into 1-px teeth.
const styleMohawk: HairFn = (buf, color, skinBase) => {
  const [shi, sbase, ssh] = shades(skinBase, 1.1, 0.82);
  // shaved dome above the forehead (same silhouette as the bald crown)
  for (let x = 6; x <= 11; x++) set(buf, x, 2, sbase);
  for (let x = 5; x <= 12; x++) set(buf, x, 3, sbase);
  for (let x = HX0; x <= HX1; x++) set(buf, x, 4, sbase);
  set(buf, 6, 2, shi); set(buf, 6, 3, shi);
  set(buf, 5, 3, ssh); set(buf, 12, 3, ssh); set(buf, HX1, 4, ssh);
  // central strip, two columns wide, up to the canvas top
  const [hi, base, sh] = shades(color);
  rect(buf, 8, 0, 9, 5, base);
  for (let y = 0; y <= 2; y++) set(buf, 8, y, hi);
  set(buf, 9, 4, sh); set(buf, 9, 5, sh);
};

// Buzz cut: a near-scalp cap hugging the skull, no volume anywhere. The fine
// pass stipples skin show-through so it reads as clipper-short.
const styleBuzz: HairFn = (buf, color) => {
  const [, base, sh] = shades(color);
  for (let x = 5; x <= 12; x++) set(buf, x, 3, base);
  rect(buf, HX0, 4, HX1, 5, base);
  for (let y = 6; y < 9; y++) { set(buf, HX0, y, base); set(buf, HX1, y, base); }
  set(buf, HX0, 4, sh); set(buf, HX1, 4, sh); set(buf, 12, 3, sh);
};

// styleBob/styleLong are v2-only art; legacy scene sprites use the closest classic style.
const HAIR_FNS: Record<HairStyle, HairFn> = { styleShort, styleFloppy, styleFrame, styleBun, styleCurly, styleMessy, styleRecede, styleSpiky, styleBald, styleMohawk, styleBuzz, styleBob: styleFrame, styleLong: styleFrame, styleLob: styleFrame };

// ─── facial hair ─────────────────────────────────────────────────────────────
function drawFacial(buf: Buf, kind: Facial, color: RGB): void {
  const [, base, sh] = shades(color);
  if (kind === 'mustache') {
    for (const x of [6, 7, 8, 9, 10]) set(buf, x, 13, base);
    set(buf, 6, 12, base); set(buf, 10, 12, base);
  } else if (kind === 'mustacheSm') {
    for (const x of [7, 8, 9]) set(buf, x, 13, base);
  } else if (kind === 'stubble') {
    for (const [x, y] of [[5, 14], [6, 15], [7, 15], [8, 15], [9, 15], [10, 15], [11, 14], [12, 13], [4, 13], [5, 15], [10, 15]] as const)
      set(buf, x, y, sh, 150);
  } else if (kind === 'goatee') {
    for (const x of [8, 9]) set(buf, x, 15, base);
    set(buf, 8, 14, base); set(buf, 9, 14, base);
    for (const x of [7, 8, 9, 10]) set(buf, x, 13, base);
  }
}

// ─── detail features (all optional; absent = legacy rendering) ───────────────
const GOLD: RGB = [216, 178, 60];

/** 3-4 slightly-darker-than-skin pixels on the cheeks (mirrored diagonals). */
function drawFreckles(buf: Buf, skin: Skin): void {
  const s = SKIN[skin];
  const f: RGB = [
    clamp(s.base[0] * 0.55 + s.line[0] * 0.45),
    clamp(s.base[1] * 0.55 + s.line[1] * 0.45),
    clamp(s.base[2] * 0.55 + s.line[2] * 0.45),
  ];
  for (const [x, y] of [[5, 11], [6, 12], [11, 12], [12, 11]] as const) set(buf, x, y, f);
}

/** Stud (1 px mid-ear) or hoop (2 px hanging off the lobe) at both ears. */
function drawEarrings(buf: Buf, kind: 'stud' | 'hoop', color: RGB): void {
  for (const ex of [HX0 - 1, HX1 + 1]) {
    if (kind === 'stud') set(buf, ex, 10, color);
    else { set(buf, ex, 11, color); set(buf, ex, 12, color); }
  }
}

/** Dip-dye: recolour the lowest 1-2 hair-coloured pixels per column with a second
 *  colour. Only pixels the hair function itself painted (diffed against `pre`)
 *  in one of the hair shades count — facial hair and skin never get tipped — and
 *  only in columns whose hair reaches near the overall bottom of the hair mass,
 *  so the fringe over the forehead never gets dyed (that read as a headband). */
function applyHairTip(buf: Buf, pre: Buf, hairc: RGB, tip: RGB): void {
  const [hi, base, sh] = shades(hairc);
  const [thi, tbase, tsh] = shades(tip);
  const isHair = (x: number, y: number): RGB | null => {
    const i = (y * CUR_W + x) * 4;
    if (buf[i + 3] !== 255) return null;
    if (buf[i] === pre[i] && buf[i + 1] === pre[i + 1] && buf[i + 2] === pre[i + 2] && buf[i + 3] === pre[i + 3]) return null;
    const c = rgbAt(buf, x, y);
    if (eq(c, base)) return tbase;
    if (eq(c, hi)) return thi;
    if (eq(c, sh)) return tsh;
    return null;
  };
  let maxY = -1;
  for (let y = 0; y < CUR_H; y++) for (let x = 0; x < CUR_W; x++) if (isHair(x, y)) maxY = y;
  if (maxY < 0) return;
  for (let x = 0; x < CUR_W; x++) {
    let n = 0;
    for (let y = maxY; y >= Math.max(0, maxY - 1) && n < 2; y--) {
      const t = isHair(x, y);
      if (t) { set(buf, x, y, t); n++; }
    }
  }
}

/** Collar/trim accent: recolour the top clothing row (portrait y19) where it
 *  still shows the garment's own shades (the neck skin and shirt details keep
 *  their colours). */
function applyClothAccent(buf: Buf, row: number, c1: RGB, accent: RGB): void {
  const [hi, base, sh] = shades(c1);
  const [ahi, abase, ash] = shades(accent);
  for (let x = 0; x < CUR_W; x++) {
    if (alphaAt(buf, x, row) !== 255) continue;
    const c = rgbAt(buf, x, row);
    if (eq(c, base)) set(buf, x, row, abase);
    else if (eq(c, hi)) set(buf, x, row, ahi);
    else if (eq(c, sh)) set(buf, x, row, ash);
  }
}

type Headwear = NonNullable<AvatarRecipe['headwear']>;

/** Headwear over the top hair rows. Beanie/cap/fedora/hoodie clear anything
 *  poking above the hat line (bun, spikes, mohawk) then draw their crown;
 *  the beanie finishes with a folded band on row 5, the cap with a 1-px brim
 *  row at the forehead, the fedora with a band + wide brim, the hoodie frames
 *  the whole face down to the shoulders. Side hair stays visible as tufts
 *  under the smaller hats. 'headband' is fine-grid-only art (see fine.ts). */
function drawHeadwear(buf: Buf, kind: Headwear, color: RGB): void {
  if (kind === 'headband') return; // drawn on the fine grid
  const [hi, base, sh] = shades(color);
  for (let y = 0; y <= 1; y++) for (let x = 0; x < CUR_W; x++) {
    const i = (y * CUR_W + x) * 4;
    buf[i] = 0; buf[i + 1] = 0; buf[i + 2] = 0; buf[i + 3] = 0;
  }
  if (kind === 'fedora') {
    // tapered crown, dark band, wide flat brim
    for (let x = 6; x <= 11; x++) set(buf, x, 1, base);
    rect(buf, 5, 2, 12, 3, base);
    set(buf, 6, 1, hi); set(buf, 5, 2, hi);
    for (let x = 5; x <= 12; x++) set(buf, x, 4, sh); // band
    for (let x = 2; x <= 15; x++) set(buf, x, 5, base); // brim
    set(buf, 2, 5, sh); set(buf, 15, 5, sh);
    return;
  }
  if (kind === 'hoodie') {
    // hood shell: rounded top, thick sides framing the face (covering the
    // ears), draping onto the shoulders. Inner rim shaded for depth.
    for (let x = 5; x <= 12; x++) set(buf, x, 1, base);
    rect(buf, 4, 2, 13, 2, base);
    for (let y = 3; y <= 16; y++) {
      set(buf, 2, y, base); set(buf, 3, y, base); set(buf, 4, y, sh);
      set(buf, 13, y, sh); set(buf, 14, y, base); set(buf, 15, y, base);
    }
    rect(buf, 2, 17, 5, 18, base); rect(buf, 12, 17, 15, 18, base); // drape
    set(buf, 6, 1, hi); set(buf, 7, 1, hi); set(buf, 3, 2, hi);
    return;
  }
  for (let x = 5; x <= 12; x++) set(buf, x, 2, base);
  rect(buf, HX0, 3, HX1, 4, base);
  set(buf, 6, 2, hi); set(buf, 7, 2, hi); set(buf, 5, 3, hi);
  if (kind === 'beanie') for (let x = HX0; x <= HX1; x++) set(buf, x, 5, sh);
  else for (let x = HX0 - 1; x <= HX1 + 1; x++) set(buf, x, 5, sh);
}

/** Back view of the headwear: same crown rows fitted to the back-of-head
 *  silhouette; no brim for the cap (it faces away), full brim for the fedora,
 *  a full hood for the hoodie. 'headband' is fine-grid-only art. */
function drawHeadwearBack(buf: Buf, kind: Headwear, color: RGB): void {
  if (kind === 'headband') return; // drawn on the fine grid
  const [hi, base, sh] = shades(color);
  if (kind === 'fedora') {
    for (let x = 6; x <= 11; x++) set(buf, x, 1, base);
    rect(buf, 5, 2, 12, 3, base);
    set(buf, 7, 1, hi); set(buf, 8, 1, hi);
    for (let x = 5; x <= 12; x++) set(buf, x, 4, sh); // band
    for (let x = 2; x <= 15; x++) set(buf, x, 5, base); // brim
    return;
  }
  if (kind === 'hoodie') {
    // the hood covers the whole back of the head down to the shoulders
    for (let x = 5; x <= 12; x++) set(buf, x, 1, base);
    rect(buf, 4, 2, 13, 2, base);
    rect(buf, 3, 3, 14, 13, base);
    rect(buf, 4, 14, 13, 15, base);
    rect(buf, 5, 16, 12, 17, base);
    for (let y = 3; y <= 13; y++) { set(buf, 3, y, sh); set(buf, 14, y, sh); }
    for (let y = 2; y <= 15; y++) set(buf, 8, y, sh); // hood seam
    set(buf, 6, 1, hi); set(buf, 7, 1, hi);
    return;
  }
  rect(buf, 6, 2, 11, 2, base);
  rect(buf, 5, 3, 12, 3, base);
  rect(buf, 4, 4, 13, 4, base);
  set(buf, 7, 2, hi); set(buf, 8, 2, hi);
  if (kind === 'beanie') rect(buf, 4, 5, 13, 5, sh);
}

// ─── glasses ─────────────────────────────────────────────────────────────────
// Clear prescription glasses (NOT sunglasses): a thin rim that frames each eye
// without covering it. The lens interior keeps the eye/skin already drawn, plus
// a small white glint so the lens reads as transparent glass.
function drawGlasses(buf: Buf): void {
  const frame: RGB = GLASSES_FRAME;
  const glint: RGB = [236, 240, 246];
  // Left lens rim around the eye at (5-6, 9): top, bottom, outer + inner edge.
  for (const x of [5, 6]) { set(buf, x, 8, frame); set(buf, x, 10, frame); }
  set(buf, 4, 9, frame); set(buf, 7, 9, frame);
  set(buf, 4, 8, frame); set(buf, 7, 8, frame);
  // Right lens rim around the eye at (10-11, 9).
  for (const x of [10, 11]) { set(buf, x, 8, frame); set(buf, x, 10, frame); }
  set(buf, 9, 9, frame); set(buf, 12, 9, frame);
  set(buf, 9, 8, frame); set(buf, 12, 8, frame);
  // Bridge over the nose + temple arms out to the hair.
  set(buf, 8, 8, frame);
  set(buf, 3, 9, frame); set(buf, 13, 9, frame);
  // Glass glint on each rim's top-outer corner so the lens reads as clear glass.
  set(buf, 4, 8, glint); set(buf, 9, 8, glint);
}

// ─── clothing ────────────────────────────────────────────────────────────────
function bodyShape(buf: Buf, col: RGB, heavy = false): void {
  const [, base, sh] = shades(col);
  const rows: [number, number, number][] = heavy
    ? [[19, 5, 12], [20, 3, 14], [21, 2, 15], [22, 1, 16], [23, 1, 16], [24, 0, 17], [25, 0, 17], [26, 0, 17], [27, 0, 17]]
    : [[19, 6, 11], [20, 4, 13], [21, 3, 14], [22, 2, 15], [23, 2, 15], [24, 1, 16], [25, 1, 16], [26, 1, 16], [27, 1, 16]];
  for (const [y, a, b] of rows) rect(buf, a, y, b, y, base);
  const [lo, hi] = heavy ? [1, 16] : [2, 15];
  for (let y = 22; y < 28; y++) { set(buf, lo, y, sh); set(buf, hi, y, sh); }
}
function drawClothing(buf: Buf, kind: Cloth, c1: RGB, c2: RGB | undefined, tie: RGB | undefined, skin: Skin, heavy = false): void {
  const [hi, base, sh] = shades(c1);
  bodyShape(buf, c1, heavy);
  if (kind === 'suit') {
    const white: RGB = [238, 238, 236];
    for (const [x, y] of [[8, 19], [9, 19], [7, 20], [8, 20], [9, 20], [10, 20], [8, 21], [9, 21]] as const) set(buf, x, y, white);
    for (const [x, y] of [[6, 20], [7, 21], [11, 20], [10, 21], [6, 21], [11, 21]] as const) set(buf, x, y, sh);
    if (tie) { for (let y = 20; y < 26; y++) { set(buf, 8, y, tie); set(buf, 9, y, tie); } set(buf, 8, 20, shades(tie)[0]); }
    else for (let y = 22; y < 26; y++) { set(buf, 8, y, white); set(buf, 9, y, white); }
  } else if (kind === 'dressshirt') {
    for (const [x, y] of [[6, 19], [7, 19], [10, 19], [11, 19], [7, 20], [10, 20]] as const) set(buf, x, y, sh);
    for (let y = 20; y < 27; y += 2) set(buf, 8, y, sh);
    if (tie) for (let y = 19; y < 26; y++) { set(buf, 8, y, tie); set(buf, 9, y, tie); }
  } else if (kind === 'polo') {
    for (const [x, y] of [[6, 19], [7, 19], [10, 19], [11, 19]] as const) set(buf, x, y, hi);
    set(buf, 8, 20, sh); set(buf, 8, 22, sh);
    const accent = c2 ? shades(c2)[1] : hi;
    for (const [x, y] of [[7, 20], [9, 20]] as const) set(buf, x, y, accent);
  } else if (kind === 'blouse') {
    const s = SKIN[skin];
    for (const [x, y] of [[7, 19], [8, 19], [9, 19], [10, 19], [8, 20], [9, 20]] as const) set(buf, x, y, s.sh);
    for (let x = 5; x < 13; x++) if (eq(rgbAt(buf, x, 20), base)) set(buf, x, 20, hi);
  } else if (kind === 'cardigan') {
    const inner: RGB = c2 ? shades(c2)[1] : [235, 233, 226];
    for (let y = 19; y < 27; y++) { set(buf, 8, y, inner); set(buf, 9, y, inner); }
    for (const [x, y] of [[6, 19], [7, 19], [10, 19], [11, 19]] as const) set(buf, x, y, sh);
  } else if (kind === 'sweater') {
    for (const [x, y] of [[6, 19], [7, 19], [8, 19], [9, 19], [10, 19], [11, 19]] as const) set(buf, x, y, sh);
  }
}
function collarNeck(buf: Buf, skin: Skin): void {
  rect(buf, 7, 18, 10, 19, SKIN[skin].sh);
}

// ─── scene body (full standing figure: torso + legs, front or back) ──────────
// Proportioned for standing (not the portrait bust): a narrower torso over real
// legs. Head (rows 2-16) sits above; this draws rows 18-31.
const SHOE: RGB = [44, 40, 48];

function drawSceneLegs(buf: Buf, pants: RGB, phase: number): void {
  const [, base, sh] = shades(pants);
  // two legs cols 5-7 / 10-12, gap at 8-9
  for (const [lx0, lx1] of [[5, 7], [10, 12]] as const) {
    rect(buf, lx0, 25, lx1, 30, base);
    for (let y = 25; y <= 30; y++) set(buf, lx1, y, sh); // inner shade
  }
  // feet — lift one foot per walk phase for a simple gait
  const leftLow = phase !== 1, rightLow = phase !== 2;
  rect(buf, 5, leftLow ? 31 : 30, 7, leftLow ? 31 : 30, SHOE);
  rect(buf, 10, rightLow ? 31 : 30, 12, rightLow ? 31 : 30, SHOE);
}

function drawSceneTorso(buf: Buf, r: AvatarRecipe, back: boolean): void {
  const [hi, base, sh] = shades(r.c1);
  // shoulders → torso, narrower than the portrait bust (wider + rounder if heavy)
  if (r.heavy) {
    rect(buf, 3, 18, 14, 18, base);
    rect(buf, 2, 19, 15, 19, base);
    rect(buf, 2, 20, 15, 24, base);
    for (let y = 20; y <= 24; y++) { set(buf, 2, y, sh); set(buf, 15, y, sh); set(buf, 14, y, sh); }
  } else {
    rect(buf, 4, 18, 13, 18, base);
    rect(buf, 3, 19, 14, 19, base);
    rect(buf, 4, 20, 13, 24, base);
    for (let y = 20; y <= 24; y++) { set(buf, 3, y, sh); set(buf, 14, y, sh); set(buf, 13, y, sh); } // arms / right shade
  }
  if (back) {
    // plain back with a collar line + center seam
    rect(buf, 6, 18, 11, 18, sh);
    for (let y = 19; y <= 24; y++) set(buf, 8, y, sh);
    return;
  }
  const skin = SKIN[r.skin];
  if (r.cloth === 'suit') {
    const white: RGB = [238, 238, 236];
    for (const [x, y] of [[8, 18], [9, 18], [7, 19], [8, 19], [9, 19], [10, 19], [8, 20], [9, 20]] as const) set(buf, x, y, white);
    for (const [x, y] of [[6, 19], [7, 20], [11, 19], [10, 20]] as const) set(buf, x, y, sh);
    if (r.tie) { for (let y = 19; y <= 24; y++) { set(buf, 8, y, r.tie); set(buf, 9, y, r.tie); } set(buf, 8, 19, shades(r.tie)[0]); }
  } else if (r.cloth === 'dressshirt') {
    for (const [x, y] of [[6, 18], [7, 18], [10, 18], [11, 18], [7, 19], [10, 19]] as const) set(buf, x, y, sh);
    if (r.tie) for (let y = 18; y <= 24; y++) { set(buf, 8, y, r.tie); set(buf, 9, y, r.tie); }
    else for (let y = 20; y <= 24; y += 2) set(buf, 8, y, sh);
  } else if (r.cloth === 'polo') {
    for (const [x, y] of [[6, 18], [7, 18], [10, 18], [11, 18]] as const) set(buf, x, y, hi);
    set(buf, 8, 19, sh); set(buf, 8, 21, sh);
  } else if (r.cloth === 'blouse') {
    for (const [x, y] of [[7, 18], [8, 18], [9, 18], [10, 18], [8, 19], [9, 19]] as const) set(buf, x, y, skin.sh);
    for (let x = 5; x < 13; x++) if (eq(rgbAt(buf, x, 19), base)) set(buf, x, 19, hi);
  } else if (r.cloth === 'cardigan') {
    const inner: RGB = r.c2 ? shades(r.c2)[1] : [235, 233, 226];
    for (let y = 18; y <= 24; y++) { set(buf, 8, y, inner); set(buf, 9, y, inner); }
    for (const [x, y] of [[6, 18], [7, 18], [10, 18], [11, 18]] as const) set(buf, x, y, sh);
  } else if (r.cloth === 'sweater') {
    for (const [x, y] of [[6, 18], [7, 18], [8, 18], [9, 18], [10, 18], [11, 18]] as const) set(buf, x, y, sh);
  }
}

/** Back of the head: a rounded hair-covered skull with crown sheen + nape, no face. */
function drawHeadBack(buf: Buf, r: AvatarRecipe): void {
  const s = SKIN[r.skin];
  if (r.hair === 'styleBald') { drawHeadBackBald(buf, r); return; }
  if (r.hair === 'styleMohawk') { drawHeadBackMohawk(buf, r); return; }
  const [hi, base, sh] = shades(r.hairc);
  // rounded skull silhouette (narrow at crown + nape, full through the middle)
  const rows: [number, number, number][] = [
    [2, 6, 11], [3, 5, 12], [4, 4, 13], [5, 4, 13], [6, 4, 13], [7, 4, 13], [8, 4, 13],
    [9, 4, 13], [10, 4, 13], [11, 4, 13], [12, 4, 13], [13, 5, 12], [14, 6, 11],
  ];
  for (const [y, a, b] of rows) rect(buf, a, y, b, y, base);
  // long styles drape down the sides past the head
  const len = r.hair === 'styleFrame' || r.hair === 'styleBob' || r.hair === 'styleLong' || r.hair === 'styleLob' ? (r.hairargs?.length ?? 17)
            : r.hair === 'styleMessy' ? (r.hairargs?.length ?? 9) : 0;
  for (let y = 11; y <= len; y++) { set(buf, HX0 - 1, y, base); set(buf, HX0, y, base); set(buf, HX1, y, base); set(buf, HX1 + 1, y, base); }
  // roundness: darken the side edges and the nape
  for (let y = 4; y <= 12; y++) { set(buf, 4, y, sh); set(buf, 13, y, sh); }
  for (const [x, y] of [[5, 3], [12, 3], [5, 13], [12, 13], [6, 14], [11, 14]] as const) set(buf, x, y, sh);
  // crown sheen (rounded top catching the light) + subtle center part
  for (const [x, y] of [[7, 2], [8, 2], [9, 2], [10, 2], [7, 3], [8, 3], [9, 3]] as const) set(buf, x, y, hi);
  for (let y = 4; y <= 11; y++) set(buf, 9, y, hi);   // sheen down the crown
  for (let y = 4; y <= 12; y++) set(buf, 8, y, sh);   // part line
  // nape + neck (skin)
  rect(buf, 7, 14, 10, 14, sh);
  rect(buf, 7, 15, 10, 17, s.sh);
  rect(buf, 7, 15, 9, 15, s.base);
}

/** Back of a bald head: a skin skull with a sheen and a low hair fringe ring. */
function drawHeadBackBald(buf: Buf, r: AvatarRecipe): void {
  const s = SKIN[r.skin];
  const [shi, sbase, ssh] = shades(s.base, 1.1, 0.82);
  const rows: [number, number, number][] = [
    [2, 6, 11], [3, 5, 12], [4, 4, 13], [5, 4, 13], [6, 4, 13], [7, 4, 13], [8, 4, 13],
    [9, 4, 13], [10, 4, 13], [11, 4, 13], [12, 4, 13], [13, 5, 12], [14, 6, 11],
  ];
  for (const [y, a, b] of rows) rect(buf, a, y, b, y, sbase);
  for (let y = 4; y <= 12; y++) { set(buf, 4, y, ssh); set(buf, 13, y, ssh); }
  for (const [x, y] of [[7, 2], [8, 2], [9, 2], [8, 3], [9, 4], [9, 5]] as const) set(buf, x, y, shi);
  // low hair fringe ring around the back/sides
  const [, base, sh] = shades(r.hairc);
  for (let x = 4; x <= 13; x++) { set(buf, x, 11, base); set(buf, x, 12, base); }
  for (const x of [4, 13]) { set(buf, x, 11, sh); set(buf, x, 12, sh); }
  // nape + neck (skin)
  rect(buf, 7, 14, 10, 14, s.sh);
  rect(buf, 7, 15, 10, 17, s.sh);
  rect(buf, 7, 15, 9, 15, s.base);
}

/** Back of a mohawk: shaved skin skull with the hair strip running down the
 *  centre from the crown to the nape. */
function drawHeadBackMohawk(buf: Buf, r: AvatarRecipe): void {
  const s = SKIN[r.skin];
  const [shi, sbase, ssh] = shades(s.base, 1.1, 0.82);
  const rows: [number, number, number][] = [
    [2, 6, 11], [3, 5, 12], [4, 4, 13], [5, 4, 13], [6, 4, 13], [7, 4, 13], [8, 4, 13],
    [9, 4, 13], [10, 4, 13], [11, 4, 13], [12, 4, 13], [13, 5, 12], [14, 6, 11],
  ];
  for (const [y, a, b] of rows) rect(buf, a, y, b, y, sbase);
  for (let y = 4; y <= 12; y++) { set(buf, 4, y, ssh); set(buf, 13, y, ssh); }
  for (const [x, y] of [[6, 2], [7, 2], [6, 3], [5, 4]] as const) set(buf, x, y, shi);
  // central strip from above the crown down to the nape
  const [hi, base, sh] = shades(r.hairc);
  rect(buf, 8, 0, 9, 14, base);
  for (let y = 0; y <= 2; y++) set(buf, 8, y, hi);
  for (let y = 3; y <= 14; y++) set(buf, 9, y, sh);
  // nape + neck (skin)
  rect(buf, 7, 15, 10, 17, s.sh);
  set(buf, 7, 15, s.base); // strip covers 8-9; keep a hint of skin beside it
}

function drawSceneBody(buf: Buf, r: AvatarRecipe, phase: number, back: boolean): void {
  drawSceneTorso(buf, r, back);
  drawSceneLegs(buf, defaultPants(r), phase);
}

// ─── outline pass ────────────────────────────────────────────────────────────
function outlinePass(buf: Buf): void {
  const pts: [number, number][] = [];
  for (let y = 0; y < CUR_H; y++) {
    for (let x = 0; x < CUR_W; x++) {
      if (alphaAt(buf, x, y) !== 0) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        if (alphaAt(buf, x + dx, y + dy) === 255) { pts.push([x, y]); break; }
      }
    }
  }
  for (const [x, y] of pts) set(buf, x, y, OUTLINE);
}

// Puff the lower face into round cheeks + a double chin so a character reads as
// heavier. Runs after drawHead (adds skin at the jaw) and is safe before the
// face features, which sit higher (eyes y9, mouth y14).
function drawHeavyFace(buf: Buf, skin: Skin): void {
  const s = SKIN[skin];
  // Chubby cheeks: bulge the jaw outward past the normal x4..13 head box.
  for (let y = 11; y <= 15; y++) { set(buf, HX0 - 1, y, s.base); set(buf, HX1 + 1, y, s.base); }
  set(buf, HX0 - 1, 15, s.sh); set(buf, HX1 + 1, 15, s.sh);
  // Fuller, rounder lower jaw.
  for (const x of [5, 6, 11, 12]) set(buf, x, 16, s.base);
  // Double chin: a second rounded roll under the jaw.
  rect(buf, 6, 17, 11, 18, s.base);
  for (const x of [6, 7, 8, 9, 10, 11]) set(buf, x, 18, s.sh);
  set(buf, 7, 17, s.sh); set(buf, 10, 17, s.sh); // crease shadow between chin + roll
}

/** The face/hair group (head → face → facial hair → hair → glasses), no clothing. */
function drawHeadGroup(buf: Buf, r: AvatarRecipe): void {
  const skinBase = SKIN[r.skin].base;
  drawHead(buf, r.skin);
  if (r.heavy) drawHeavyFace(buf, r.skin);
  drawFace(buf, r.skin, r.brow ?? 'flat', r.mouth ?? 'neutral', r.blush ?? false, r.lashes ?? false, r.eyes);
  if (r.freckles) drawFreckles(buf, r.skin);
  if (r.facial) drawFacial(buf, r.facial, r.hairc);
  const preHair = r.hairTip ? new Uint8ClampedArray(buf) : null;
  HAIR_FNS[r.hair](buf, r.hairc, skinBase, r.hairargs ?? {});
  if (r.hairTip && preHair) applyHairTip(buf, preHair, r.hairc, r.hairTip);
  if (r.headwear) drawHeadwear(buf, r.headwear, r.headwearColor ?? [70, 76, 96]);
  // Only the classic (clear) style is legacy-grid art; round/shades/shades3d
  // are drawn at fine resolution after the upscale (see fine.ts).
  if (effectiveGlassesStyle(r) === 'classic') drawGlasses(buf);
  if (r.earrings) drawEarrings(buf, r.earrings, r.earringColor ?? GOLD);
}

function defaultPants(r: AvatarRecipe): RGB {
  if (r.pants) return r.pants;
  return r.cloth === 'suit' ? shades(r.c1)[2] : [54, 56, 70];
}

/** Legacy-grid portrait bust: shoulders-height clothing + front head group. */
function composeLegacy(r: AvatarRecipe): Buf {
  CUR_W = LEGACY_PORTRAIT_W; CUR_H = LEGACY_PORTRAIT_H;
  const buf = new Uint8ClampedArray(LEGACY_PORTRAIT_W * LEGACY_PORTRAIT_H * 4);
  drawClothing(buf, r.cloth, r.c1, r.c2, r.tie, r.skin, r.heavy ?? false);
  collarNeck(buf, r.skin);
  if (r.clothAccent) applyClothAccent(buf, 19, r.c1, r.clothAccent);
  drawHeadGroup(buf, r);
  outlinePass(buf);
  return buf;
}

/** Portrait bust on the fine 36×56 grid: legacy render → 2× upscale →
 *  refinement passes → fine-grid feature art. */
export function compose(r: AvatarRecipe): Buf {
  const buf = upscale2x(composeLegacy(r), LEGACY_PORTRAIT_W, LEGACY_PORTRAIT_H);
  refine(buf, PORTRAIT_W, PORTRAIT_H, r, { face: true });
  drawFineFeatures(buf, PORTRAIT_W, PORTRAIT_H, r, { back: false });
  return buf;
}

/** Legacy-grid full-body scene sprite. `back=false` reuses the portrait's exact face. */
function composeSceneLegacy(r: AvatarRecipe, phase: number, back: boolean): Buf {
  CUR_W = LEGACY_SCENE_W; CUR_H = LEGACY_SCENE_H;
  const buf = new Uint8ClampedArray(LEGACY_SCENE_W * LEGACY_SCENE_H * 4);
  drawSceneBody(buf, r, phase, back);
  if (r.clothAccent) applyClothAccent(buf, 18, r.c1, r.clothAccent);
  if (back) {
    drawHeadBack(buf, r);
    if (r.headwear) drawHeadwearBack(buf, r.headwear, r.headwearColor ?? [70, 76, 96]);
  } else drawHeadGroup(buf, r);
  outlinePass(buf);
  return buf;
}

/** Full-body 36×64 scene sprite (fine grid, same pipeline as compose()). */
export function composeScene(r: AvatarRecipe, phase: number, back: boolean): Buf {
  const buf = upscale2x(composeSceneLegacy(r, phase, back), LEGACY_SCENE_W, LEGACY_SCENE_H);
  refine(buf, SCENE_W, SCENE_H, r, { face: !back });
  drawFineFeatures(buf, SCENE_W, SCENE_H, r, { back });
  return buf;
}
