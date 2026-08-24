import { SKIN_TONES, HAIR_STYLES, CLOTHES, BROWS, MOUTHS, FACIAL, type AvatarRecipe, type RGB } from '@opersona/shared';

const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)]!;
const chance = (p: number) => Math.random() < p;

/** Plausible hair colours (plus a couple of fun ones) — pure random RGB tends to look like static. */
const HAIR_COLOURS: RGB[] = [
  [24, 18, 12],    // near-black
  [58, 42, 28],    // dark brown
  [96, 64, 32],    // brown
  [140, 96, 48],   // light brown
  [196, 152, 88],  // dark blond
  [228, 202, 148], // blond
  [168, 90, 44],   // auburn
  [196, 78, 44],   // ginger
  [128, 128, 128], // grey
  [232, 232, 232], // white
  [96, 56, 128],   // violet (why not)
  [48, 104, 152],  // blue (a persona can dream)
];

function hslToRgb(h: number, s: number, l: number): RGB {
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

/** A wearable colour: any hue, moderate saturation and lightness. */
function clothColour(): RGB {
  return hslToRgb(Math.random() * 360, 0.3 + Math.random() * 0.45, 0.3 + Math.random() * 0.4);
}

/** A random but valid AvatarRecipe — every value from the shared enums / ranges. */
export function randomRecipe(): AvatarRecipe {
  const hair = pick(HAIR_STYLES);
  const recipe: AvatarRecipe = {
    skin: pick(SKIN_TONES),
    hair,
    hairc: pick(HAIR_COLOURS),
    cloth: pick(CLOTHES),
    c1: clothColour(),
    brow: pick(BROWS),
    mouth: pick(MOUTHS),
  };
  if (hair !== 'styleBald' && chance(0.7)) recipe.hairargs = { part: pick(['L', 'R'] as const) };
  if (chance(0.4)) recipe.c2 = clothColour();
  if ((recipe.cloth === 'suit' || recipe.cloth === 'dressshirt') && chance(0.5)) recipe.tie = clothColour();
  if (chance(0.25)) recipe.facial = pick(FACIAL);
  if (chance(0.3)) recipe.glasses = true;
  if (chance(0.3)) recipe.lashes = true;
  if (chance(0.2)) recipe.blush = true;
  if (chance(0.15)) recipe.heavy = true;
  return recipe;
}
