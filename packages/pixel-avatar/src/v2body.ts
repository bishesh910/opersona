/**
 * Pixie v2 walker — full-body sprite in the flat v2 style, for Office.
 * The head/hair/neck is the REAL v2 portrait (omitDome), pasted verbatim, so a
 * walker is instantly recognisable as its portrait. The body is chibi: compact
 * torso with the same diagonal garment gradient, swinging arms, alternating
 * step frames. Front (facing viewer / walking down) and back (walking up);
 * horizontal movement mirrors the front frame at the blit site.
 */
import type { AvatarRecipe, RGB } from '@opersona/shared';
import { SKIN, clamp } from './palette.js';
import { renderPortraitV2, V2_W, V2_H } from './v2.js';

export const WALKER_W = 36;
export const WALKER_H = 80;

type Buf = Uint8ClampedArray;
type Phase = 0 | 1 | 2; // stand, step-A, step-B

const mix = (a: RGB, b: RGB, t: number): RGB => [clamp(a[0] + (b[0] - a[0]) * t), clamp(a[1] + (b[1] - a[1]) * t), clamp(a[2] + (b[2] - a[2]) * t)];
const lighten = (c: RGB, f: number): RGB => [clamp(c[0] * f + 18), clamp(c[1] * f + 18), clamp(c[2] * f + 18)];
const darken = (c: RGB, f: number): RGB => [clamp(c[0] * f), clamp(c[1] * f), clamp(c[2] * f)];

export function renderWalkerV2(r: AvatarRecipe, phase: Phase, back: boolean): Buf {
  const buf = new Uint8ClampedArray(WALKER_W * WALKER_H * 4);
  const s = SKIN[r.skin];
  const put = (x: number, y: number, c: RGB): void => {
    if (x < 0 || x >= WALKER_W || y < 0 || y >= WALKER_H) return;
    const i = (y * WALKER_W + x) * 4;
    buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = 255;
  };
  const hrow = (x0: number, x1: number, y: number, c: RGB): void => { for (let x = x0; x <= x1; x++) put(x, y, c); };
  const bob = phase === 0 ? 0 : -1; // steps lift the whole figure a pixel

  const g0: RGB = r.c1;
  const g1: RGB = r.c2 ?? lighten(r.c1, 1.18);
  const sleeve = darken(g0, 0.85);
  const dk = darken(g0, 0.7);
  const pants: RGB = r.pants ?? [56, 58, 70];
  const shoe: RGB = darken(pants, 0.55);
  const grad = (x: number, y: number): RGB => {
    const t = ((x - 2) / 31 + (WALKER_H - 1 - y) / 60) / 2;
    return mix(g0, g1, Math.max(0, Math.min(1, t)));
  };

  // ── legs + shoes (drawn first — torso overlaps the hips) ───────────────────
  // step frames: one leg tucks 3px shorter, its shoe lifts; the other extends.
  const legTop = 58;
  const leg = (x0: number, x1: number, lift: number): void => {
    const footY = 73 - lift;
    for (let y = legTop; y <= footY; y++) hrow(x0, x1, y, pants);
    hrow(x0 - 1, x1 + 1, footY + 1, shoe); hrow(x0 - 1, x1 + 1, footY + 2, shoe);
  };
  const lLift = phase === 1 ? 3 : 0;
  const rLift = phase === 2 ? 3 : 0;
  leg(13, 16, lLift);
  leg(19, 22, rLift);

  // ── torso (rounded shoulders, diagonal gradient, hip rows) ─────────────────
  const torsoTop = 34 + bob;
  for (let y = torsoTop; y <= 59 + bob; y++) {
    let x0 = 11, x1 = 24;
    if (y === torsoTop) { x0 = 14; x1 = 21; }
    else if (y === torsoTop + 1) { x0 = 13; x1 = 22; }
    else if (y === torsoTop + 2) { x0 = 12; x1 = 23; }
    if (y >= 58 + bob) { x0 = 12; x1 = 23; } // hip taper
    for (let x = x0; x <= x1; x++) put(x, y, grad(x, y));
  }
  hrow(12, 23, 59 + bob, darken(g0, 0.8)); // hem line over the hips

  // ── arms (swing opposite to the legs) ──────────────────────────────────────
  const lArm = phase === 1 ? 2 : phase === 2 ? -2 : 0;
  const rArm = -lArm;
  const arm = (x0: number, dy: number): void => {
    for (let y = 38 + bob + dy; y <= 52 + bob + dy; y++) hrow(x0, x0 + 1, y, sleeve);
    hrow(x0, x0 + 1, 53 + bob + dy, s.base); hrow(x0, x0 + 1, 54 + bob + dy, s.base); // hands
  };
  arm(9, lArm);
  arm(25, rArm);

  // ── garment details (front only; backs stay plain) ─────────────────────────
  if (!back) {
    const shirtWhite: RGB = [240, 238, 232];
    if (r.cloth === 'suit') {
      for (const [vy, half] of [[0, 3], [1, 2], [2, 2], [3, 1], [4, 1], [5, 0]] as const) {
        hrow(17 - half, 18 + half, torsoTop + vy, shirtWhite);
        put(16 - half, torsoTop + vy, dk); put(19 + half, torsoTop + vy, dk);
      }
    } else if (r.cloth === 'dressshirt') {
      put(14, torsoTop + 1, dk); put(15, torsoTop + 1, dk); put(21, torsoTop + 1, dk); put(20, torsoTop + 1, dk);
      for (const by of [4, 8, 12, 16]) { put(17, torsoTop + by, dk); put(18, torsoTop + by, dk); }
    } else if (r.cloth === 'cardigan') {
      for (let y = torsoTop + 2; y <= 57 + bob; y++) { hrow(16, 19, y, shirtWhite); put(15, y, dk); put(20, y, dk); }
      for (const by of [8, 14]) put(19, torsoTop + by, dk);
    } else if (r.cloth === 'polo') {
      put(14, torsoTop + 1, dk); put(21, torsoTop + 1, dk); put(17, torsoTop + 3, dk); put(18, torsoTop + 3, dk);
    } else if (r.cloth === 'sweater') {
      hrow(14, 21, torsoTop, dk); // ribbed collar
    } else if (r.cloth === 'blouse') {
      hrow(13, 22, torsoTop, lighten(g0, 1.35));
    }
    if (r.tie) { for (let y = torsoTop + 1; y <= torsoTop + 7; y++) hrow(17, 18, y, r.tie); put(16, torsoTop + 1, r.tie); put(19, torsoTop + 1, r.tie); }
  }
  if (r.clothAccent) { hrow(14, 21, torsoTop, r.clothAccent); hrow(12, 23, torsoTop + 1, r.clothAccent); }

  // ── head ───────────────────────────────────────────────────────────────────
  if (!back) {
    // the actual v2 portrait head (hair drapes included), pasted over the torso
    const head = renderPortraitV2(r, { omitDome: true });
    for (let y = 0; y < V2_H && y + bob < WALKER_H; y++) {
      for (let x = 0; x < V2_W; x++) {
        const i = (y * V2_W + x) * 4;
        if (head[i + 3]! > 0 && y + bob >= 0) put(x, y + bob, [head[i]!, head[i + 1]!, head[i + 2]!]);
      }
    }
  } else {
    drawHeadBack(r, put, hrow, bob);
  }
  return buf;
}

/** Back of the head: hair silhouette per style (no face), same flat look. */
function drawHeadBack(
  r: AvatarRecipe,
  put: (x: number, y: number, c: RGB) => void,
  hrow: (x0: number, x1: number, y: number, c: RGB) => void,
  bob: number,
): void {
  const s = SKIN[r.skin];
  const hc: RGB = r.hairc;
  const mirror = (x: number): number => 35 - x;
  // neck first (visible under short styles)
  for (let y = 27; y <= 34; y++) hrow(15, 20, y + bob, s.base);
  const skull = (c: RGB, topY = 5): void => {
    for (let y = topY; y <= 26; y++) {
      let x0 = 11, x1 = 24;
      if (y === topY) { x0 = 13; x1 = 22; } else if (y === topY + 1) { x0 = 12; x1 = 23; }
      if (y === 25) { x0 = 12; x1 = 23; } else if (y === 26) { x0 = 14; x1 = 21; }
      hrow(x0, x1, y + bob, c);
    }
  };
  switch (r.hair) {
    case 'styleBald': skull(s.base, 8); break;
    case 'styleBuzz': skull(mix(hc, s.base, 0.45), 6); break;
    case 'styleMohawk': skull(mix(hc, s.base, 0.55), 6); for (let y = 1; y <= 22; y++) hrow(16, 19, y + bob, hc); break;
    case 'styleBun': skull(hc); for (let y = 1; y <= 5; y++) { const halfw = y === 1 || y === 5 ? 2 : 3; hrow(17 - halfw, 18 + halfw, y + bob, hc); } break;
    case 'styleCurly': { for (let y = 3; y <= 16; y++) { const x0 = y <= 4 ? 11 : 8; hrow(x0, mirror(x0), y + bob, hc); } skull(hc, 5); break; }
    case 'styleSpiky': skull(hc, 5); for (const [sx, sy] of [[12, 3], [15, 2], [18, 1], [21, 2], [24, 3]] as const) { put(sx, sy + bob, hc); put(sx, sy + 1 + bob, hc); } break;
    case 'styleLong': { skull(hc, 3); for (let y = 5; y <= 48; y++) hrow(9, 26, y + bob, hc); hrow(10, 25, 49 + bob, hc); hrow(12, 23, 50 + bob, hc); break; }
    case 'styleLob': { skull(hc, 4); for (let y = 6; y <= 36; y++) hrow(9, 26, y + bob, hc); hrow(10, 25, 37 + bob, hc); break; }
    case 'styleBob': { skull(hc, 4); for (let y = 6; y <= 23; y++) hrow(9, 26, y + bob, hc); hrow(10, 25, 24 + bob, hc); break; }
    case 'styleFrame': { skull(hc, 6); for (let y = 7; y <= 41; y++) hrow(10, 25, y + bob, hc); hrow(11, 24, 42 + bob, hc); break; }
    default: skull(hc); break; // short/floppy/messy/recede: plain rounded silhouette
  }
  if (r.hairTip) { // dip-dye visible from behind on the hanging lengths
    const ends: Partial<Record<string, [number, number, number]>> = {
      styleLong: [9, 26, 48], styleLob: [9, 26, 36], styleBob: [9, 26, 23], styleFrame: [10, 25, 41],
    };
    const e = ends[r.hair];
    if (e) { hrow(e[0], e[1], e[2] + bob, r.hairTip); hrow(e[0], e[1], e[2] - 1 + bob, r.hairTip); }
  }
  // headwear from behind
  if (r.headwear) {
    const hcw: RGB = r.headwearColor ?? [70, 76, 96];
    if (r.headwear === 'beanie') { for (let y = 3; y <= 10; y++) { const x0 = y <= 4 ? 13 : y === 5 ? 12 : 11; hrow(x0, mirror(x0), y + bob, hcw); } hrow(11, 24, 9 + bob, darken(hcw, 0.8)); hrow(11, 24, 10 + bob, darken(hcw, 0.8)); }
    else if (r.headwear === 'cap') { for (let y = 3; y <= 9; y++) { const x0 = y <= 4 ? 13 : y === 5 ? 12 : 11; hrow(x0, mirror(x0), y + bob, hcw); } hrow(11, 24, 10 + bob, darken(hcw, 0.78)); }
    else if (r.headwear === 'fedora') { for (let y = 2; y <= 7; y++) { const x0 = y <= 3 ? 13 : 12; hrow(x0, mirror(x0), y + bob, hcw); } hrow(12, 23, 7 + bob, darken(hcw, 0.6)); hrow(8, 27, 8 + bob, hcw); hrow(9, 26, 9 + bob, darken(hcw, 0.85)); }
    else if (r.headwear === 'hoodie') { for (let y = 2; y <= 12; y++) { const x0 = y <= 3 ? 12 : 10; hrow(x0, mirror(x0), y + bob, hcw); } for (let y = 13; y <= 36; y++) hrow(10, 25, y + bob, hcw); hrow(11, 24, 37 + bob, darken(hcw, 0.9)); }
    else { hrow(11, 24, 9 + bob, hcw); hrow(11, 24, 10 + bob, darken(hcw, 0.85)); } // headband
  }
}

export interface WalkerFrames { front: Buf[]; back: Buf[]; }

/** All six walker frames (stand, step-A, step-B × front/back). */
export function walkerFramesV2(r: AvatarRecipe): WalkerFrames {
  return {
    front: [renderWalkerV2(r, 0, false), renderWalkerV2(r, 1, false), renderWalkerV2(r, 2, false)],
    back: [renderWalkerV2(r, 0, true), renderWalkerV2(r, 1, true), renderWalkerV2(r, 2, true)],
  };
}
