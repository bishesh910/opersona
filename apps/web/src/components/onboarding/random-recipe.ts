import { SKIN_TONES, HAIR_STYLES, CLOTHES, BROWS, MOUTHS, FACIAL, HEADWEAR, GLASSES_STYLES, type AvatarRecipe, type RGB } from '@opersona/shared';

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

/** Actual-wardrobe colours — what people really wear. A random vivid hue makes
 *  everyone look like a highlighter pack, so those are the rare exception below. */
const WARDROBE: RGB[] = [
  [236, 234, 228], // white
  [225, 216, 198], // cream
  [198, 198, 202], // light grey
  [148, 148, 154], // grey
  [72, 74, 80],    // charcoal
  [44, 44, 48],    // black
  [46, 58, 92],    // navy
  [70, 96, 140],   // denim
  [112, 140, 168], // dusty blue
  [62, 118, 118],  // teal
  [58, 94, 66],    // forest
  [108, 110, 72],  // olive
  [150, 158, 138], // sage
  [110, 46, 56],   // burgundy
  [158, 82, 52],   // rust
  [188, 148, 62],  // mustard
  [108, 82, 62],   // brown
  [178, 150, 112], // tan
  [198, 142, 142], // dusty pink
  [148, 130, 168], // lavender
];

/** A wearable colour: usually from the wardrobe, occasionally something loud. */
function clothColour(): RGB {
  if (chance(0.12)) return hslToRgb(Math.random() * 360, 0.45 + Math.random() * 0.3, 0.4 + Math.random() * 0.25); // the fun one
  return pick(WARDROBE);
}

/** Gradient partner for c1: same garment, softly lit — never a clashing second hue. */
function shadeOf(c: RGB): RGB {
  const t = 0.18 + Math.random() * 0.14;
  const to: RGB = chance(0.5) ? [255, 255, 255] : [0, 0, 0];
  return [Math.round(c[0] + (to[0] - c[0]) * t), Math.round(c[1] + (to[1] - c[1]) * t), Math.round(c[2] + (to[2] - c[2]) * t)];
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
  if (chance(0.5)) recipe.c2 = shadeOf(recipe.c1);
  if ((recipe.cloth === 'suit' || recipe.cloth === 'dressshirt') && chance(0.5)) recipe.tie = clothColour();
  if (chance(0.25)) recipe.facial = pick(FACIAL);
  if (chance(0.3)) {
    recipe.glasses = true;
    const style = pick(GLASSES_STYLES); // 'classic' stays implicit (back-compat shape)
    if (style !== 'classic') recipe.glassesStyle = style;
  }
  if (chance(0.15)) { recipe.headwear = pick(HEADWEAR); recipe.headwearColor = clothColour(); }
  if (chance(0.3)) recipe.lashes = true;
  if (chance(0.2)) recipe.blush = true;
  if (chance(0.15)) recipe.heavy = true;
  return recipe;
}
