# Pixies: the avatar engine

Every person is represented by a **Pixie** — a procedurally drawn pixel portrait generated from a
single typed recipe. No image assets, no external generator: the whole cast is code.

![Styles](images/pixie-styles.png)

## The recipe

`AvatarRecipe` (zod-validated, stored per user) drives everything: skin tone ×4, 11 hairstyles,
hair colour (+ optional dip-dye tips), 6 garments with two-colour gradients, brows, mouths,
lashes, blush, freckles, facial hair ×4, glasses ×4 (incl. 3-D), earrings, and 5 kinds of
headwear. Recipes come from three places:

1. **A selfie** — Claude vision picks the closest enum values; the photo is processed in memory
   and **never persisted**. Only the recipe is stored.
2. **The dice** — `randomRecipe()` with a real-wardrobe palette (navy, charcoal, olive,
   burgundy, cream… with a deliberate 12% chance of one loud piece) and gradient partners derived
   from the base colour so clothes never clash.
3. **The editor** — every enum as a control, live re-render, reroll button.

## The v2 art style

Flat "cute pixel portrait" style: no outlines, rounded organic shapes, a wide gradient shoulder
dome with a neckline dip and chunky 2-px stair edges, short neck with an under-chin shadow, ears
that stick out, tiny solid eyes (iris colour as a subtle tint), blush, white-teeth grin. Each
garment reads distinctly — suit with a white-shirt V and tie, button-up with placket, cardigan
with an open front:

![Clothes](images/pixie-clothes.png)

The previous outlined engine is kept as the art base for **walking scene sprites** (The Office),
pinned by a bounded-diff regression contract: the HD render must equal the 2× upscale of stored
snapshots except in an explicit allowlist of refinement regions. Deterministic per recipe — no
render-time randomness — so the same person always looks the same everywhere.

## Animation

The UI renders Pixies to `<canvas>` (nearest-neighbour, `image-rendering: pixelated`) with three
states: **idle** (blinks every few seconds), **thinking** (raised brow, slow ponder-blink — used
while the persona works, and by the sign-in card's mascot while you authenticate), and
**talking** (mouth cycles while a reply streams).

## The crowd

Random Pixies also do scenography: the sign-in page's night scene — starfield, crescent moon,
pixel city skyline with lit windows, and a shoulder-to-shoulder crowd — is generated from the
same engine, with separate compositions for desktop and phones.

![Crowd](images/pixie-crowd.png)
