// Fine-grid (2×) passes. The legacy 18-grid render is upscaled 2× nearest
// neighbour, then these passes add bounded, deterministic polish plus the art
// for features that only exist at fine resolution (headband, non-classic
// glasses styles, mohawk/buzz texture).
//
// REGRESSION CONTRACT (see test/render.test.ts): for a legacy recipe the final
// buffer equals the nearest-neighbour 2× upscale of the legacy render EXCEPT
// where a refinement pass touches. The allowlist of touchable regions:
//   1. hair-mass pixels on the outer silhouette (texture) and ≤1 fine px of
//      silhouette growth (wisps),
//   2. single fine corner pixels of the head-region silhouette (rounding),
//   3. the top skin row under the hair fringe + the bottom skin row of the jaw
//      (soft shading),
//   4. the brow box (fine x8-27, y10-17) and mouth box (fine x10-25, y24-32),
//   5. the eye boxes (fine x10-13 / x20-23, y17-21) — cartoon eye redraw,
//   6. the cheek contour columns (fine x10-11 / x24-25, y12-29) — stripe softening,
//   7. the jaw band (fine x6-29, y29-38) — extra corner rounding.
// Total change stays ≤8% of pixels. Keep any new refinement inside these
// regions or extend the allowlist + test deliberately.
import type { AvatarRecipe, RGB } from '@opersona/shared';
import { SKIN, OUTLINE, MOUTH_COLOR, GLASSES_FRAME, shades, clamp, eqRGB, effectiveGlassesStyle } from './palette.js';

type Buf = Uint8ClampedArray;

/** Nearest-neighbour 2× upscale of an RGBA buffer. */
export function upscale2x(src: Buf, w: number, h: number): Buf {
  const W = w * 2;
  const out = new Uint8ClampedArray(w * h * 16);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const si = (y * w + x) * 4;
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
      const di = ((y * 2 + dy) * W + x * 2 + dx) * 4;
      out[di] = src[si]!; out[di + 1] = src[si + 1]!; out[di + 2] = src[si + 2]!; out[di + 3] = src[si + 3]!;
    }
  }
  return out;
}

// ─── deterministic hashing (no render-time randomness) ───────────────────────
/** FNV-1a over the recipe JSON — one stable seed per recipe. */
export function recipeSeed(r: AvatarRecipe): number {
  const s = JSON.stringify(r);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
/** Small integer hash mixing the seed with a pixel coordinate. */
function mix(seed: number, x: number, y: number): number {
  let h = (seed ^ Math.imul(x + 1, 0x9e3779b1) ^ Math.imul(y + 1, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}

// ─── tiny pixel helpers (explicit dims — no module state) ────────────────────
const A = (buf: Buf, w: number, h: number, x: number, y: number): number =>
  x < 0 || x >= w || y < 0 || y >= h ? 0 : buf[(y * w + x) * 4 + 3]!;
const C = (buf: Buf, w: number, x: number, y: number): RGB => {
  const i = (y * w + x) * 4;
  return [buf[i]!, buf[i + 1]!, buf[i + 2]!];
};
const put = (buf: Buf, w: number, h: number, x: number, y: number, c: RGB, a = 255): void => {
  if (x < 0 || x >= w || y < 0 || y >= h) return;
  const i = (y * w + x) * 4;
  buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = a;
};
const clearPx = (buf: Buf, w: number, h: number, x: number, y: number): void => {
  if (x < 0 || x >= w || y < 0 || y >= h) return;
  const i = (y * w + x) * 4;
  buf[i] = 0; buf[i + 1] = 0; buf[i + 2] = 0; buf[i + 3] = 0;
};
const darken = (buf: Buf, w: number, x: number, y: number, f: number): void => {
  const i = (y * w + x) * 4;
  buf[i] = clamp(buf[i]! * f); buf[i + 1] = clamp(buf[i + 1]! * f); buf[i + 2] = clamp(buf[i + 2]! * f);
};

function hairMatcher(r: AvatarRecipe): (c: RGB) => boolean {
  const pal: RGB[] = [...shades(r.hairc)];
  if (r.hairTip) pal.push(...shades(r.hairTip));
  return (c) => pal.some((p) => eqRGB(p, c));
}

// ─── refinement passes (bounded — see contract above) ────────────────────────

/** (c) Rounder silhouette: knock out the single fine tip pixel of every convex
 *  90° corner in the head region (y ≤ 35). The 2×-upscaled outline is 2 fine px
 *  thick, so removing one tip pixel keeps a continuous dark edge. */
function roundCorners(buf: Buf, w: number, h: number): void {
  const kill: [number, number][] = [];
  const yMax = Math.min(h - 1, 35);
  for (let y = 0; y <= yMax; y++) for (let x = 0; x < w; x++) {
    if (A(buf, w, h, x, y) === 0) continue;
    const up = A(buf, w, h, x, y - 1) === 0, dn = A(buf, w, h, x, y + 1) === 0;
    const lf = A(buf, w, h, x - 1, y) === 0, rt = A(buf, w, h, x + 1, y) === 0;
    if ((up && lf) || (up && rt) || (dn && lf) || (dn && rt)) kill.push([x, y]);
  }
  for (const [x, y] of kill) clearPx(buf, w, h, x, y);
}

/** (a) Hair texture at the outer silhouette: hash-chosen edge pixels shift to
 *  the darker / lighter hair shade; a few columns grow a 1-fine-px wisp. */
function hairTexture(buf: Buf, w: number, h: number, r: AvatarRecipe, seed: number): void {
  const isHair = hairMatcher(r);
  const [hi, , sh] = shades(r.hairc);
  const yMax = Math.min(h - 1, 41);
  const edits: [number, number, RGB][] = [];
  for (let y = 0; y <= yMax; y++) for (let x = 0; x < w; x++) {
    if (A(buf, w, h, x, y) !== 255 || !isHair(C(buf, w, x, y))) continue;
    let edge = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const a = A(buf, w, h, x + dx, y + dy);
      if (a === 0 || (a === 255 && eqRGB(C(buf, w, x + dx, y + dy), OUTLINE))) { edge = true; break; }
    }
    if (!edge) continue;
    const hsh = mix(seed, x, y);
    if (hsh % 5 === 0) edits.push([x, y, sh]);
    else if (hsh % 11 === 3) edits.push([x, y, hi]);
  }
  for (const [x, y, c] of edits) put(buf, w, h, x, y, c);
  // wisps: in a few hash-chosen columns the topmost hair pixel pushes its
  // outline up by one fine px (outline px → dark hair, transparent px → outline)
  for (let x = 0; x < w; x++) {
    if (mix(seed, x, 977) % 7 !== 0) continue;
    for (let y = 2; y <= yMax; y++) {
      if (A(buf, w, h, x, y) !== 255 || !isHair(C(buf, w, x, y))) continue;
      if (A(buf, w, h, x, y - 1) === 255 && eqRGB(C(buf, w, x, y - 1), OUTLINE) && A(buf, w, h, x, y - 2) === 0) {
        put(buf, w, h, x, y - 1, sh);
        put(buf, w, h, x, y - 2, OUTLINE);
      }
      break; // only the topmost hair pixel of the column
    }
  }
}

/** (b) Soft shading: darken the first skin row under the hair fringe, and the
 *  bottom skin row of the jaw (face renders only). */
function softShading(buf: Buf, w: number, h: number, r: AvatarRecipe, face: boolean): void {
  const s = SKIN[r.skin];
  const skinSet: RGB[] = [s.hi, s.base, s.sh];
  const isSkin = (x: number, y: number): boolean =>
    A(buf, w, h, x, y) === 255 && skinSet.some((p) => eqRGB(p, C(buf, w, x, y)));
  const isHair = hairMatcher(r);
  // hair meets forehead: the topmost skin pixel per column sitting right under hair
  for (let x = 0; x < w; x++) {
    for (let y = 4; y <= 26; y++) {
      if (isSkin(x, y) && A(buf, w, h, x, y - 1) === 255 && isHair(C(buf, w, x, y - 1))) {
        darken(buf, w, x, y, 0.87);
        break;
      }
      if (isSkin(x, y)) break; // skin starts without hair above — no shadow
    }
  }
  if (!face) return;
  // jawline: the lowest skin pixel per column in the jaw band (skips columns
  // where the skin continues into the neck)
  for (let x = 0; x < w; x++) {
    for (let y = 37; y >= 30; y--) {
      if (isSkin(x, y) && !isSkin(x, y + 1)) { darken(buf, w, x, y, 0.9); break; }
    }
  }
}

/** (d) Finer brows + mouth corners. Brows drawn in the skin line colour thin to
 *  one fine px (the block's top row takes the colour above it); smile/frown/grin
 *  corner blocks become 1-fine-px diagonal steps. */
/** Cartoon eyes (portrait only). The legacy eye is a 2-px slit whose pupil hugs the
 *  inner edge, which reads as a lazy eye once upscaled. Redraw each eye at fine
 *  resolution: sclera ring, a centred 2x2 iris (recipe.eyes colour), a darker pupil
 *  corner and a same-side glint on both eyes, plus a rounded lower lid row. */
function cartoonEyes(buf: Buf, w: number, h: number, r: AvatarRecipe): void {
  const s = SKIN[r.skin];
  const sclera: RGB = [250, 248, 244];
  const scleraLo: RGB = [219, 214, 207];
  const iris: RGB = r.eyes ?? [72, 56, 46];
  const pupil: RGB = [clamp(iris[0] * 0.5), clamp(iris[1] * 0.5), clamp(iris[2] * 0.5)];
  const glint: RGB = [clamp(iris[0] * 0.25 + 200), clamp(iris[1] * 0.25 + 200), clamp(iris[2] * 0.25 + 200)];
  for (const ox of [10, 20]) {
    // y18: top of the eye — sclera sides, glint + iris centre (light from the left on BOTH eyes)
    put(buf, w, h, ox, 18, sclera); put(buf, w, h, ox + 1, 18, glint);
    put(buf, w, h, ox + 2, 18, iris); put(buf, w, h, ox + 3, 18, sclera);
    // y19: sclera sides, iris + pupil centre
    put(buf, w, h, ox, 19, sclera); put(buf, w, h, ox + 1, 19, iris);
    put(buf, w, h, ox + 2, 19, pupil); put(buf, w, h, ox + 3, 19, sclera);
    // y20: rounded lower lid — shaded sclera centre, skin-shade corners
    put(buf, w, h, ox, 20, s.sh); put(buf, w, h, ox + 1, 20, scleraLo);
    put(buf, w, h, ox + 2, 20, scleraLo); put(buf, w, h, ox + 3, 20, s.sh);
  }
}

/** Soften the harsh 2-fine-px cheek stripes the legacy shading columns upscale into
 *  (highlight at fine x10-11, shadow at x24-25): colour-keyed uniform blend toward
 *  base skin so the contour survives as a soft tint instead of a hard line. */
function softenCheeks(buf: Buf, w: number, h: number, r: AvatarRecipe): void {
  const s = SKIN[r.skin];
  const blend = (a: RGB, b: RGB, t: number): RGB => [clamp(a[0] + (b[0] - a[0]) * t), clamp(a[1] + (b[1] - a[1]) * t), clamp(a[2] + (b[2] - a[2]) * t)];
  for (let y = 12; y <= 29; y++) for (const x of [10, 11, 24, 25]) {
    if (A(buf, w, h, x, y) !== 255) continue;
    const c = C(buf, w, x, y);
    const key = eqRGB(c, s.hi) || eqRGB(c, s.sh);
    if (!key) continue;
    put(buf, w, h, x, y, blend(c, s.base, 0.72));
  }
}

/** Taper the lower face: on rows 31-36 pull each cheek's silhouette inward (1 fine px,
 *  2 on the lowest rows) so the jaw narrows toward the chin instead of staying a box.
 *  Guarded: only fires where the edge is outline-over-skin, so side hair, beards and
 *  collars are never notched. The outline stays continuous (it is 2 px thick; when both
 *  px go, the newly exposed skin px is repainted as outline). */
function jawTaper(buf: Buf, w: number, h: number, r: AvatarRecipe): void {
  const s = SKIN[r.skin];
  const skinish = (c: RGB): boolean => eqRGB(c, s.base) || eqRGB(c, s.sh) || eqRGB(c, s.hi);
  for (let y = 31; y <= Math.min(h - 1, 36); y++) {
    const deep = y >= 34 ? 2 : 1;
    for (const dir of [1, -1] as const) {
      // scan inward from the side to the first opaque px of the face edge
      let x = dir === 1 ? 2 : w - 3;
      while (x >= 2 && x <= w - 3 && A(buf, w, h, x, y) === 0) x += dir;
      if (x < 2 || x > w - 3 || A(buf, w, h, x, y) === 0) continue;
      if (!eqRGB(C(buf, w, x, y), OUTLINE)) continue;                    // covered by hair → skip
      const probe = C(buf, w, x + 2 * dir, y);
      if (A(buf, w, h, x + 2 * dir, y) !== 255 || !skinish(probe)) continue; // not a bare cheek → skip
      clearPx(buf, w, h, x, y);
      if (deep === 2) { clearPx(buf, w, h, x + dir, y); put(buf, w, h, x + 2 * dir, y, OUTLINE); }
    }
  }
}

/** Extra rounding pass for the chin: repeat the convex-corner tip kill inside the jaw
 *  band (y29-38) so the jaw curves in a 2-px step instead of a hard box corner. */
function roundJaw(buf: Buf, w: number, h: number): void {
  for (let pass = 0; pass < 2; pass++) {
    const kill: [number, number][] = [];
    for (let y = 29; y <= Math.min(h - 1, 38); y++) for (let x = 6; x <= Math.min(w - 1, 29); x++) {
      if (A(buf, w, h, x, y) === 0) continue;
      const dn = A(buf, w, h, x, y + 1) === 0;
      const lf = A(buf, w, h, x - 1, y) === 0, rt = A(buf, w, h, x + 1, y) === 0;
      if ((dn && lf) || (dn && rt)) kill.push([x, y]);
    }
    for (const [x, y] of kill) clearPx(buf, w, h, x, y);
  }
}

function refineFace(buf: Buf, w: number, h: number, r: AvatarRecipe): void {
  const s = SKIN[r.skin];
  // brows: box x8..27, y10..17
  for (let y = 11; y <= 17; y++) for (let x = 8; x <= 27; x++) {
    if (A(buf, w, h, x, y) !== 255 || !eqRGB(C(buf, w, x, y), s.line)) continue;
    const above = C(buf, w, x, y - 1), below = A(buf, w, h, x, y + 1) === 255 ? C(buf, w, x, y + 1) : null;
    if (below && eqRGB(below, s.line) && !eqRGB(above, s.line) && A(buf, w, h, x, y - 1) === 255 && !eqRGB(above, OUTLINE)) {
      put(buf, w, h, x, y, above); // top fine row of a 2-tall brow block → 1-px brow
    }
  }
  // mouth corners → diagonal steps. Corner blocks (legacy px): smile/grin at
  // legacy (6,13)/(11,13) = fine x12-13/x22-23, y26-27; frown at y28-29.
  const mouth = r.mouth ?? 'neutral';
  const steps: Array<[number, number, number, number]> = []; // [clearX, clearY, clearX2, clearY2]
  if (mouth === 'smile' || mouth === 'grin') steps.push([13, 26, 12, 27], [22, 26, 23, 27]);
  else if (mouth === 'frown') steps.push([13, 28, 12, 29], [22, 28, 23, 29]);
  for (const [x1, y1, x2, y2] of steps) {
    for (const [x, y] of [[x1, y1], [x2, y2]] as const) {
      if (A(buf, w, h, x, y) !== 255 || !eqRGB(C(buf, w, x, y), MOUTH_COLOR)) continue;
      // restore the skin colour sampled directly above the corner block
      const sy = Math.min(y1, y2) - 1;
      if (A(buf, w, h, x, sy) === 255) put(buf, w, h, x, y, C(buf, w, x, sy));
    }
  }
}

export interface RefineOpts { face: boolean; }

/** All default-on refinement passes, in order. Deterministic per recipe. */
export function refine(buf: Buf, w: number, h: number, r: AvatarRecipe, opts: RefineOpts): void {
  const seed = recipeSeed(r);
  roundCorners(buf, w, h);
  hairTexture(buf, w, h, r, seed);
  softShading(buf, w, h, r, opts.face);
  if (opts.face) { refineFace(buf, w, h, r); softenCheeks(buf, w, h, r); cartoonEyes(buf, w, h, r); jawTaper(buf, w, h, r); roundJaw(buf, w, h); }
}

// ─── fine-grid feature art (new features only — never legacy recipes) ────────

/** Headband: two fine rows across the forehead / fringe line (legacy y5). */
function drawHeadband(buf: Buf, w: number, h: number, color: RGB): void {
  const [hi, base, sh] = shades(color);
  for (let x = 8; x <= 27; x++) {
    if (A(buf, w, h, x, 10) === 255) put(buf, w, h, x, 10, base);
    if (A(buf, w, h, x, 11) === 255) put(buf, w, h, x, 11, sh);
  }
  for (const x of [10, 11, 12]) if (A(buf, w, h, x, 10) === 255) put(buf, w, h, x, 10, hi);
}

/** Non-classic glasses, drawn at fine resolution over the composed face.
 *  Eye blocks sit at fine x10-13 / x20-23, y18-19. */
function drawGlassesFine(buf: Buf, w: number, h: number, style: 'round' | 'shades' | 'shades3d'): void {
  const p = (x: number, y: number, c: RGB) => put(buf, w, h, x, y, c);
  if (style === 'round') {
    const f = GLASSES_FRAME, glint: RGB = [236, 240, 246];
    for (const ox of [0, 12]) { // left ring x8..15, right ring x20..27
      for (const x of [10, 11, 12, 13]) { p(x + ox, 15, f); p(x + ox, 21, f); }
      p(9 + ox, 16, f); p(14 + ox, 16, f); p(9 + ox, 20, f); p(14 + ox, 20, f);
      for (const y of [17, 18, 19]) { p(8 + ox, y, f); p(15 + ox, y, f); }
    }
    for (const x of [16, 17, 18, 19]) p(x, 16, f); // bridge
    p(6, 17, f); p(7, 17, f); p(28, 17, f); p(29, 17, f); // temple arms
    p(10, 16, glint); p(22, 16, glint);
  } else if (style === 'shades') {
    const dark: RGB = [28, 26, 32], sheen: RGB = [58, 56, 66];
    for (const ox of [0, 12]) {
      for (let y = 16; y <= 20; y++) for (let x = 8; x <= 15; x++) p(x + ox, y, dark);
      for (let x = 9; x <= 12; x++) p(x + ox, 16, sheen); // top sheen
    }
    for (let x = 16; x <= 19; x++) { p(x, 16, dark); p(x, 17, dark); } // bridge
    for (const x of [5, 6, 7, 28, 29, 30]) { p(x, 16, dark); p(x, 17, dark); } // arms
  } else { // shades3d — white frame, red left lens, blue right lens
    const frame: RGB = [238, 238, 240], red: RGB = [206, 58, 58], blue: RGB = [64, 88, 200];
    for (const [ox, lens] of [[0, red], [12, blue]] as Array<[number, RGB]>) {
      for (let x = 8; x <= 15; x++) { p(x + ox, 15, frame); p(x + ox, 21, frame); }
      for (let y = 16; y <= 20; y++) { p(8 + ox, y, frame); p(15 + ox, y, frame); }
      for (let y = 16; y <= 20; y++) for (let x = 9; x <= 14; x++) p(x + ox, y, lens);
    }
    for (let x = 16; x <= 19; x++) { p(x, 15, frame); p(x, 16, frame); } // bridge
    for (const x of [5, 6, 7, 28, 29, 30]) p(x, 16, frame); // arms
  }
}

/** Buzz cut: stipple the near-scalp hair with skin show-through (deterministic). */
function buzzStipple(buf: Buf, w: number, h: number, r: AvatarRecipe, seed: number): void {
  const isHair = hairMatcher(r);
  const skin = SKIN[r.skin].base;
  for (let y = 4; y <= 17; y++) for (let x = 0; x < w; x++) {
    if (A(buf, w, h, x, y) !== 255 || !isHair(C(buf, w, x, y))) continue;
    if (mix(seed, x, y) % 4 === 0) {
      const c = C(buf, w, x, y);
      put(buf, w, h, x, y, [clamp(c[0] * 0.55 + skin[0] * 0.45), clamp(c[1] * 0.55 + skin[1] * 0.45), clamp(c[2] * 0.55 + skin[2] * 0.45)]);
    }
  }
}

/** Mohawk: jag the top of the central strip (fine x16..19) into 1-fine teeth. */
function mohawkJag(buf: Buf, w: number, h: number): void {
  for (const x of [17, 19]) { clearPx(buf, w, h, x, 0); clearPx(buf, w, h, x, 1); }
}

export interface FineFeatureOpts { back: boolean; }

/** Fine-resolution feature art: runs after refine(), front and back views. */
export function drawFineFeatures(buf: Buf, w: number, h: number, r: AvatarRecipe, opts: FineFeatureOpts): void {
  const seed = recipeSeed(r);
  if (!opts.back) {
    if (r.hair === 'styleBuzz') buzzStipple(buf, w, h, r, seed);
    if (r.hair === 'styleMohawk' && !r.headwear) mohawkJag(buf, w, h);
  }
  if (r.headwear === 'headband') drawHeadband(buf, w, h, r.headwearColor ?? [70, 76, 96]);
  if (!opts.back) {
    const gs = effectiveGlassesStyle(r);
    if (gs && gs !== 'classic') drawGlassesFine(buf, w, h, gs);
  }
}
