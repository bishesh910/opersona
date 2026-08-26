'use client';
/**
 * OfficeFloor — the munder-difflin office, reborn for opersona on canvas 2D.
 * Tiled LimeZu map (server-deployed assets, flat-color fallback), BFS paths,
 * seated work at real desks with lit monitors + fake terminals, cafeteria
 * breaks with banter bubbles, plant-watering errands, ambient mail envelopes,
 * and a camera you can actually drag and zoom (the original couldn't).
 * All ambient — nothing reflects anyone's real activity.
 */
import { useEffect, useRef, useState } from 'react';
import type { AvatarRecipe } from '@opersona/shared';
import { walkerFramesV2, WALKER_W, WALKER_H } from '@/lib/pixel-avatar';
import { buildWorld, Camera, THEME, TILE, type Pt, type World, type TiledMap } from './engine';
import { Character, type Dir } from './character';
import { SOLO_LINES, PAIR_EXCHANGES, pick } from './lines';
import mapJson from './office-map.json';

export interface FloorMember {
  id: string;                 // cloneId or user id for persona-less members
  name: string;
  recipe: AvatarRecipe | null;
  boss: boolean;              // org owner → the corner office
}

interface Bubble { text: string; t: number; dur: number; lift: number }

const NEUTRAL = { skin: 'light', hairc: [126, 128, 136], hair: 'styleShort', cloth: 'sweater', c1: [152, 154, 162], pants: [110, 112, 120] } as unknown as AvatarRecipe;

function grey(buf: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(buf);
  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] === 0) continue;
    const l = out[i]! * 0.3 + out[i + 1]! * 0.55 + out[i + 2]! * 0.15;
    out[i] = out[i + 1] = out[i + 2] = 92 + Math.round(l * 0.45);
  }
  return out;
}
function toCanvas(buf: Uint8ClampedArray): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = WALKER_W; c.height = WALKER_H;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(buf), WALKER_W, WALKER_H), 0, 0);
  return c;
}

interface Envelope { from: Pt; to: Pt; t: number; dur: number; color: string; burst: number }
const ENVELOPE_COLORS = ['#9ecbf0', '#cdb4e8', '#f2df8a', '#f5efd8', '#a8e0b0'];

interface Runtime {
  m: FloorMember;
  ch: Character;
  seatIdx: number;
  monitor: { top: Pt } | null;   // lit-screen anchor (2 tiles above the seat)
  bubble: Bubble | null;
  busy: 'none' | 'break' | 'errand';
  termPhase: number;             // fake-terminal scroll phase
}

export function OfficeFloor({ members, selectedId, onSelect }: {
  members: FloorMember[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rtRef = useRef<Runtime[]>([]);
  const camRef = useRef<Camera | null>(null);
  const selRef = useRef<string | null>(selectedId);
  const [hover, setHover] = useState<{ name: string; x: number; y: number } | null>(null);
  const [ready, setReady] = useState(false);
  const [assetsMissing, setAssetsMissing] = useState(false);

  // camera nudge on external selection (roster clicks etc.)
  useEffect(() => {
    selRef.current = selectedId;
    const rt = rtRef.current.find((r) => r.m.id === selectedId);
    if (rt && camRef.current) camRef.current.nudgeToward(rt.ch.x, rt.ch.y);
  }, [selectedId]);

  const membersKeyRef = useRef<{ key: string; value: FloorMember[] }>({ key: '', value: members });
  const mk = JSON.stringify(members.map((m) => [m.id, m.name, m.boss, m.recipe]));
  if (membersKeyRef.current.key !== mk) membersKeyRef.current = { key: mk, value: members };
  const stable = membersKeyRef.current.value;

  useEffect(() => {
    const host = hostRef.current, canvas = canvasRef.current;
    if (!host || !canvas || stable.length === 0) return;
    let dead = false;
    let raf = 0;
    const cleanup: (() => void)[] = [() => cancelAnimationFrame(raf)];

    (async () => {
      const world = await buildWorld(mapJson as unknown as TiledMap);
      if (dead) return;
      setAssetsMissing(!(await fetch('/office-assets/office-tileset.png', { method: 'HEAD' }).then((r) => r.ok).catch(() => false)));

      const cam = new Camera(world.W, world.H);
      camRef.current = cam;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      let lastW = 0, lastH = 0;
      const resize = (): void => {
        const r = host.getBoundingClientRect();
        // guard against sub-pixel ResizeObserver feedback loops
        if (Math.abs(r.width - lastW) < 2 && Math.abs(r.height - lastH) < 2) return;
        lastW = r.width; lastH = r.height;
        canvas.width = Math.max(1, Math.round(r.width * dpr));
        canvas.height = Math.max(1, Math.round(r.height * dpr));
        canvas.style.width = `${r.width}px`; canvas.style.height = `${r.height}px`;
        cam.setView(r.width, r.height);
        if (!cam.manual) cam.fit();
      };
      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(host);
      cleanup.push(() => ro.disconnect());
      cam.fit();

      // ── seats: boss gets desk-ceo; everyone else claims in theme order ──
      const seatTiles: Pt[] = [];
      for (const n of THEME.primarySeatNames) { const s = world.spawns.get(n); if (s) seatTiles.push(s); }
      const boardroom = world.zones.get('boardroom');
      if (boardroom) for (let y = boardroom.y; y < boardroom.y + boardroom.h; y++) for (let x = boardroom.x; x < boardroom.x + boardroom.w; x++) {
        if (world.walk[y]?.[x]) seatTiles.push({ x, y });
      }
      const facingFor = (t: Pt): Dir => {
        for (const [d, dx, dy] of [['up', 0, -1], ['down', 0, 1], ['left', -1, 0], ['right', 1, 0]] as const) {
          const w = world.walk[t.y + dy]?.[t.x + dx];
          if (w === false) return d;
        }
        return 'up';
      };

      const entrance = world.spawns.get('entrance') ?? { x: 17, y: 20 };
      const ordered = [...stable].sort((a, b) => Number(b.boss) - Number(a.boss));
      let nextSeat = 1;
      const runtimes: Runtime[] = ordered.map((m) => {
        const f = m.recipe ? walkerFramesV2(m.recipe) : (() => { const n = walkerFramesV2(NEUTRAL); return { front: n.front.map(grey), back: n.back.map(grey) }; })();
        const seatIdx = m.boss ? 0 : Math.min(nextSeat++, seatTiles.length - 1);
        const seat = seatTiles[seatIdx] ?? entrance;
        const ch = new Character(m.id, [...f.front, ...f.back].map(toCanvas), seat);
        ch.seatTile = seat;
        ch.seatFacing = facingFor(seat);
        ch.sitAt(seat, ch.seatFacing, true);
        // lit monitor if the tile 2 rows above the seat is the off-screen art
        const top = { x: seat.x, y: seat.y - 2 };
        const hasMon = world.gidAt('furniture-above', top.x, top.y) === THEME.monitor.offTopLeftGid
          || world.gidAt('furniture-below', top.x, top.y) === THEME.monitor.offTopLeftGid;
        return { m, ch, seatIdx, monitor: hasMon ? { top } : null, bubble: null, busy: 'none' as const, termPhase: Math.random() * 10 };
      });
      rtRef.current = runtimes;
      setReady(true);

      // ── directors (cafeteria breaks, errands, workers' idle rhythm) ──
      const cafeSeats = THEME.cafeSeatNames.map((n) => world.spawns.get(n)).filter(Boolean) as Pt[];
      const cafeStands = THEME.cafeStands.map(([n, kind]) => ({ t: world.spawns.get(n), kind })).filter((s) => s.t) as { t: Pt; kind: string }[];
      let nextBreakAt = 6 + Math.random() * 6;
      let nextErrandAt = 14 + Math.random() * 10;
      let nextEnvelopeAt = 12 + Math.random() * 14;
      let clock = 0;
      const envelopes: Envelope[] = [];
      const say = (rt: Runtime, text: string, dur = 3): void => { rt.bubble = { text, t: 0, dur, lift: 0 }; };

      const sendOnBreak = (rt: Runtime): void => {
        rt.busy = 'break';
        const toSeat = cafeSeats.length && Math.random() < 0.6;
        const spot = toSeat ? pick(cafeSeats) : (cafeStands.length ? pick(cafeStands).t : pick(cafeSeats));
        const kind = toSeat ? 'table' : (cafeStands.find((s) => s.t === spot)?.kind ?? 'coffee');
        rt.ch.stopIdleLoop();
        if (!rt.ch.walkTo(world, spot, () => {
          if (toSeat) rt.ch.sitAt(spot, facingFor(spot), false);
          say(rt, pick(SOLO_LINES[kind] ?? SOLO_LINES.coffee!));
          // a seated neighbour? trade a two-beat exchange
          const other = runtimes.find((o) => o !== rt && o.busy === 'break' && Math.hypot(o.ch.x - rt.ch.x, o.ch.y - rt.ch.y) < TILE * 3);
          if (other) {
            const ex = pick(PAIR_EXCHANGES);
            say(rt, ex[0]!, 2.6);
            setTimeout(() => { if (!dead) say(other, ex[1]!, 2.6); }, 2600);
            if (ex[2]) setTimeout(() => { if (!dead) say(rt, ex[2]!, 2.6); }, 5200);
          }
          setTimeout(() => { if (!dead) endBreak(rt); }, 9000 + Math.random() * 8000);
        })) endBreak(rt);
      };
      const endBreak = (rt: Runtime): void => {
        rt.ch.standUp();
        if (rt.ch.seatTile && rt.ch.walkTo(world, rt.ch.seatTile, () => {
          rt.ch.sitAt(rt.ch.seatTile!, rt.ch.seatFacing, true);
          rt.busy = 'none';
        })) return;
        rt.busy = 'none';
      };
      const sendOnErrand = (rt: Runtime): void => {
        const spots = THEME.errandSpots.filter((s) => (!s.bossOnly || rt.m.boss));
        const spot = pick(spots);
        rt.busy = 'errand';
        rt.ch.stopIdleLoop();
        if (!rt.ch.walkTo(world, spot.stand, () => {
          rt.ch.dir = spot.facing;
          say(rt, pick(SOLO_LINES[spot.kind] ?? SOLO_LINES.desk!), Math.min(3, spot.duration));
          setTimeout(() => { if (!dead) endBreak(rt); }, spot.duration * 1000);
        })) rt.busy = 'none';
      };

      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

      // ── input: click select, drag pan, wheel zoom, dblclick fit ──
      let drag: { x: number; y: number; moved: boolean } | null = null;
      const touches = new Map<number, { x: number; y: number }>();
      let pinchDist = 0;
      const onDown = (e: PointerEvent): void => {
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.size === 2) { const [a2, b2] = [...touches.values()]; pinchDist = Math.hypot(a2!.x - b2!.x, a2!.y - b2!.y); drag = null; }
        else drag = { x: e.clientX, y: e.clientY, moved: false };
        canvas.setPointerCapture(e.pointerId);
      };
      const onMove = (e: PointerEvent): void => {
        if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.size === 2) { // pinch zoom about the midpoint
          const [a2, b2] = [...touches.values()];
          const d = Math.hypot(a2!.x - b2!.x, a2!.y - b2!.y);
          if (pinchDist > 0) {
            const r0 = canvas.getBoundingClientRect();
            cam.zoomAt((a2!.x + b2!.x) / 2 - r0.left, (a2!.y + b2!.y) / 2 - r0.top, d / pinchDist);
          }
          pinchDist = d;
          setHover(null);
          return;
        }
        if (drag) {
          const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
          if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
          if (drag.moved) { cam.panBy(dx, dy); drag.x = e.clientX; drag.y = e.clientY; setHover(null); }
          return;
        }
        const r = canvas.getBoundingClientRect();
        const w = cam.toWorld(e.clientX - r.left, e.clientY - r.top);
        const hit = hitTest(w);
        canvas.style.cursor = hit ? 'pointer' : 'grab';
        if (hit) setHover({ name: hit.m.name, x: e.clientX - r.left, y: e.clientY - r.top - 14 });
        else setHover(null);
      };
      const onUp = (e: PointerEvent): void => {
        touches.delete(e.pointerId);
        if (touches.size > 0) { drag = null; pinchDist = 0; return; }
        const wasDrag = drag?.moved;
        drag = null;
        if (wasDrag) return;
        const r = canvas.getBoundingClientRect();
        const w = cam.toWorld(e.clientX - r.left, e.clientY - r.top);
        const hit = hitTest(w);
        if (hit) { onSelect(hit.m.id); cam.nudgeToward(hit.ch.x, hit.ch.y); }
        else onSelect(null);
      };
      const onWheel = (e: WheelEvent): void => {
        e.preventDefault();
        const r = canvas.getBoundingClientRect();
        cam.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.pow(1.0015, -e.deltaY));
      };
      const onDbl = (): void => cam.fit();
      const hitTest = (w: Pt): Runtime | null => {
        let best: Runtime | null = null;
        for (const rt of runtimes) {
          const c = rt.ch;
          if (w.x >= c.x - WALKER_W / 2 && w.x <= c.x + WALKER_W / 2 && w.y >= c.y - WALKER_H && w.y <= c.y) {
            if (!best || c.y > best.ch.y) best = rt;
          }
        }
        return best;
      };
      canvas.addEventListener('pointerdown', onDown);
      canvas.addEventListener('pointermove', onMove);
      canvas.addEventListener('pointerup', onUp);
      canvas.addEventListener('wheel', onWheel, { passive: false });
      canvas.addEventListener('dblclick', onDbl);
      cleanup.push(() => {
        canvas.removeEventListener('pointerdown', onDown);
        canvas.removeEventListener('pointermove', onMove);
        canvas.removeEventListener('pointerup', onUp);
        canvas.removeEventListener('wheel', onWheel);
        canvas.removeEventListener('dblclick', onDbl);
      });

      // ── render ──
      const ctx = canvas.getContext('2d')!;
      const draw = (t: number): void => {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = '#191a20';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        cam.apply(ctx, dpr);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(world.base, 0, 0);
        // depth-sorted characters
        [...runtimes].sort((a, b) => a.ch.y - b.ch.y).forEach((rt) => rt.ch.draw(ctx, t, rt.m.id === selRef.current));
        ctx.drawImage(world.above, 0, 0);
        // lit monitors + fake terminals for the seated
        for (const rt of runtimes) {
          if (!rt.monitor || !rt.ch.sitting || !rt.ch.working) continue;
          const { top } = rt.monitor;
          for (const [gid, dx, dy] of THEME.monitor.onGids) world.drawGid(ctx, gid, top.x + dx, top.y + dy);
          const sx = top.x * TILE + 6, sy = top.y * TILE + 10; // SCREEN {3,5,25,12} ×2
          rt.termPhase += 0.05;
          ctx.fillStyle = 'rgba(180,205,235,0.85)';
          for (let li = 0; li < 2; li++) {
            const ly = sy + ((rt.termPhase * 6.4 + li * 12) % 22);
            ctx.fillRect(sx + 2, sy + 22 - ly + 2, 12 + ((li * 7 + Math.floor(rt.termPhase)) % 16), 2);
          }
          if (Math.floor(t / 0.53) % 2 === 0) ctx.fillRect(sx + 2, sy + 18, 4, 4);
        }
        // envelopes
        for (const e of envelopes) {
          const k = e.t / e.dur, ease = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
          const x = e.from.x + (e.to.x - e.from.x) * ease;
          const y = e.from.y + (e.to.y - e.from.y) * ease - Math.sin(k * Math.PI) * 44 + Math.sin(t * 10 + e.from.x) * 2;
          if (k < 1) {
            ctx.fillStyle = e.color;
            ctx.fillRect(Math.round(x) - 7, Math.round(y) - 5, 14, 10);
            ctx.strokeStyle = 'rgba(30,30,40,0.7)'; ctx.lineWidth = 1;
            ctx.strokeRect(Math.round(x) - 7 + 0.5, Math.round(y) - 5 + 0.5, 13, 9);
            ctx.beginPath();
            ctx.moveTo(x - 7, y - 5); ctx.lineTo(x, y + 1); ctx.lineTo(x + 7, y - 5);
            ctx.stroke();
          } else if (e.burst < 0.4) {
            ctx.strokeStyle = `rgba(242,223,138,${1 - e.burst / 0.4})`;
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(e.to.x, e.to.y, 6 + e.burst * 40, 0, Math.PI * 2); ctx.stroke();
          }
        }
        // ── bubbles: screen-space pass (crisp text at any zoom) ──
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const placed: { x: number; y: number; w: number; h: number; rt: Runtime }[] = [];
        for (const rt of runtimes) {
          const b = rt.bubble;
          if (!b) continue;
          const sx = (rt.ch.x - cam.x) * cam.zoom + cam.viewW / 2;
          const sy = (rt.ch.y - WALKER_H - cam.y) * cam.zoom + cam.viewH / 2 - 16;
          ctx.font = 'bold 11px ui-monospace, monospace';
          const tw = Math.min(150, ctx.measureText(b.text).width + 14);
          placed.push({ x: sx - tw / 2, y: sy - 24, w: tw, h: 22, rt });
        }
        // overlap resolver: sort by bottom edge, push upward
        placed.sort((a, b) => a.y + a.h - (b.y + b.h) || a.x - b.x);
        for (let i = 0; i < placed.length; i++) for (let j = 0; j < i; j++) {
          const a = placed[i]!, b = placed[j]!;
          if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) a.y = b.y - a.h - 2;
        }
        for (const p of placed) {
          const b = p.rt.bubble!;
          const alpha = b.t < 0.15 ? b.t / 0.15 : b.t > b.dur - 0.3 ? Math.max(0, (b.dur - b.t) / 0.3) : 1;
          ctx.globalAlpha = alpha;
          ctx.fillStyle = '#f7f3e6';
          ctx.strokeStyle = '#2c2c34'; ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.roundRect(Math.round(p.x) + 0.5, Math.round(p.y) + 0.5, p.w, p.h, 5);
          ctx.fill(); ctx.stroke();
          // tail puffs
          for (const [pd, pr] of [[8, 3], [14, 2]] as const) {
            ctx.beginPath(); ctx.arc(p.x + p.w / 2 - 6 + pd / 3, p.y + p.h + pd / 2, pr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          }
          ctx.fillStyle = '#2c2c34';
          ctx.font = 'bold 11px ui-monospace, monospace';
          ctx.textBaseline = 'middle';
          ctx.fillText(b.text, Math.round(p.x) + 7, Math.round(p.y) + p.h / 2 + 1, p.w - 14);
          ctx.globalAlpha = 1;
        }
      };

      if (reduced) { cam.update(0.016); draw(0); return; }

      let last = performance.now();
      const tick = (now: number): void => {
        const dt = Math.min(0.05, (now - last) / 1000); last = now;
        clock += dt;
        for (const rt of runtimes) {
          rt.ch.update(dt, world);
          if (rt.bubble) { rt.bubble.t += dt; if (rt.bubble.t > rt.bubble.dur) rt.bubble = null; }
        }
        // cafeteria director: every 6–12s maybe send someone on a break (max 4 out)
        if (clock > nextBreakAt) {
          nextBreakAt = clock + 6 + Math.random() * 6;
          const out = runtimes.filter((r) => r.busy !== 'none').length;
          if (out < 4 && Math.random() < 0.5) {
            const cand = runtimes.filter((r) => r.busy === 'none' && !r.m.boss);
            if (cand.length) sendOnBreak(pick(cand));
          }
        }
        if (clock > nextErrandAt) {
          nextErrandAt = clock + 16 + Math.random() * 14;
          const cand = runtimes.filter((r) => r.busy === 'none');
          if (cand.length && Math.random() < 0.6) sendOnErrand(pick(cand));
        }
        // ambient mail between two desks
        if (clock > nextEnvelopeAt) {
          nextEnvelopeAt = clock + 14 + Math.random() * 20;
          if (runtimes.length >= 2) {
            const a = pick(runtimes), b = pick(runtimes.filter((r) => r !== a));
            envelopes.push({ from: { x: a.ch.x, y: a.ch.y - WALKER_H / 2 }, to: { x: b.ch.x, y: b.ch.y - WALKER_H / 2 }, t: 0, dur: 1.6, color: pick(ENVELOPE_COLORS), burst: 0 });
          }
        }
        for (let i = envelopes.length - 1; i >= 0; i--) {
          const e = envelopes[i]!;
          if (e.t < e.dur) e.t += dt;
          else { e.burst += dt; if (e.burst > 0.45) envelopes.splice(i, 1); }
        }
        // seated workers occasionally think out loud
        for (const rt of runtimes) {
          if (rt.busy === 'none' && rt.ch.sitting && rt.ch.working && !rt.bubble && Math.random() < dt / 45) {
            say(rt, pick(SOLO_LINES.desk!), 2.4);
          }
        }
        cam.update(dt);
        draw(clock);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    })();

    return () => { dead = true; cleanup.forEach((fn) => fn()); };
  }, [stable, onSelect]);

  return (
    <div ref={hostRef} className="relative h-full w-full overflow-hidden rounded-xl border border-neutral-200 bg-[#191a20] dark:border-neutral-800">
      <canvas ref={canvasRef} className="block h-full w-full touch-none [image-rendering:pixelated]"
        role="img" aria-label={`Office floor — ${members.length} colleagues in a pixel office`} />
      {hover && (
        <div className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md bg-neutral-900/90 px-2 py-0.5 font-mono text-[11px] text-neutral-100"
          style={{ left: hover.x, top: hover.y }}>
          {hover.name}
        </div>
      )}
      {!ready && <div className="absolute inset-0 grid place-items-center font-mono text-xs text-neutral-500">setting up the office…</div>}
      {assetsMissing && (
        <div className="absolute bottom-2 left-2 rounded-md bg-neutral-900/85 px-2.5 py-1.5 font-mono text-[10px] text-neutral-300">
          tileset art not deployed — flat-color stand-in (see docs/self-hosting.md)
        </div>
      )}
      <div className="pointer-events-none absolute right-2 top-2 rounded-md bg-neutral-900/70 px-2 py-1 font-mono text-[10px] text-neutral-400">
        drag to pan · scroll to zoom · double-click to fit
      </div>
    </div>
  );
}
