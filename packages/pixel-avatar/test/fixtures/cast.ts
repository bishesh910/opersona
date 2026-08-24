// The original Office cast recipes from the original office app's portraitArt.ts, kept as
// a test fixture so every style/feature combination the engine was tuned on
// keeps rendering.
import type { AvatarRecipe } from '@opersona/shared';

export const CAST: Record<string, AvatarRecipe> = {
  michael:  { skin: 'light', hairc: [58, 42, 28],   hair: 'styleShort',  hairargs: { part: 'L' }, cloth: 'suit', c1: [58, 63, 74], tie: [170, 58, 58], brow: 'flat', mouth: 'smile' },
  jim:      { skin: 'light', hairc: [92, 60, 34],   hair: 'styleFloppy', cloth: 'dressshirt', c1: [172, 196, 224], tie: [120, 130, 150], brow: 'flat', mouth: 'smile' },
  pam:      { skin: 'light', hairc: [120, 76, 42],  hair: 'styleFrame',  hairargs: { length: 18, vol: 2 }, cloth: 'cardigan', c1: [236, 174, 192], c2: [244, 242, 238], brow: 'soft', mouth: 'smile', blush: true, lashes: true },
  dwight:   { skin: 'light', hairc: [64, 48, 28],   hair: 'styleShort',  hairargs: { part: 'L', recede: 1 }, cloth: 'dressshirt', c1: [184, 155, 62], tie: [120, 82, 46], glasses: true, brow: 'angry', mouth: 'neutral' },
  kevin:    { skin: 'light', hairc: [58, 44, 30],   hair: 'styleBald',   cloth: 'polo', c1: [110, 140, 180], c2: [90, 120, 160], brow: 'flat', mouth: 'neutral', heavy: true },
  angela:   { skin: 'light', hairc: [186, 154, 90], hair: 'styleBun',    cloth: 'cardigan', c1: [150, 146, 170], c2: [235, 233, 226], brow: 'angry', mouth: 'frown', lashes: true },
  oscar:    { skin: 'tan',   hairc: [28, 22, 18],   hair: 'styleShort',  hairargs: { part: 'L' }, cloth: 'sweater', c1: [122, 60, 74], brow: 'flat', mouth: 'smile' },
  stanley:  { skin: 'dark',  hairc: [60, 54, 48],   hair: 'styleRecede', cloth: 'dressshirt', c1: [150, 120, 86], tie: [120, 78, 52], glasses: true, facial: 'mustache', brow: 'flat', mouth: 'neutral', heavy: true },
  phyllis:  { skin: 'light', hairc: [196, 162, 110], hair: 'styleCurly', cloth: 'blouse', c1: [202, 160, 192], glasses: true, brow: 'soft', mouth: 'smile', lashes: true, heavy: true },
  andy:     { skin: 'light', hairc: [74, 51, 32],   hair: 'styleShort',  hairargs: { part: 'R' }, cloth: 'polo', c1: [176, 65, 58], c2: [150, 50, 46], brow: 'raised', mouth: 'smile' },
  kelly:    { skin: 'tan',   hairc: [24, 18, 22],   hair: 'styleFrame',  hairargs: { length: 20, vol: 1 }, cloth: 'blouse', c1: [212, 90, 158], brow: 'soft', mouth: 'smile', blush: true, lashes: true },
  ryan:     { skin: 'light', hairc: [42, 32, 24],   hair: 'styleSpiky',  cloth: 'suit', c1: [58, 58, 68], tie: [40, 40, 50], brow: 'flat', mouth: 'neutral' },
  toby:     { skin: 'light', hairc: [106, 90, 66],  hair: 'styleShort',  hairargs: { part: 'L', recede: 1 }, cloth: 'dressshirt', c1: [150, 150, 120], facial: 'mustacheSm', brow: 'soft', mouth: 'frown' },
  creed:    { skin: 'light', hairc: [170, 166, 156], hair: 'styleBald',   cloth: 'dressshirt', c1: [126, 130, 96], facial: 'stubble', brow: 'flat', mouth: 'neutral' },
  meredith: { skin: 'light', hairc: [154, 82, 46],  hair: 'styleMessy',  hairargs: { length: 15 }, cloth: 'blouse', c1: [176, 86, 74], brow: 'raised', mouth: 'smile', lashes: true },
};
