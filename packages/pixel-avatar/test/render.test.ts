import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
import { SKIN_TONES, HAIR_STYLES, CLOTHES, BROWS, MOUTHS, FACIAL, DEFAULT_RECIPE, type AvatarRecipe } from '@opersona/shared';
import {
  PORTRAIT_W, PORTRAIT_H, SCENE_W, SCENE_H,
  renderPortrait, renderSceneFrames, portraitPNG, spriteSheetPNG, toPNG, validateRecipe,
} from '../src/index.js';
import { CAST } from './fixtures/cast.js';

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function opaqueCount(buf: Uint8ClampedArray): number {
  let n = 0;
  for (let i = 3; i < buf.length; i += 4) if (buf[i]! > 0) n++;
  return n;
}

describe('cast fixtures', () => {
  for (const [name, recipe] of Object.entries(CAST)) {
    it(`${name} renders a portrait + scene frames`, () => {
      const buf = renderPortrait(recipe);
      expect(buf.length).toBe(PORTRAIT_W * PORTRAIT_H * 4);
      expect(opaqueCount(buf)).toBeGreaterThan(100);
      const frames = renderSceneFrames(recipe);
      expect(frames.front).toHaveLength(3);
      expect(frames.back).toHaveLength(3);
      for (const f of [...frames.front, ...frames.back]) {
        expect(f.length).toBe(SCENE_W * SCENE_H * 4);
        expect(opaqueCount(f)).toBeGreaterThan(100);
      }
      // walk phases actually differ (a foot lifts)
      expect(Buffer.from(frames.front[0]!).equals(Buffer.from(frames.front[1]!))).toBe(false);
    });
  }
});

describe('every enum value renders', () => {
  const base: AvatarRecipe = { ...DEFAULT_RECIPE };
  const cases: Array<[string, Partial<AvatarRecipe>]> = [
    ...SKIN_TONES.map((skin): [string, Partial<AvatarRecipe>] => [`skin=${skin}`, { skin }]),
    ...HAIR_STYLES.map((hair): [string, Partial<AvatarRecipe>] => [`hair=${hair}`, { hair }]),
    ...CLOTHES.map((cloth): [string, Partial<AvatarRecipe>] => [`cloth=${cloth}`, { cloth }]),
    ...BROWS.map((brow): [string, Partial<AvatarRecipe>] => [`brow=${brow}`, { brow }]),
    ...MOUTHS.map((mouth): [string, Partial<AvatarRecipe>] => [`mouth=${mouth}`, { mouth }]),
    ...FACIAL.map((facial): [string, Partial<AvatarRecipe>] => [`facial=${facial}`, { facial }]),
    ['glasses+lashes+blush+heavy', { glasses: true, lashes: true, blush: true, heavy: true }],
    ['tie+pants+c2', { tie: [1, 2, 3], pants: [4, 5, 6], c2: [7, 8, 9] }],
  ];
  for (const [label, patch] of cases) {
    it(label, () => {
      const recipe = validateRecipe({ ...base, ...patch });
      expect(opaqueCount(renderPortrait(recipe))).toBeGreaterThan(100);
      const { front, back } = renderSceneFrames(recipe);
      for (const f of [...front, ...back]) expect(opaqueCount(f)).toBeGreaterThan(100);
    });
  }
});

describe('PNG output', () => {
  it('portraitPNG has the PNG signature and decodes to 18*scale wide', () => {
    for (const scale of [1, 3, 8]) {
      const png = portraitPNG(CAST.michael!, scale);
      expect([...png.subarray(0, 8)]).toEqual(PNG_SIG);
      const decoded = PNG.sync.read(png);
      expect(decoded.width).toBe(PORTRAIT_W * scale);
      expect(decoded.height).toBe(PORTRAIT_H * scale);
    }
  });
  it('upscale is nearest-neighbour (each source pixel becomes a scale×scale block)', () => {
    const buf = renderPortrait(CAST.dwight!);
    const scale = 4;
    const decoded = PNG.sync.read(toPNG(buf, PORTRAIT_W, PORTRAIT_H, scale));
    for (let y = 0; y < PORTRAIT_H; y++) for (let x = 0; x < PORTRAIT_W; x++) {
      const si = (y * PORTRAIT_W + x) * 4;
      for (const [dx, dy] of [[0, 0], [scale - 1, scale - 1]]) {
        const di = ((y * scale + dy!) * decoded.width + x * scale + dx!) * 4;
        for (let c = 0; c < 4; c++) expect(decoded.data[di + c]).toBe(buf[si + c]);
      }
    }
  });
  it('spriteSheetPNG is 6 frames wide', () => {
    const png = spriteSheetPNG(CAST.pam!, 2);
    const decoded = PNG.sync.read(png);
    expect(decoded.width).toBe(SCENE_W * 6 * 2);
    expect(decoded.height).toBe(SCENE_H * 2);
  });
});

describe('determinism', () => {
  it('same recipe → identical buffers and PNG bytes', () => {
    for (const recipe of Object.values(CAST)) {
      const a = renderPortrait(recipe), b = renderPortrait(recipe);
      expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
      const fa = renderSceneFrames(recipe), fb = renderSceneFrames(recipe);
      for (let i = 0; i < 3; i++) {
        expect(Buffer.from(fa.front[i]!).equals(Buffer.from(fb.front[i]!))).toBe(true);
        expect(Buffer.from(fa.back[i]!).equals(Buffer.from(fb.back[i]!))).toBe(true);
      }
      expect(portraitPNG(recipe, 2).equals(portraitPNG(recipe, 2))).toBe(true);
    }
  });
  it('portrait is unaffected by a scene render in between (shared canvas dims reset)', () => {
    const a = renderPortrait(CAST.jim!);
    renderSceneFrames(CAST.jim!);
    const b = renderPortrait(CAST.jim!);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});

describe('validateRecipe', () => {
  it('accepts every cast member and rejects junk', () => {
    for (const recipe of Object.values(CAST)) expect(validateRecipe(recipe)).toEqual(recipe);
    expect(() => validateRecipe({ ...DEFAULT_RECIPE, hair: 'mullet' })).toThrow();
    expect(() => validateRecipe({ ...DEFAULT_RECIPE, hairc: [0, 0, 999] })).toThrow();
    expect(() => validateRecipe(null)).toThrow();
  });
});

// ── detail fields (eyes/earrings/freckles/hairTip/clothAccent/headwear) ──────
import { EARRINGS, HEADWEAR } from '@opersona/shared';
import { avatarStateFrames } from '../src/index.js';
import LEGACY from './fixtures/legacy-buffers.json' with { type: 'json' };

describe('legacy regression: recipes without detail fields render byte-identical', () => {
  for (const [name, snap] of Object.entries(LEGACY as Record<string, { recipe: unknown; portrait: string; scene: { front: string[]; back: string[] } }>)) {
    // validateRecipe doubles as the schema-backward-compat check: a stored
    // pre-detail-fields recipe must still parse.
    it(`${name} portrait is byte-equal to the pre-detail-fields snapshot`, () => {
      expect(Buffer.from(renderPortrait(validateRecipe(snap.recipe))).equals(Buffer.from(snap.portrait, 'base64'))).toBe(true);
    });
    it(`${name} scene frames are byte-equal to the pre-detail-fields snapshot`, () => {
      const frames = renderSceneFrames(validateRecipe(snap.recipe));
      for (let i = 0; i < 3; i++) {
        expect(Buffer.from(frames.front[i]!).equals(Buffer.from(snap.scene.front[i]!, 'base64'))).toBe(true);
        expect(Buffer.from(frames.back[i]!).equals(Buffer.from(snap.scene.back[i]!, 'base64'))).toBe(true);
      }
    });
  }
});

describe('detail fields', () => {
  const base: AvatarRecipe = { ...DEFAULT_RECIPE };
  const detailCases: Array<[string, Partial<AvatarRecipe>]> = [
    ['eyes', { eyes: [70, 120, 180] }],
    ...EARRINGS.map((earrings): [string, Partial<AvatarRecipe>] => [`earrings=${earrings}`, { earrings }]),
    ['earrings+color', { earrings: 'stud', earringColor: [200, 200, 210] }],
    ['freckles', { freckles: true }],
    ['hairTip', { hairTip: [200, 60, 160] }],
    ['clothAccent', { clothAccent: [240, 240, 240] }],
    ...HEADWEAR.map((headwear): [string, Partial<AvatarRecipe>] => [`headwear=${headwear}`, { headwear }]),
    ['headwear+color', { headwear: 'cap', headwearColor: [180, 40, 40] }],
    ['everything', { eyes: [60, 130, 90], earrings: 'hoop', earringColor: [200, 200, 210], freckles: true, hairTip: [220, 120, 200], clothAccent: [230, 230, 230], headwear: 'beanie', headwearColor: [150, 60, 60] }],
  ];
  for (const [label, patch] of detailCases) {
    it(`${label} renders and changes the portrait`, () => {
      const recipe = validateRecipe({ ...base, ...patch });
      const buf = renderPortrait(recipe);
      expect(opaqueCount(buf)).toBeGreaterThan(100);
      expect(Buffer.from(buf).equals(Buffer.from(renderPortrait(base)))).toBe(false);
      const { front, back } = renderSceneFrames(recipe);
      for (const f of [...front, ...back]) expect(opaqueCount(f)).toBeGreaterThan(100);
    });
  }

  it('every headwear composes with every hair style (front + back) without throwing', () => {
    for (const hair of HAIR_STYLES) for (const headwear of HEADWEAR) {
      const recipe = validateRecipe({ ...base, hair, headwear, headwearColor: [90, 70, 120] });
      expect(opaqueCount(renderPortrait(recipe))).toBeGreaterThan(100);
      const { front, back } = renderSceneFrames(recipe);
      for (const f of [...front, ...back]) expect(opaqueCount(f)).toBeGreaterThan(100);
    }
  });

  it('avatarStateFrames works with headwear+glasses and keeps the glasses no-blink rule', () => {
    const withGlasses = validateRecipe({ ...base, glasses: true, headwear: 'beanie', earrings: 'hoop', hairTip: [220, 120, 200] });
    const f = avatarStateFrames(withGlasses);
    // glasses → the blink frame IS the open frame (no blink painted through lenses)
    expect(Buffer.from(f.idle[0]).equals(Buffer.from(f.idle[1]))).toBe(true);
    expect(Buffer.from(f.talking[0]).equals(Buffer.from(f.talking[1]))).toBe(false);
    const noGlasses = validateRecipe({ ...base, glasses: undefined, headwear: 'cap' });
    const g = avatarStateFrames(noGlasses);
    expect(Buffer.from(g.idle[0]).equals(Buffer.from(g.idle[1]))).toBe(false);
  });

  it('undefined detail fields render identically to fields simply absent', () => {
    const explicit = { ...base, eyes: undefined, earrings: undefined, freckles: undefined, hairTip: undefined, clothAccent: undefined, headwear: undefined };
    expect(Buffer.from(renderPortrait(explicit as AvatarRecipe)).equals(Buffer.from(renderPortrait(base)))).toBe(true);
  });
});
