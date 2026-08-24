/**
 * Avatar Recipe — the parameters of the procedural pixel-art engine in
 * @opersona/pixel-avatar. Lives here (not in pixel-avatar) so the engine's vision
 * extractor, the DB column type and the web editor share one zod source of truth
 * without importing the renderer.
 */
import { z } from 'zod';

export const RGB = z.tuple([z.number().int().min(0).max(255), z.number().int().min(0).max(255), z.number().int().min(0).max(255)]);
export type RGB = z.infer<typeof RGB>;

export const SKIN_TONES = ['light', 'tan', 'brown', 'dark'] as const;
export const HAIR_STYLES = ['styleShort', 'styleFloppy', 'styleFrame', 'styleBun', 'styleCurly', 'styleMessy', 'styleRecede', 'styleSpiky', 'styleBald'] as const;
export const CLOTHES = ['suit', 'dressshirt', 'polo', 'blouse', 'cardigan', 'sweater'] as const;
export const BROWS = ['flat', 'angry', 'raised', 'soft'] as const;
export const MOUTHS = ['neutral', 'smile', 'frown', 'grin'] as const;
export const FACIAL = ['mustache', 'mustacheSm', 'stubble', 'goatee'] as const;

export const AvatarRecipe = z.object({
  skin: z.enum(SKIN_TONES),
  hairc: RGB,
  hair: z.enum(HAIR_STYLES),
  hairargs: z.object({
    part: z.enum(['L', 'R']).optional(),
    recede: z.number().int().min(0).max(3).optional(),
    length: z.number().int().min(10).max(22).optional(),
    vol: z.number().int().min(0).max(3).optional(),
  }).optional(),
  cloth: z.enum(CLOTHES),
  c1: RGB,
  c2: RGB.optional(),
  tie: RGB.optional(),
  pants: RGB.optional(),
  brow: z.enum(BROWS).optional(),
  mouth: z.enum(MOUTHS).optional(),
  blush: z.boolean().optional(),
  facial: z.enum(FACIAL).optional(),
  glasses: z.boolean().optional(),
  lashes: z.boolean().optional(),
  heavy: z.boolean().optional(),
});
export type AvatarRecipe = z.infer<typeof AvatarRecipe>;

/** The app's default pixel face (used for logged-out favicons, empty previews,
 *  and as the onboarding starting point before selfie/randomise). */
export const DEFAULT_RECIPE: AvatarRecipe = {
  skin: 'tan', hairc: [26, 22, 22], hair: 'styleMessy',
  cloth: 'sweater', c1: [38, 42, 66], brow: 'flat', mouth: 'neutral', glasses: true,
};
