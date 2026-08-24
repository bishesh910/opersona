// Visual sanity artifact: writes out/michael.png + out/dwight.png (+ sprite sheets).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { portraitPNG, spriteSheetPNG } from '../src/index.js';
import { CAST } from '../test/fixtures/cast.js';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'out');
mkdirSync(out, { recursive: true });
for (const name of ['michael', 'dwight'] as const) {
  writeFileSync(join(out, `${name}.png`), portraitPNG(CAST[name]!, 8));
  writeFileSync(join(out, `${name}-sheet.png`), spriteSheetPNG(CAST[name]!, 4));
  console.log(`wrote ${join(out, name)}.png + ${name}-sheet.png`);
}
