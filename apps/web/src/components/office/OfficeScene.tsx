'use client';
/**
 * Office — the org floor at /office. A fully procedural pixel office (no
 * licensed tilesets): wood floor, windows showing the same time-of-day sky as
 * the sign-in page, desks with monitors, plants, a coffee corner. Every
 * colleague's Pixie walks the floor as a v2 flat-style full-body sprite —
 * ambient wandering only, deliberately NOT tied to real activity (nothing here
 * watches anyone). Members without a persona appear as neutral grey
 * silhouettes — we never invent someone's appearance from a hash.
 * Hover a Pixie for their name; click for their card.
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { AvatarRecipe } from '@opersona/shared';
import { walkerFramesV2, WALKER_W, WALKER_H } from '@/lib/pixel-avatar';
import { askPersonaAction } from '@/actions/conversations';
import { AvatarThumb } from '@/components/avatar/AvatarThumb';

export interface OfficeMember {
  cloneId: string | null; // null → member without a persona yet (walks as a grey silhouette)
  name: string;
  owner: string;
  recipe: AvatarRecipe | null;
  mine: boolean;
}

type Daypart = 'morning' | 'day' | 'night';
function daypart(): Daypart { const h = new Date().getHours(); return h >= 5 && h < 11 ? 'morning' : h >= 11 && h < 18 ? 'day' : 'night'; }

/* ── world geometry ───────────────────────────────────────────────────────── */
const WALL_H = 48;
const CW = 118, CH = 118; // desk cell
const SPEED = 34; // world px / s

interface Layout {
  W: number; H: number; cols: number; rows: number;
  desks: { x: number; y: number }[];
  spots: { x: number; y: number }[];
  coffee: { x: number; y: number }; cooler: { x: number; y: number };
  plants: { x: number; y: number }[]; rug: { x: number; y: number; w: number; h: number };
  corridorY: number; // sprite-top y whose feet land in the open bottom corridor
}
function layout(n: number): Layout {
  const cols = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(n))));
  const rows = Math.max(1, Math.ceil(n / cols));
  const W = Math.max(500, cols * CW + 96);
  const H = WALL_H + rows * CH + 110;
  const ox = Math.floor((W - cols * CW) / 2);
  const desks: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols);
    const inRow = row === rows - 1 ? n - row * cols : cols;
    const rowOx = ox + Math.floor(((cols - inRow) * CW) / 2); // centre a short last row
    desks.push({ x: rowOx + (i % cols) * CW + 12, y: WALL_H + 26 + row * CH });
  }
  const coffee = { x: W - 84, y: WALL_H + 14 };
  const cooler = { x: 14, y: WALL_H + 16 };
  const plants = [{ x: 16, y: H - 46 }, { x: W - 34, y: H - 46 }, { x: W - 34, y: WALL_H + 90 }];
  const rug = { x: Math.floor(W / 2) - 70, y: H - 78, w: 140, h: 48 };
  const corridorY = H - 36 - WALKER_H; // feet land just above the bottom edge
  const spots = [
    { x: coffee.x + 6, y: coffee.y + 46 }, { x: cooler.x + 8, y: cooler.y + 40 },
    { x: rug.x + 30, y: rug.y - 40 }, { x: rug.x + rug.w - 60, y: rug.y - 44 },
    { x: plants[0]!.x + 22, y: plants[0]!.y - 66 }, { x: plants[1]!.x - 44, y: plants[1]!.y - 66 },
  ];
  return { W, H, cols, rows, desks, spots, coffee, cooler, plants, rug, corridorY };
}

/* ── actors ───────────────────────────────────────────────────────────────── */
interface Actor {
  m: OfficeMember;
  frames: HTMLCanvasElement[]; // [front 0,1,2, back 0,1,2]
  x: number; y: number;
  desk: { x: number; y: number };
  path: { x: number; y: number }[];
  state: 'desk' | 'walk' | 'idle';
  nextAt: number;
  dir: 'up' | 'down' | 'left' | 'right';
  flip: boolean;
  stepT: number; frame: number;
  bubbleUntil: number;
}

/** Neutral silhouette for members without a persona — grey on purpose:
 *  we never invent a colleague's appearance (skin, hair) from a hash. */
const NEUTRAL_RECIPE = {
  skin: 'light', hairc: [126, 128, 136], hair: 'styleShort', cloth: 'sweater',
  c1: [152, 154, 162], pants: [110, 112, 120],
} as unknown as AvatarRecipe;

function greyscale(buf: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(buf);
  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] === 0) continue;
    const l = Math.round(out[i]! * 0.3 + out[i + 1]! * 0.55 + out[i + 2]! * 0.15);
    out[i] = out[i + 1] = out[i + 2] = 92 + Math.round(l * 0.45);
  }
  return out;
}

function frameCanvas(buf: Uint8ClampedArray): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = WALKER_W; c.height = WALKER_H;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(buf), WALKER_W, WALKER_H), 0, 0);
  return c;
}

/* ── scene painting (static room; desks/plants join the depth-sorted pass) ── */
function paintRoom(ctx: CanvasRenderingContext2D, L: Layout, part: Daypart): void {
  const { W, H } = L;
  ctx.fillStyle = part === 'night' ? '#3a3d4d' : '#cfc8ba'; ctx.fillRect(0, 0, W, WALL_H);
  ctx.fillStyle = part === 'night' ? '#2f3140' : '#b8b0a0'; ctx.fillRect(0, WALL_H - 6, W, 6);
  const f0 = part === 'night' ? '#7c6853' : '#c8ab82', f1 = part === 'night' ? '#74604b' : '#bfa176';
  ctx.fillStyle = f0; ctx.fillRect(0, WALL_H, W, H - WALL_H);
  ctx.fillStyle = f1;
  for (let y = WALL_H; y < H; y += 12) for (let x = (y / 12 % 2) * 24; x < W; x += 48) ctx.fillRect(x, y, 24, 12);
  ctx.fillStyle = part === 'night' ? '#695741' : '#af9268';
  for (let y = WALL_H; y < H; y += 12) ctx.fillRect(0, y, W, 1);
  // rug
  ctx.fillStyle = part === 'night' ? '#8d6f4e' : '#d9b98a';
  ctx.fillRect(L.rug.x, L.rug.y, L.rug.w, L.rug.h);
  ctx.fillStyle = part === 'night' ? '#7e6244' : '#cf9e5f';
  ctx.fillRect(L.rug.x + 4, L.rug.y + 4, L.rug.w - 8, L.rug.h - 8);
  ctx.fillStyle = part === 'night' ? '#8d6f4e' : '#d9b98a';
  for (let dx = 12; dx < L.rug.w - 12; dx += 16) { ctx.fillRect(L.rug.x + dx, L.rug.y + 12, 4, 4); ctx.fillRect(L.rug.x + dx + 8, L.rug.y + L.rug.h - 16, 4, 4); }
  // windows (leave the right wall segment for the clock + whiteboard)
  for (let wx = 26; wx + 44 < W - 170; wx += 112) paintWindow(ctx, wx, 8, part);
  const bx = W - 118;
  ctx.fillStyle = '#e8e6df'; ctx.fillRect(bx, 12, 44, 24);
  ctx.fillStyle = '#c9c5ba'; ctx.fillRect(bx, 34, 44, 2);
  ctx.fillStyle = '#d2694f'; ctx.fillRect(bx + 5, 18, 16, 2);
  ctx.fillStyle = '#5f7fb8'; ctx.fillRect(bx + 5, 23, 24, 2);
  ctx.fillStyle = '#7d9b6d'; ctx.fillRect(bx + 5, 28, 12, 2);
  ctx.fillStyle = '#efece4'; ctx.fillRect(W - 150, 16, 10, 10);
  ctx.fillStyle = '#3a3a40'; ctx.fillRect(W - 146, 19, 2, 4); ctx.fillRect(W - 146, 21, 4, 2);
  // water cooler
  const c = L.cooler;
  ctx.fillStyle = '#9fc4de'; ctx.fillRect(c.x + 2, c.y, 12, 14);
  ctx.fillStyle = '#c2ddef'; ctx.fillRect(c.x + 4, c.y + 2, 5, 8);
  ctx.fillStyle = '#7b8794'; ctx.fillRect(c.x, c.y + 14, 16, 18);
  ctx.fillStyle = '#616c78'; ctx.fillRect(c.x, c.y + 30, 16, 3);
  // coffee counter
  const k = L.coffee;
  ctx.fillStyle = '#8a6f52'; ctx.fillRect(k.x, k.y + 14, 52, 26);
  ctx.fillStyle = '#a08059'; ctx.fillRect(k.x, k.y + 14, 52, 5);
  ctx.fillStyle = '#3c3c44'; ctx.fillRect(k.x + 6, k.y - 4, 16, 20);
  ctx.fillStyle = '#55555f'; ctx.fillRect(k.x + 8, k.y - 2, 12, 6);
  ctx.fillStyle = '#e8b23c'; ctx.fillRect(k.x + 9, k.y + 8, 3, 3);
  ctx.fillStyle = '#e4e0d6'; ctx.fillRect(k.x + 30, k.y + 6, 6, 6);
  ctx.fillStyle = '#d2694f'; ctx.fillRect(k.x + 38, k.y + 8, 6, 6);
}

function paintWindow(ctx: CanvasRenderingContext2D, x: number, y: number, part: Daypart): void {
  const w = 44, h = 30;
  ctx.fillStyle = '#8d8572'; ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  if (part === 'night') {
    ctx.fillStyle = '#0d1020'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#c9cede';
    for (const [sx, sy] of [[6, 4], [16, 7], [30, 3], [38, 9], [11, 12], [25, 11]]) ctx.fillRect(x + sx!, y + sy!, 1, 1);
    ctx.fillStyle = '#181c30';
    for (const [cx2, cw, chh] of [[3, 8, 12], [13, 7, 16], [22, 9, 10], [33, 8, 14]]) ctx.fillRect(x + cx2!, y + h - chh!, cw!, chh!);
    ctx.fillStyle = '#e8b23c';
    for (const [lx, ly] of [[5, 22], [16, 18], [25, 24], [36, 20], [15, 22]]) ctx.fillRect(x + lx!, y + ly!, 1, 1);
  } else if (part === 'morning') {
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#5b5474'); g.addColorStop(0.55, '#b97a6a'); g.addColorStop(1, '#e8b475');
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#2c2a3e';
    for (const [cx2, cw, chh] of [[4, 8, 10], [15, 7, 14], [25, 9, 9], [35, 7, 12]]) ctx.fillRect(x + cx2!, y + h - chh!, cw!, chh!);
  } else {
    ctx.fillStyle = '#9cc3e8'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#f2f4f6'; ctx.fillRect(x + 8, y + 6, 9, 3); ctx.fillRect(x + 27, y + 11, 7, 3);
    ctx.fillStyle = '#7f96ab';
    for (const [cx2, cw, chh] of [[4, 8, 9], [15, 7, 12], [25, 9, 8], [35, 7, 11]]) ctx.fillRect(x + cx2!, y + h - chh!, cw!, chh!);
  }
}

function paintDesk(ctx: CanvasRenderingContext2D, x: number, y: number, part: Daypart): void {
  const top = part === 'night' ? '#a9895f' : '#d9bb8d', edge = part === 'night' ? '#8a6f4c' : '#bd9c6c';
  ctx.fillStyle = edge; ctx.fillRect(x + 2, y + 18, 90, 22);
  ctx.fillStyle = top; ctx.fillRect(x + 2, y + 18, 90, 18);
  ctx.fillStyle = '#6e5940';
  ctx.fillRect(x + 6, y + 40, 4, 10); ctx.fillRect(x + 84, y + 40, 4, 10);
  ctx.fillStyle = '#33343c'; ctx.fillRect(x + 34, y + 2, 24, 16);
  ctx.fillStyle = '#44454f'; ctx.fillRect(x + 36, y + 4, 20, 12);
  ctx.fillStyle = '#33343c'; ctx.fillRect(x + 44, y + 18, 4, 3);
  if (part === 'night') { ctx.fillStyle = '#aebedd'; ctx.fillRect(x + 34, y + 2, 24, 1); }
  ctx.fillStyle = '#d2694f'; ctx.fillRect(x + 70, y + 22, 5, 5);
  ctx.fillStyle = '#eceade'; ctx.fillRect(x + 12, y + 24, 12, 8);
  ctx.fillStyle = '#c9c5b6'; ctx.fillRect(x + 14, y + 26, 8, 1); ctx.fillRect(x + 14, y + 29, 8, 1);
}

function paintPlant(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = '#597a4e'; ctx.fillRect(x + 2, y - 14, 14, 10);
  ctx.fillStyle = '#6d9160'; ctx.fillRect(x + 4, y - 18, 10, 8); ctx.fillRect(x, y - 10, 6, 6); ctx.fillRect(x + 12, y - 11, 6, 6);
  ctx.fillStyle = '#b0684a'; ctx.fillRect(x + 3, y - 4, 12, 8);
  ctx.fillStyle = '#8f5238'; ctx.fillRect(x + 3, y + 2, 12, 2);
}

/* ── the component ────────────────────────────────────────────────────────── */
export function OfficeScene({ members }: { members: OfficeMember[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<OfficeMember | null>(null);
  const [hover, setHover] = useState<{ name: string; x: number; y: number } | null>(null);
  const actorsRef = useRef<Actor[]>([]);
  const scaleRef = useRef(2);

  // stabilise the members identity: server refreshes hand us a NEW array with
  // identical content on every unrelated revalidate — don't reset the scene for that
  const memberCacheRef = useRef<{ key: string; value: OfficeMember[] }>({ key: '', value: members });
  const membersKey = JSON.stringify(members);
  if (memberCacheRef.current.key !== membersKey) memberCacheRef.current = { key: membersKey, value: members };
  const stableMembers = memberCacheRef.current.value;

  // Escape closes the member card
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setSelected(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || stableMembers.length === 0) return;
    const L = layout(stableMembers.length);
    const part = daypart();
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

    const cw = wrapRef.current?.clientWidth ?? L.W * 2;
    const S = Math.max(2, Math.min(3, Math.floor(cw / L.W)));
    scaleRef.current = S;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = L.W * S * dpr; canvas.height = L.H * S * dpr;
    canvas.style.width = `${L.W * S}px`; canvas.style.height = `${L.H * S}px`;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    // phones pan the wide scene: start centred on the desks, not the left wall
    const scroller = scrollerRef.current;
    if (scroller && scroller.scrollWidth > scroller.clientWidth) scroller.scrollLeft = Math.max(0, (L.W * S - scroller.clientWidth) / 2);

    // static room pre-rendered once — the per-frame pass just blits it
    const room = document.createElement('canvas');
    room.width = L.W; room.height = L.H;
    paintRoom(room.getContext('2d')!, L, part);

    const now0 = performance.now();
    const actors: Actor[] = stableMembers.map((m, i) => {
      const f = m.recipe ? walkerFramesV2(m.recipe) : (() => {
        const n = walkerFramesV2(NEUTRAL_RECIPE);
        return { front: n.front.map(greyscale), back: n.back.map(greyscale) };
      })();
      const desk = L.desks[i]!;
      const home = { x: desk.x + 29, y: desk.y + 24 };
      return {
        m, frames: [...f.front, ...f.back].map(frameCanvas),
        x: home.x, y: home.y, desk: home, path: [], state: 'desk' as const,
        nextAt: now0 + 1500 + Math.random() * 9000,
        dir: 'up' as const, flip: false, stepT: 0, frame: 0, bubbleUntil: 0,
      };
    });
    actorsRef.current = actors;

    /** Route via the bottom corridor so walks pass IN FRONT of desks, never through them. */
    const route = (a: Actor, tx: number, ty: number): void => {
      const cy = L.corridorY;
      if (Math.abs(tx - a.x) < 10) a.path = [{ x: a.x, y: ty }];
      else if (Math.abs(a.y - cy) < 8 && Math.abs(ty - cy) < 8) a.path = [{ x: tx, y: ty }];
      else a.path = [{ x: a.x, y: cy }, { x: tx, y: cy }, { x: tx, y: ty }];
      a.state = 'walk';
    };
    /** A wander target with personal space: nudge until it's not on top of a colleague. */
    const pickSpot = (self: Actor): { x: number; y: number } => {
      for (let tries = 0; tries < 4; tries++) {
        const s = L.spots[Math.floor(Math.random() * L.spots.length)]!;
        const cand = { x: s.x + Math.floor(Math.random() * 24 - 12), y: s.y + Math.floor(Math.random() * 10 - 5) };
        const crowded = actors.some((o) => o !== self && Math.hypot((o.path[o.path.length - 1]?.x ?? o.x) - cand.x, (o.path[o.path.length - 1]?.y ?? o.y) - cand.y) < 18);
        if (!crowded) return cand;
      }
      return { x: L.rug.x + Math.floor(Math.random() * L.rug.w), y: L.corridorY };
    };

    const draw = (t: number): void => {
      ctx.setTransform(S * dpr, 0, 0, S * dpr, 0, 0);
      ctx.drawImage(room, 0, 0);
      const items: { y: number; run: () => void }[] = [];
      L.desks.forEach((d) => items.push({ y: d.y + 50, run: () => paintDesk(ctx, d.x, d.y, part) }));
      L.plants.forEach((p) => items.push({ y: p.y + 4, run: () => paintPlant(ctx, p.x, p.y) }));
      for (const a of actors) {
        items.push({ y: a.y + WALKER_H, run: () => {
          const fi = (a.dir === 'up' ? 3 : 0) + a.frame;
          const img = a.frames[fi]!;
          ctx.save();
          if (a.flip) { ctx.translate(Math.round(a.x) + WALKER_W, Math.round(a.y)); ctx.scale(-1, 1); ctx.drawImage(img, 0, 0); }
          else ctx.drawImage(img, Math.round(a.x), Math.round(a.y));
          ctx.restore();
          if (t < a.bubbleUntil) {
            const bx = Math.round(a.x) + 10, by = Math.round(a.y) - 12;
            ctx.fillStyle = '#f5f3ec'; ctx.fillRect(bx, by, 16, 9); ctx.fillRect(bx + 6, by + 9, 3, 2);
            ctx.fillStyle = '#6a6a72';
            ctx.fillRect(bx + 3, by + 4, 2, 2); ctx.fillRect(bx + 7, by + 4, 2, 2); ctx.fillRect(bx + 11, by + 4, 2, 2);
          }
        } });
      }
      items.sort((p, q) => p.y - q.y).forEach((it) => it.run());
    };

    if (reduced) {
      // static floor: face everyone toward the viewer so it reads as a team photo
      actors.forEach((a) => { a.dir = 'down'; });
      draw(0);
      return;
    }

    // draw only while something is actually moving or a bubble is up; skip offscreen
    let visible = true;
    const io = new IntersectionObserver((entries) => { visible = entries[0]?.isIntersecting ?? true; });
    io.observe(canvas);

    let raf = 0; let last = performance.now(); let wasBusy = true;
    const tick = (t: number): void => {
      const dt = Math.min(0.05, (t - last) / 1000); last = t;
      for (const a of actors) {
        if (a.state === 'walk') {
          const node = a.path[0];
          if (!node) {
            const atDesk = Math.abs(a.x - a.desk.x) < 2 && Math.abs(a.y - a.desk.y) < 2;
            a.state = atDesk ? 'desk' : 'idle';
            a.dir = atDesk ? 'up' : 'down'; a.flip = false; a.frame = 0;
            a.nextAt = t + (atDesk ? 9000 + Math.random() * 16000 : 2500 + Math.random() * 4500);
          } else {
            const dx = node.x - a.x, dy = node.y - a.y;
            const dist = Math.hypot(dx, dy);
            const step = SPEED * dt;
            if (dist <= step) { a.x = node.x; a.y = node.y; a.path.shift(); }
            else { a.x += (dx / dist) * step; a.y += (dy / dist) * step; }
            if (Math.abs(dx) > Math.abs(dy)) { a.dir = dx < 0 ? 'left' : 'right'; a.flip = dx < 0; }
            else { a.dir = dy < 0 ? 'up' : 'down'; a.flip = false; }
            a.stepT += dt;
            if (a.stepT > 0.16) { a.stepT = 0; a.frame = a.frame === 1 ? 2 : 1; }
          }
        } else if (t >= a.nextAt) {
          if (a.state === 'idle') route(a, a.desk.x, a.desk.y);
          else { const s = pickSpot(a); route(a, s.x, s.y); }
        }
      }
      // idle neighbours strike up a "…" chat (rate is per-second, not per-frame)
      for (let i = 0; i < actors.length; i++) for (let j = i + 1; j < actors.length; j++) {
        const p = actors[i]!, q = actors[j]!;
        if (p.state !== 'walk' && q.state !== 'walk' && t > p.bubbleUntil + 6000 && t > q.bubbleUntil + 6000
          && Math.hypot(p.x - q.x, p.y - q.y) < 52 && Math.random() < 0.24 * dt) {
          p.bubbleUntil = q.bubbleUntil = t + 2800;
          p.flip = q.x < p.x; q.flip = p.x < q.x;
          if (p.state === 'idle') p.dir = 'down';
          if (q.state === 'idle') q.dir = 'down';
        }
      }
      const busy = actors.some((a) => a.state === 'walk' || t < a.bubbleUntil);
      if (visible && (busy || wasBusy)) draw(t); // one extra frame settles the final pose
      wasBusy = busy;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); io.disconnect(); };
  }, [stableMembers]);

  const actorAt = (e: React.MouseEvent): Actor | null => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const wx = (e.clientX - rect.left) / scaleRef.current;
    const wy = (e.clientY - rect.top) / scaleRef.current;
    let best: Actor | null = null;
    for (const a of actorsRef.current) {
      if (wx >= a.x + 4 && wx <= a.x + WALKER_W - 4 && wy >= a.y && wy <= a.y + WALKER_H) {
        if (!best || a.y > best.y) best = a; // front-most wins, matching the depth sort
      }
    }
    return best;
  };

  /** Tag position from the canvas rect relative to the wrapper — pan-proof. */
  const tagPos = (a: Actor): { x: number; y: number } => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const wrapRect = wrapRef.current!.getBoundingClientRect();
    return { x: rect.left - wrapRect.left + (a.x + WALKER_W / 2) * scaleRef.current, y: rect.top - wrapRect.top + a.y * scaleRef.current };
  };

  return (
    <div ref={wrapRef} className="relative">
      <div ref={scrollerRef} onScroll={() => setHover(null)} className="mx-auto w-fit max-w-full overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`Office floor — ${members.length} ${members.length === 1 ? 'colleague' : 'colleagues'} wandering a pixel office`}
          className="block [image-rendering:pixelated]"
          onMouseMove={(e) => {
            const a = actorAt(e);
            canvasRef.current!.style.cursor = a ? 'pointer' : 'default';
            if (a) setHover({ name: a.m.name, ...tagPos(a) });
            else setHover(null);
          }}
          onMouseLeave={() => setHover(null)}
          onClick={(e) => { const a = actorAt(e); setSelected(a ? a.m : null); setHover(null); }}
        />
      </div>
      {/* keyboard / screen-reader path to the same cards */}
      <ul className="sr-only" aria-label="Colleagues in the office">
        {members.map((m) => (
          <li key={(m.cloneId ?? '') + m.name}>
            <button type="button" onClick={() => setSelected(m)}>{m.name}</button>
          </li>
        ))}
      </ul>
      {hover && (
        <div className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md bg-neutral-900/90 px-2 py-0.5 font-mono text-[11px] text-neutral-100"
          style={{ left: hover.x, top: hover.y - 2 }}>
          {hover.name}
        </div>
      )}
      {selected && (
        <div className="absolute right-3 top-3 z-20 w-56 rounded-xl border border-neutral-200 bg-white p-3 shadow-lg dark:border-neutral-700 dark:bg-neutral-900" data-office-card>
          <div className="flex items-start gap-3">
            <AvatarThumb recipe={selected.recipe} name={selected.name} scale={2} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{selected.name}</div>
              <div className="muted truncate text-xs">{selected.mine ? 'you' : selected.owner !== selected.name ? selected.owner : 'persona'}</div>
            </div>
            <button type="button" className="muted -mr-1 -mt-1 rounded p-1 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800" onClick={() => setSelected(null)} aria-label="Close">✕</button>
          </div>
          <div className="mt-3 flex gap-2">
            {selected.cloneId ? (
              <>
                <Link className="btn-secondary btn-sm flex-1 text-center" href={`/clones/${selected.cloneId}`}>Persona</Link>
                {selected.mine ? (
                  <Link className="btn-primary btn-sm flex-1 text-center" href="/chat?mode=clone">Test yours</Link>
                ) : (
                  <form action={askPersonaAction} className="flex-1">
                    <input type="hidden" name="cloneId" value={selected.cloneId} />
                    <button type="submit" className="btn-primary btn-sm w-full">Ask</button>
                  </form>
                )}
              </>
            ) : (
              <p className="muted text-xs">No persona yet — they&apos;ve joined but haven&apos;t built their Pixie.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
