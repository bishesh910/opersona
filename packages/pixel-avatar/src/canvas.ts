// Browser helper. Safe to import in Node: no DOM globals are touched at module
// load — `document` is only dereferenced inside paintToCanvas().

/**
 * Paint an RGBA pixel buffer onto `ctx` at an integer-ish `scale`, nearest
 * neighbour. Stages the 1× pixels on an offscreen canvas via ImageData, then
 * blits with `imageSmoothingEnabled = false` so nothing is ever interpolated
 * (the SpritePortrait approach). Pair with CSS `image-rendering: pixelated`
 * and a canvas whose backing-store size equals its CSS size.
 */
export function paintToCanvas(ctx: CanvasRenderingContext2D, buf: Uint8ClampedArray, w: number, h: number, scale = 2): void {
  const stage = document.createElement('canvas');
  stage.width = w; stage.height = h;
  const sctx = stage.getContext('2d');
  if (!sctx) throw new Error('2d context unavailable for staging canvas');
  const img = sctx.createImageData(w, h);
  img.data.set(buf);
  sctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, w * scale, h * scale);
  ctx.drawImage(stage, 0, 0, w, h, 0, 0, w * scale, h * scale);
}
