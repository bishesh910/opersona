'use client';
import { useEffect, useRef } from 'react';
import type { AvatarState } from '@/components/avatar/AvatarCanvas';

/** Anthropic's pixel creature as Claude's Pixie — hand-drawn grid, animated:
 *  idle blinks, thinking half-lids, talking bounces on its little legs. */
const W = 14, H = 9;
const SPRITE = [
  '..##########..',
  '..#E######E#..',
  '..#E######E#..',
  '##############',
  '##############',
  '..##########..',
  '..##########..',
  '...#.#..#.#...',
  '...#.#..#.#...',
];
const BODY: [number, number, number] = [218, 119, 86];
const EYE: [number, number, number] = [26, 22, 20];

function draw(ctx: CanvasRenderingContext2D, px: number, eyes: 'open' | 'half' | 'closed', dy: number) {
  ctx.clearRect(0, 0, W * px, (H + 1) * px);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ch = SPRITE[y]![x];
      if (ch === '.') continue;
      let color = BODY;
      if (ch === 'E') {
        const isTopEyeRow = y === 1;
        if (eyes === 'closed' || (eyes === 'half' && isTopEyeRow)) color = BODY;
        else color = EYE;
      }
      ctx.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
      ctx.fillRect(x * px, (y + dy) * px, px, px);
    }
  }
}

export function ClaudeGlyph({ scale = 2, state = 'idle' }: { scale?: number; state?: AvatarState }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    let t1: ReturnType<typeof setTimeout> | null = null;
    if (state === 'talking') {
      let up = false;
      draw(ctx, scale, 'open', 0);
      const loop = setInterval(() => { up = !up; draw(ctx, scale, 'open', up ? 0 : 1); }, 220);
      return () => clearInterval(loop);
    }
    if (state === 'thinking') {
      let half = false;
      draw(ctx, scale, 'half', 0);
      const loop = setInterval(() => { half = !half; draw(ctx, scale, half ? 'open' : 'half', 0); }, 900);
      return () => clearInterval(loop);
    }
    // idle: open, blink briefly every few seconds
    draw(ctx, scale, 'open', 0);
    const loop = setInterval(() => {
      draw(ctx, scale, 'closed', 0);
      t1 = setTimeout(() => draw(ctx, scale, 'open', 0), 140);
    }, 3800 + Math.random() * 1500);
    return () => { clearInterval(loop); if (t1) clearTimeout(t1); };
  }, [scale, state]);
  return <canvas ref={ref} width={W * scale} height={(H + 1) * scale} style={{ imageRendering: 'pixelated' }} aria-label="Claude" title="Claude" />;
}
