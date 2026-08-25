'use client';
import { useEffect, useRef } from 'react';
import type { AvatarRecipe } from '@opersona/shared';
import { avatarStateFrames, paintToCanvas, PORTRAIT_W, PORTRAIT_H } from '@/lib/pixel-avatar';

export type AvatarState = 'idle' | 'thinking' | 'talking';

/** Client-side pixel portrait with state-driven animation:
 *  idle → still, blinks every few seconds; thinking → raised brow, mouth shut, slow ponder-blink;
 *  talking → mouth moves (~150ms). */
export function AvatarCanvas({ recipe, scale = 4, className, title, state = 'idle', talking }: {
  recipe: AvatarRecipe; scale?: number; className?: string; title?: string; state?: AvatarState;
  /** @deprecated use state="talking" */ talking?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const mode: AvatarState = talking ? 'talking' : state;
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    try {
      const frames = avatarStateFrames(recipe);
      const paint = (buf: Uint8ClampedArray) => paintToCanvas(ctx, buf, PORTRAIT_W, PORTRAIT_H, scale);
      if (mode === 'talking') {
        let i = 0;
        paint(frames.talking[0]);
        const t = setInterval(() => { i = 1 - i; paint(frames.talking[i]!); }, 150);
        return () => { clearInterval(t); paint(frames.idle[0]); };
      }
      const [openF, blinkF] = mode === 'thinking' ? frames.thinking : frames.idle;
      paint(openF);
      let blinkTimer: ReturnType<typeof setTimeout> | null = null;
      const loop = setInterval(() => {
        paint(blinkF);
        blinkTimer = setTimeout(() => paint(openF), 130);
      }, mode === 'thinking' ? 1800 : 3800 + Math.random() * 1500);
      return () => { clearInterval(loop); if (blinkTimer) clearTimeout(blinkTimer); paint(frames.idle[0]); };
    } catch (e) { console.error('avatar render failed', e); }
  }, [recipe, scale, mode]);
  // Pixie HD: the buffer is 2× the legacy grid (36×56). The backing store is
  // PORTRAIT_W*scale but the CSS size halves it, so existing `scale` props keep
  // their pre-HD physical size (scale=2 still shows an 36×56-CSS-px thumb) —
  // each fine pixel draws at half the previous CSS size (and 2× on retina).
  return (
    <canvas
      ref={ref}
      width={PORTRAIT_W * scale}
      height={PORTRAIT_H * scale}
      className={className}
      title={title}
      style={{ imageRendering: 'pixelated', width: (PORTRAIT_W * scale) / 2, height: (PORTRAIT_H * scale) / 2 }}
      aria-label={title ?? 'Pixie'}
    />
  );
}
