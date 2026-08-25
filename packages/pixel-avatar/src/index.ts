import { AvatarRecipe } from '@opersona/shared';
import { PORTRAIT_W, PORTRAIT_H, SCENE_W, SCENE_H, compose, composeScene } from './engine.js';
import { toPNG } from './png.js';

export { PORTRAIT_W, PORTRAIT_H, SCENE_W, SCENE_H } from './engine.js';
export { toPNG } from './png.js';
export { paintToCanvas } from './canvas.js';
export type { AvatarRecipe, RGB } from '@opersona/shared';

export interface SceneFrames { front: Uint8ClampedArray[]; back: Uint8ClampedArray[]; }

/** 18×28 RGBA portrait bust. */
export function renderPortrait(recipe: AvatarRecipe): Uint8ClampedArray {
  return compose(recipe);
}

/** Walk-phase frames (stand, step-L, step-R) for the 18×32 in-scene sprite, front + back. */
export function renderSceneFrames(recipe: AvatarRecipe): SceneFrames {
  return {
    front: [composeScene(recipe, 0, false), composeScene(recipe, 1, false), composeScene(recipe, 2, false)],
    back: [composeScene(recipe, 0, true), composeScene(recipe, 1, true), composeScene(recipe, 2, true)],
  };
}

/** Portrait as an upscaled PNG (Node only). */
export function portraitPNG(recipe: AvatarRecipe, scale = 8): Buffer {
  return toPNG(renderPortrait(recipe), PORTRAIT_W, PORTRAIT_H, scale);
}

/** All scene frames in one row — front frames then back frames — as a PNG (Node only). */
export function spriteSheetPNG(recipe: AvatarRecipe, scale = 4): Buffer {
  const { front, back } = renderSceneFrames(recipe);
  const frames = [...front, ...back];
  const sheetW = SCENE_W * frames.length;
  const sheet = new Uint8ClampedArray(sheetW * SCENE_H * 4);
  frames.forEach((frame, fi) => {
    for (let y = 0; y < SCENE_H; y++) {
      const src = frame.subarray(y * SCENE_W * 4, (y + 1) * SCENE_W * 4);
      sheet.set(src, (y * sheetW + fi * SCENE_W) * 4);
    }
  });
  return toPNG(sheet, sheetW, SCENE_H, scale);
}

/** Parse + validate an untrusted recipe with the shared zod schema (throws ZodError). */
export function validateRecipe(input: unknown): AvatarRecipe {
  return AvatarRecipe.parse(input);
}

/** Square head crop (18×18 from the top of the 18×28 portrait) — for favicons / tiny avatars. */
export function headPNG(recipe: AvatarRecipe, scale = 4): Buffer {
  const src = renderPortrait(recipe);
  const W = PORTRAIT_W, H = 18, top = 1;
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) out.set(src.subarray((y + top) * W * 4, (y + top + 1) * W * 4), y * W * 4);
  return toPNG(out, W, H, scale);
}

/** Two-frame "talking" cycle: the recipe's own mouth alternating with an open mouth.
 *  Swap frames every ~150ms while the persona is speaking. */
export function talkingFrames(recipe: AvatarRecipe): [Uint8ClampedArray, Uint8ClampedArray] {
  const closed = renderPortrait(recipe);
  const open = renderPortrait({ ...recipe, mouth: recipe.mouth === 'grin' ? 'neutral' : 'grin' });
  return [closed, open];
}

/** Eye pixels sit on row 9 at x 5,6 and 10,11 (see engine drawFace). A blink paints
 *  them over with the cheek colour sampled directly beneath each eye. */
function blinkFrame(open: Uint8ClampedArray): Uint8ClampedArray {
  const b = new Uint8ClampedArray(open);
  for (const x of [5, 6, 10, 11]) {
    const src = (12 * PORTRAIT_W + x) * 4, dst = (9 * PORTRAIT_W + x) * 4;
    b[dst] = open[src]!; b[dst + 1] = open[src + 1]!; b[dst + 2] = open[src + 2]!; b[dst + 3] = open[src + 3]!;
  }
  return b;
}

export interface AvatarStateFrames {
  idle: [Uint8ClampedArray, Uint8ClampedArray];      // [open, blink]
  thinking: [Uint8ClampedArray, Uint8ClampedArray];  // [raised brow, raised brow + blink] — slow ponder
  talking: [Uint8ClampedArray, Uint8ClampedArray];   // [mouth closed, mouth open]
}

/** All animation frames for one recipe: idle blinks, thinking raises the brow and
 *  keeps the mouth SHUT, talking moves the mouth. */
export function avatarStateFrames(recipe: AvatarRecipe): AvatarStateFrames {
  const open = renderPortrait(recipe);
  const think = renderPortrait({ ...recipe, brow: 'raised', mouth: 'neutral' });
  // Opaque glasses cover the eyes — painting a blink through the lenses looks broken.
  const blink = (f: Uint8ClampedArray) => (recipe.glasses ? f : blinkFrame(f));
  return { idle: [open, blink(open)], thinking: [think, blink(think)], talking: talkingFrames(recipe) };
}
