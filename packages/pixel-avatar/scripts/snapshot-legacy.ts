// Regenerates test/fixtures/legacy-buffers.json — byte-exact renderPortrait +
// renderSceneFrames output for three representative recipes. These fixtures
// pin the engine's output for recipes that predate the optional detail fields
// (eyes/earrings/freckles/hairTip/clothAccent/headwear): a legacy recipe must
// keep rendering PIXEL-IDENTICAL forever. Do NOT regenerate after an engine
// change unless you intend to break old avatars (you don't).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_RECIPE } from '@opersona/shared';
import { renderPortrait, renderSceneFrames } from '../src/index.js';
import { CAST } from '../test/fixtures/cast.js';

const recipes = {
  default: DEFAULT_RECIPE,
  pam: CAST.pam!,       // styleFrame + lashes + blush + cardigan
  stanley: CAST.stanley!, // styleRecede + glasses + mustache + heavy + tie
} as const;

const out: Record<string, { recipe: unknown; portrait: string; scene: { front: string[]; back: string[] } }> = {};
for (const [name, recipe] of Object.entries(recipes)) {
  const frames = renderSceneFrames(recipe);
  out[name] = {
    recipe,
    portrait: Buffer.from(renderPortrait(recipe)).toString('base64'),
    scene: {
      front: frames.front.map((f) => Buffer.from(f).toString('base64')),
      back: frames.back.map((f) => Buffer.from(f).toString('base64')),
    },
  };
}
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'legacy-buffers.json'), JSON.stringify(out));
console.log('wrote', join(dir, 'legacy-buffers.json'));
