/**
 * Pixie v2 — flat "cute pixel portrait" style (reference: modern pixel avatar
 * illustration packs): no outlines, rounded organic shapes, a big gradient
 * shoulder dome, tiny solid features, blush, chunky flat hair silhouettes.
 *
 * Same 36×56 canvas and AvatarRecipe as the legacy engine, so the editor,
 * vision extractor and stored recipes all keep working. The legacy engine
 * remains the renderer for the walking scene sprites (The Office).
 */
import type { AvatarRecipe, RGB } from '@opersona/shared';
import { SKIN, clamp } from './palette.js';

export const V2_W = 36;
export const V2_H = 56;

/** Eye pixels (for the blink frame): two 2×2 blocks. */
export const V2_EYES: { x: number; y: number }[][] = [
  [{ x: 13, y: 17 }, { x: 14, y: 17 }, { x: 13, y: 18 }, { x: 14, y: 18 }],
  [{ x: 21, y: 17 }, { x: 22, y: 17 }, { x: 21, y: 18 }, { x: 22, y: 18 }],
];

type Buf = Uint8ClampedArray;

const CXL = 17; // left of the two centre columns (centre is 17.5)

const mix = (a: RGB, b: RGB, t: number): RGB => [clamp(a[0] + (b[0] - a[0]) * t), clamp(a[1] + (b[1] - a[1]) * t), clamp(a[2] + (b[2] - a[2]) * t)];
const lighten = (c: RGB, f: number): RGB => [clamp(c[0] * f + 18), clamp(c[1] * f + 18), clamp(c[2] * f + 18)];
const darken = (c: RGB, f: number): RGB => [clamp(c[0] * f), clamp(c[1] * f), clamp(c[2] * f)];

export function renderPortraitV2(r: AvatarRecipe): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(V2_W * V2_H * 4);
  const s = SKIN[r.skin];
  const hairMask = new Uint8Array(V2_W * V2_H);

  const put = (x: number, y: number, c: RGB, a = 255): void => {
    if (x < 0 || x >= V2_W || y < 0 || y >= V2_H) return;
    const i = (y * V2_W + x) * 4;
    buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = a;
  };
  const blendPx = (x: number, y: number, c: RGB, t: number): void => {
    if (x < 0 || x >= V2_W || y < 0 || y >= V2_H) return;
    const i = (y * V2_W + x) * 4;
    if (buf[i + 3] === 0) return;
    put(x, y, mix([buf[i]!, buf[i + 1]!, buf[i + 2]!], c, t));
  };
  const opaque = (x: number, y: number): boolean => x >= 0 && x < V2_W && y >= 0 && y < V2_H && buf[(y * V2_W + x) * 4 + 3]! > 0;
  const clearPx = (x: number, y: number): void => {
    if (x < 0 || x >= V2_W || y < 0 || y >= V2_H) return;
    const i = (y * V2_W + x) * 4;
    buf[i] = 0; buf[i + 1] = 0; buf[i + 2] = 0; buf[i + 3] = 0;
  };
  const hrow = (x0: number, x1: number, y: number, c: RGB): void => { for (let x = x0; x <= x1; x++) put(x, y, c); };
  const hair = (x0: number, x1: number, y: number, c: RGB): void => {
    for (let x = x0; x <= x1; x++) { put(x, y, c); if (x >= 0 && x < V2_W && y >= 0 && y < V2_H) hairMask[y * V2_W + x] = 1; }
  };
  const hpx = (x: number, y: number, c: RGB): void => hair(x, x, y, c);

  const hairC: RGB = r.hairc;
  const mirror = (x: number): number => 35 - x; // symmetric about 17.5

  // shoulder dome geometry (used by back hair + clothing): wide flat-top superellipse
  const rx = 13.5 + (r.heavy ? 1 : 0), ry = 22, cy = 56;
  const domeTopAt = (x: number): number => {
    // quantise by distance-from-centre into symmetric pairs → chunky 2-px stairs (reference look)
    const adx = Math.floor((Math.abs(x - 17.5) - 0.5) / 2) * 2 + 1;
    const q = 1 - Math.pow(adx / rx, 4); // flat top, quick rolloff at the edges
    if (q <= 0) return V2_H;
    let top = Math.ceil(cy - ry * Math.pow(q, 0.25));
    if (adx < 5) top = Math.max(top, 34 - Math.floor(adx / 2)); // neckline dips around the neck
    return top;
  };


  // ── head ───────────────────────────────────────────────────────────────────
  // face x11..24, y8..26 with rounded top corners and a rounded chin
  for (let y = 8; y <= 26; y++) {
    let x0 = 11, x1 = 24;
    if (y === 8) { x0 = 13; x1 = 22; }
    else if (y === 9) { x0 = 12; x1 = 23; }
    if (y === 25) { x0 = 12; x1 = 23; }
    else if (y === 26) { x0 = 14; x1 = 21; }
    hrow(x0, x1, y, s.base);
  }
  // ears (stick out, rounded, inner shadow) — hidden under long side hair
  for (const ex of r.hair === 'styleFrame' ? [] : [10, 25]) {
    put(ex, 16, s.base); put(ex, 17, s.base); put(ex, 18, s.base); put(ex, 19, s.base);
    put(ex === 10 ? 9 : 26, 17, s.base); put(ex === 10 ? 9 : 26, 18, s.base);
    put(ex, 17, s.sh); // inner-ear shadow
  }

  // ── features ───────────────────────────────────────────────────────────────
  const iris: RGB = r.eyes ?? [46, 38, 42];
  const eyeC: RGB = [clamp(22 + iris[0] * 0.28), clamp(20 + iris[1] * 0.28), clamp(20 + iris[2] * 0.28)];
  for (const eye of V2_EYES) for (const { x, y } of eye) put(x, y, eyeC);
  if (r.lashes) { // tiny outward lash wing + upper lash row, like the reference wink girl
    put(12, 16, eyeC); put(23, 16, eyeC);
    put(13, 16, eyeC); put(22, 16, eyeC);
  }

  const browC = darken(hairC, 0.75);
  const brow = r.brow ?? 'flat';
  const browRow = (y: number): void => { hrow(12, 14, y, browC); hrow(21, 23, y, browC); };
  if (brow === 'flat') browRow(15);
  else if (brow === 'raised') browRow(14);
  else if (brow === 'angry') { put(14, 15, browC); put(13, 14, browC); put(12, 14, browC); put(21, 15, browC); put(22, 14, browC); put(23, 14, browC); }
  else { hrow(12, 13, 15, browC); hrow(22, 23, 15, browC); } // soft: shorter

  // nose: tiny vertical hint
  put(18, 19, s.sh); put(18, 20, s.sh);

  // mouth
  const rose: RGB = mix(s.sh, [178, 96, 92], 0.55);
  const mouth = r.mouth ?? 'neutral';
  if (mouth === 'neutral') hrow(16, 19, 22, rose);
  else if (mouth === 'smile') { hrow(16, 19, 22, rose); put(15, 21, rose); put(20, 21, rose); }
  else if (mouth === 'frown') { hrow(16, 19, 22, rose); put(15, 23, rose); put(20, 23, rose); }
  else { // grin — white teeth block with a rosy lip line above
    hrow(15, 20, 21, rose);
    hrow(15, 20, 22, [246, 244, 240]); hrow(15, 20, 23, [234, 230, 224]);
    put(14, 21, rose); put(21, 21, rose);
  }

  if (r.blush) { for (const bx of [12, 13]) { blendPx(bx, 20, [232, 130, 122], 0.5); blendPx(mirror(bx), 20, [232, 130, 122], 0.5); } }
  if (r.freckles) { for (const [fx, fy] of [[13, 20], [15, 19], [20, 19], [22, 20]] as const) blendPx(fx, fy, darken(s.sh, 0.85), 0.6); }

  // ── facial hair ────────────────────────────────────────────────────────────
  const fh = darken(hairC, 0.92);
  if (r.facial === 'mustache') { hrow(14, 16, 20, fh); hrow(19, 21, 20, fh); put(14, 21, fh); put(21, 21, fh); }
  else if (r.facial === 'mustacheSm') { hrow(15, 16, 21, fh); hrow(19, 20, 21, fh); }
  else if (r.facial === 'stubble') { for (let y = 21; y <= 26; y++) for (let x = 11; x <= 24; x++) if (opaque(x, y) && !(y === 22 && x >= 15 && x <= 20)) blendPx(x, y, fh, 0.28); }
  else if (r.facial === 'goatee') {
    // beard wrapping the chin (reference bald-guy style, scaled down)
    for (let y = 23; y <= 26; y++) { const x0 = y >= 25 ? 13 : 12; hrow(x0, mirror(x0), y, fh); }
    hrow(14, 21, 27, fh);
    // keep the mouth visible inside the beard
    if (mouth === 'grin') { hrow(15, 20, 22, [246, 244, 240]); hrow(15, 20, 23, [234, 230, 224]); }
    else hrow(16, 19, 22 as number, rose);
  }

  // ── front hair ─────────────────────────────────────────────────────────────
  const part = r.hairargs?.part ?? 'L';
  const flip = (x: number): number => (part === 'L' ? x : mirror(x));
  const drawCap = (topY: number, fringeY: number, sideY: number): void => {
    for (let y = topY; y < fringeY; y++) {
      let x0 = 11, x1 = 24;
      if (y === topY) { x0 = 13; x1 = 22; } else if (y === topY + 1) { x0 = 12; x1 = 23; }
      hair(x0, x1, y, hairC);
    }
    for (let y = fringeY; y <= sideY; y++) { hair(11, 12, y, hairC); hair(23, 24, y, hairC); } // temples
  };
  switch (r.hair) {
    case 'styleShort': drawCap(5, 11, 13); hair(13, 15, 10, hairC); break;
    case 'styleBuzz': {
      const bz = mix(hairC, s.base, 0.45);
      for (let y = 6; y < 10; y++) { const x0 = y === 6 ? 13 : y === 7 ? 12 : 11; hair(x0, mirror(x0), y, bz); }
      hair(11, 12, 10, bz); hair(23, 24, 10, bz);
      break;
    }
    case 'styleRecede': { const d = Math.min(3, r.hairargs?.recede ?? 1); for (let y = 6 + d; y <= 9 + d; y++) hair(14, 21, y, hairC); hair(11, 12, 11, hairC); hair(23, 24, 11, hairC); break; }
    case 'styleFloppy': {
      // asymmetric swoosh with a little flick sticking out (reference boy)
      for (let y = 5; y <= 8; y++) { const x0 = y === 5 ? 13 : 11; hair(x0, y === 5 ? 22 : 24, y, hairC); }
      for (let x = 11; x <= 24; x++) { const t = (flip(x) - 11) / 13; const fy = 12 - Math.round(t * 3); for (let y = 9; y <= fy; y++) hpx(x, y, hairC); }
      hpx(flip(9), 6, hairC); hpx(flip(10), 6, hairC); hpx(flip(9), 7, hairC); // flick
      hpx(flip(11), 13, hairC); hpx(flip(24), 9, hairC);
      break;
    }
    case 'styleMessy': {
      drawCap(5, 10, 12);
      for (const [tx, ty] of [[13, 4], [17, 3], [21, 4], [15, 4], [19, 3]] as const) { hpx(tx, ty, hairC); hpx(tx, ty + 1, hairC); }
      for (const x of [12, 15, 18, 21, 24]) hpx(x, 10, hairC); // uneven fringe teeth
      break;
    }
    case 'styleSpiky': {
      drawCap(6, 10, 12);
      for (const [sx, sy] of [[12, 4], [15, 3], [18, 2], [21, 3], [24, 4]] as const) { hpx(sx, sy, hairC); hpx(sx, sy + 1, hairC); hpx(sx + (sx < 18 ? 1 : -1), sy + 1, hairC); }
      hrow(11, 24, 5, hairC); for (let x = 11; x <= 24; x++) hairMask[5 * V2_W + x] = 1;
      break;
    }
    case 'styleCurly': {
      const vol = Math.min(1, r.hairargs?.vol ?? 1);
      // big cloud: tall bumpy crown overflowing the skull + side puffs
      for (let y = 3; y <= 12; y++) { const x0 = y <= 4 ? 12 : 9 - vol; hair(x0, mirror(x0), y, hairC); }
      for (const [bx, by] of [[12, 2], [15, 1], [19, 1], [22, 2], [17, 1]] as const) { hpx(bx, by, hairC); hpx(bx + 1, by, hairC); }
      hair(13, 22, 2, hairC);
      for (let y = 13; y <= 16; y++) { hair(8 - vol, 10, y, hairC); hair(25, 27 + vol, y, hairC); } // puffs over the temples/ears
      break;
    }
    case 'styleBun': {
      drawCap(6, 10, 12);
      for (let y = 1; y <= 5; y++) { const halfw = y === 1 || y === 5 ? 2 : 3; hair(CXL - halfw, CXL + 1 + halfw, y, hairC); }
      break;
    }
    case 'styleFrame': {
      for (let y = 6; y <= 10; y++) { const x0 = y === 6 ? 13 : y === 7 ? 12 : 11; hair(x0, mirror(x0), y, hairC); }
      break;
    }
    case 'styleMohawk': {
      const bz = mix(hairC, s.base, 0.55);
      hair(11, 12, 8, bz); hair(23, 24, 8, bz); // shaved sides hint
      for (let y = 1; y <= 8; y++) hair(16, 19, y, hairC);
      break;
    }
    case 'styleBald': break;
  }

  // ── neck ───────────────────────────────────────────────────────────────────
  for (let y = 27; y <= 34; y++) hrow(15, 20, y, s.base);
  hrow(15, 20, 27, s.sh); hrow(15, 20, 28, s.sh); // shadow under the chin

  // ── shoulder dome (gradient) ───────────────────────────────────────────────
  const g0: RGB = r.c1;
  const g1: RGB = r.c2 ?? lighten(r.c1, 1.18);
  for (let x = 2; x <= 33; x++) {
    const top = domeTopAt(x);
    for (let y = top; y < V2_H; y++) {
      const t = ((x - 2) / 31 + (V2_H - 1 - y) / (V2_H - 36)) / 2; // diagonal gradient
      put(x, y, mix(g0, g1, Math.max(0, Math.min(1, t))));
    }
  }
  // collar details
  if (r.clothAccent) { for (let x = 2; x <= 33; x++) { const top = domeTopAt(x); if (top < V2_H) { put(x, top, r.clothAccent); put(x, top + 1, r.clothAccent); } } }
  if ((r.cloth === 'suit' || r.cloth === 'dressshirt') && !r.clothAccent) {
    const nc = r.cloth === 'suit' ? darken(g0, 0.72) : lighten(g0, 1.28);
    for (const dx of [-3, -2, 2, 3]) { const x = Math.round(17.5 + dx); put(x, domeTopAt(x), nc); }
  }
  if (r.tie) { for (let y = 35; y <= 40; y++) hrow(17, 18, y, r.tie); put(16, 35, r.tie); put(19, 35, r.tie); }

  // ── long hair drapes over the shoulders (styleFrame), reference-style ──────
  if (r.hair === 'styleFrame') {
    for (let y = 7; y <= 41; y++) { hair(7, 10, y, hairC); hair(25, 28, y, hairC); }
    hair(8, 10, 42, hairC); hair(25, 27, 42, hairC); // rounded ends
    for (let y = 8; y <= 26; y++) { hpx(11, y, hairC); hpx(24, y, hairC); } // frame the face edge
  }
  // dip-dye: recolour the lowest hair pixel of every column
  if (r.hairTip) {
    for (let x = 0; x < V2_W; x++) {
      for (let y = V2_H - 1; y >= 0; y--) if (hairMask[y * V2_W + x]) { put(x, y, r.hairTip); if (y > 0 && hairMask[(y - 1) * V2_W + x]) put(x, y - 1, r.hairTip); break; }
    }
  }

  // ── glasses ────────────────────────────────────────────────────────────────
  const gstyle = r.glassesStyle ?? (r.glasses ? 'classic' : undefined);
  if (gstyle) {
    const f: RGB = gstyle === 'shades3d' ? [238, 238, 240] : [42, 40, 46];
    const boxes: Array<[number, number]> = [[12, 15], [20, 23]];
    if (gstyle === 'shades') {
      for (const [x0, x1] of boxes) for (let y = 16; y <= 19; y++) hrow(x0, x1, y, [30, 28, 34]);
      hrow(16, 19, 16, [30, 28, 34]); put(11, 16, [30, 28, 34]); put(24, 16, [30, 28, 34]);
    } else if (gstyle === 'shades3d') {
      for (const [i, [x0, x1]] of boxes.entries()) {
        const lens: RGB = i === 0 ? [206, 58, 58] : [64, 88, 200];
        for (let y = 16; y <= 19; y++) hrow(x0, x1, y, lens);
        hrow(x0, x1, 15, f); hrow(x0, x1, 20, f); put(x0 - 1, 16, f); put(x0 - 1, 19, f); put(x1 + 1, 16, f); put(x1 + 1, 19, f);
      }
      hrow(16, 19, 16, f);
    } else {
      for (const [x0, x1] of boxes) {
        hrow(x0, x1, 15, f); hrow(x0, x1, 19, f);
        for (let y = 16; y <= 18; y++) { put(x0 - 1, y, f); put(x1 + 1, y, f); }
        if (gstyle === 'round') { clearGlassCorner(put, buf, x0, x1); }
      }
      hrow(17, 18, 16, f); put(10, 16, f); put(25, 16, f);
    }
  }

  // ── earrings ───────────────────────────────────────────────────────────────
  if (r.earrings) {
    const ec: RGB = r.earringColor ?? [212, 172, 60];
    for (const ex of [9, 26]) {
      put(ex, 20, ec);
      if (r.earrings === 'hoop') { put(ex, 21, ec); put(ex === 9 ? 10 : 25, 21, ec); }
    }
  }

  // ── headwear (covers hair) ─────────────────────────────────────────────────
  if (r.headwear) {
    const hc: RGB = r.headwearColor ?? [70, 76, 96];
    const hatLine = r.headwear === 'fedora' ? 9 : 10;
    if (r.headwear !== 'headband') {
      for (let y = 0; y < hatLine; y++) for (let x = 0; x < V2_W; x++) if (hairMask[y * V2_W + x]) clearPx(x, y);
    }
    if (r.headwear === 'beanie') {
      for (let y = 3; y <= 10; y++) { const x0 = y <= 4 ? 13 : y === 5 ? 12 : 11; hrow(x0, mirror(x0), y, hc); }
      hrow(11, 24, 9, darken(hc, 0.8)); hrow(11, 24, 10, darken(hc, 0.8)); // folded band
    } else if (r.headwear === 'cap') {
      for (let y = 3; y <= 9; y++) { const x0 = y <= 4 ? 13 : y === 5 ? 12 : 11; hrow(x0, mirror(x0), y, hc); }
      hrow(10, 25, 10, darken(hc, 0.78)); // brim
      put(17, 3, lighten(hc, 1.2)); put(18, 3, lighten(hc, 1.2)); // button
    } else if (r.headwear === 'fedora') {
      for (let y = 2; y <= 7; y++) { const x0 = y <= 3 ? 13 : 12; hrow(x0, mirror(x0), y, hc); }
      hrow(12, 23, 7, darken(hc, 0.6)); // band
      hrow(8, 27, 8, hc); hrow(9, 26, 9, darken(hc, 0.85)); // wide brim
    } else if (r.headwear === 'hoodie') {
      for (let y = 2; y <= 6; y++) { const x0 = y <= 3 ? 12 : 10; hrow(x0, mirror(x0), y, hc); }
      for (let y = 7; y <= 36; y++) { hrow(8, 9, y, hc); hrow(26, 27, y, hc); }
      hrow(10, 12, 7, hc); hrow(23, 25, 7, hc);
    } else { // headband
      hrow(11, 24, 9, hc); hrow(11, 24, 10, darken(hc, 0.85));
    }
  }

  return buf;
}

/** Round-lens helper: soften the four frame corners (kept out of the main flow for clarity). */
function clearGlassCorner(put: (x: number, y: number, c: RGB, a?: number) => void, buf: Uint8ClampedArray, x0: number, x1: number): void {
  // repaint the sharp frame corners with the pixel below them (cheap rounding)
  for (const [cx, cy] of [[x0, 15], [x1, 15], [x0, 19], [x1, 19]] as const) {
    const i = ((cy + (cy === 15 ? 1 : -1)) * V2_W + cx) * 4;
    if (buf[i + 3]! > 0) put(cx, cy, [buf[i]!, buf[i + 1]!, buf[i + 2]!]);
  }
}
