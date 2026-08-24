// PNG output (Node only) via pngjs — pure JS, no native build.
import { PNG } from 'pngjs';

/** Nearest-neighbour upscale an RGBA buffer and encode it as a PNG. */
export function toPNG(buf: Uint8ClampedArray, w: number, h: number, scale = 8): Buffer {
  if (!Number.isInteger(scale) || scale < 1) throw new RangeError(`scale must be a positive integer, got ${scale}`);
  if (buf.length !== w * h * 4) throw new RangeError(`buffer length ${buf.length} != ${w}x${h}x4`);
  const png = new PNG({ width: w * scale, height: h * scale });
  const out = png.data;
  const ow = w * scale;
  for (let y = 0; y < h * scale; y++) {
    const sy = Math.floor(y / scale);
    for (let x = 0; x < ow; x++) {
      const sx = Math.floor(x / scale);
      const si = (sy * w + sx) * 4;
      const di = (y * ow + x) * 4;
      out[di] = buf[si]!; out[di + 1] = buf[si + 1]!; out[di + 2] = buf[si + 2]!; out[di + 3] = buf[si + 3]!;
    }
  }
  return PNG.sync.write(png);
}
