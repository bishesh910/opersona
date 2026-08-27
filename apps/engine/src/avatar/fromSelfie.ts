/**
 * Selfie → AvatarRecipe via Claude vision with structured output. The image is
 * held in memory only for the duration of this call and is never written to
 * disk or the database — only the resulting recipe is stored.
 */
import sharp from 'sharp';
import { z } from 'zod';
import { AvatarRecipe, SKIN_TONES, HAIR_STYLES, CLOTHES, BROWS, MOUTHS, FACIAL, EARRINGS, HEADWEAR, GLASSES_STYLES, RGB } from '@opersona/shared';
import { structuredCall } from '../llm.js';

/** Plain 3-element array instead of a tuple: tuples serialise to draft-specific
 *  keywords (`items: [...]` vs `prefixItems`) and the CLI validator and the API
 *  disagree on drafts; `minItems/maxItems` is valid everywhere. */
const RGB3 = z.array(z.number().int().min(0).max(255)).min(3).max(3);

const Extraction = z.object({
  skin: z.enum(SKIN_TONES),
  hair: z.enum(HAIR_STYLES),
  hairc: RGB3.describe('dominant hair colour as [r,g,b]'),
  part: z.enum(['L', 'R', 'none']),
  cloth: z.enum(CLOTHES),
  c1: RGB3.describe('main garment colour as [r,g,b]'),
  brow: z.enum(BROWS),
  mouth: z.enum(MOUTHS),
  facial: z.enum([...FACIAL, 'none']),
  glasses: z.boolean(),
  glassesStyle: z.enum([...GLASSES_STYLES, 'none']).describe("only when glasses are worn: 'classic' for clear prescription frames, 'round' for thin circular frames, 'shades' for opaque dark sunglasses, 'shades3d' ONLY for red/blue 3D glasses; 'none' when no glasses or unsure (defaults to classic)"),
  lashes: z.boolean().describe('bigger, lashed eyes read as more feminine/expressive — only if that fits the person'),
  heavy: z.boolean().describe('heavier build / rounder face'),
  eyes: RGB3.nullable().describe('iris colour as [r,g,b], ONLY when the eyes are clearly a distinct light colour (blue/green/hazel); null for dark/brown or unclear'),
  earrings: z.enum([...EARRINGS, 'none']).describe('only if an earring is clearly visible'),
  earringColor: RGB3.nullable().describe('earring metal colour, null for default gold or when no earrings'),
  freckles: z.boolean().describe('only if freckles are clearly visible on the cheeks'),
  hairTip: RGB3.nullable().describe('second colour of the hair TIPS when the hair is clearly dip-dyed/two-tone; null for single-colour hair'),
  headwear: z.enum([...HEADWEAR, 'none']).describe('beanie or cap only if the person is clearly wearing one'),
  headwearColor: RGB3.nullable().describe('hat colour, null when no headwear'),
  confidence: z.object({ skin: z.number().min(0).max(1), hair: z.number().min(0).max(1), hairc: z.number().min(0).max(1), cloth: z.number().min(0).max(1), facial: z.number().min(0).max(1), glasses: z.number().min(0).max(1) }),
});

const SYSTEM = `You convert one selfie into parameters for a tiny 36x56-pixel cartoon portrait engine. Pick the CLOSEST option from each enum — the engine can only draw those. Rules:
- skin: choose the palette step (light/tan/brown/dark) that best matches the visible skin tone. This is a drawing palette, not an ethnicity guess.
- hair: styleShort (short, parted), styleFloppy (mid-length floppy fringe), styleFrame (hair framing the face to the jaw or longer), styleBun (tied up), styleCurly (curly/voluminous), styleMessy (tousled), styleRecede (receding hairline), styleSpiky (short spiky), styleBald (bald or shaved head), styleMohawk (ONLY a clear mohawk: shaved sides with a central strip), styleBuzz (ONLY a clear buzz cut: clipper-short all over), styleBob (chin-length bob, rounded ends), styleLob (shoulder-length cut — between bob and long), styleLong (long loose hair past the shoulders, centre part — use styleFrame instead when there is a straight fringe/bangs).
- hairc / c1: real RGB values sampled from the photo (hair colour, main clothing colour).
- glasses and facial hair only if clearly visible. facial=none when absent. part=none if hair has no visible part or is bald/bun.
- glassesStyle: only when glasses are clearly worn AND the style is obvious; otherwise 'none' (renders as classic clear frames).
- brow/mouth: the resting expression in the photo (smile if smiling).
- Detail fields (eyes, earrings, freckles, hairTip, headwear) are extras: set them ONLY when the feature is clearly visible in the photo; otherwise none/null/false. headwear: beanie/cap/fedora only for an actual hat of that shape, hoodie only when a hood is UP over the head, headband only for a visible band across the forehead. When in doubt, leave them off — a plain result beats a wrong one.
- Give honest per-field confidence; low confidence is fine — a human edits the result.`;

type Extracted = z.infer<typeof Extraction>;

export async function recipeFromSelfie(args: { orgId: string; apiKey: string; model: string; imageBase64: string; mime: string }): Promise<{ recipe: AvatarRecipe; confidence: Record<string, number> }> {
  // Normalise: strip EXIF, cap at 512px, re-encode as JPEG — the model never sees the original bytes.
  const input = Buffer.from(args.imageBase64, 'base64');
  let jpeg: Buffer;
  try {
    jpeg = await sharp(input).rotate().resize(512, 512, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  } catch {
    throw new Error('Could not read this photo format. Use a JPG or PNG — screenshotting the photo and uploading the screenshot always works.');
  }
  // Rail-aware: API key → Messages API; keyless + bridge → vision job on the user's own subscription.
  const x: Extracted = await structuredCall({
    orgId: args.orgId, cloneId: '00000000-0000-0000-0000-000000000000', kind: 'avatar',
    apiKey: args.apiKey, model: args.model, schema: Extraction,
    system: SYSTEM, user: 'Produce the portrait parameters for this person.',
    image: { base64: jpeg.toString('base64'), mime: 'image/jpeg' },
  });
  const rgb = (a: number[]): RGB => [a[0] ?? 0, a[1] ?? 0, a[2] ?? 0];
  const recipe: AvatarRecipe = {
    skin: x.skin, hair: x.hair, hairc: rgb(x.hairc), cloth: x.cloth, c1: rgb(x.c1), brow: x.brow, mouth: x.mouth,
    ...(x.part !== 'none' ? { hairargs: { part: x.part } } : {}),
    ...(x.facial !== 'none' ? { facial: x.facial } : {}),
    ...(x.glasses ? { glasses: true } : {}),
    ...(x.glasses && x.glassesStyle !== 'none' && x.glassesStyle !== 'classic' ? { glassesStyle: x.glassesStyle } : {}),
    ...(x.lashes ? { lashes: true } : {}), ...(x.heavy ? { heavy: true } : {}),
    ...(x.eyes ? { eyes: rgb(x.eyes) } : {}),
    ...(x.earrings !== 'none' ? { earrings: x.earrings, ...(x.earringColor ? { earringColor: rgb(x.earringColor) } : {}) } : {}),
    ...(x.freckles ? { freckles: true } : {}),
    ...(x.hairTip ? { hairTip: rgb(x.hairTip) } : {}),
    ...(x.headwear !== 'none' ? { headwear: x.headwear, ...(x.headwearColor ? { headwearColor: rgb(x.headwearColor) } : {}) } : {}),
  };
  return { recipe: AvatarRecipe.parse(recipe), confidence: x.confidence };
}
