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
import { walkerFramesV2, walkerTalkFramesV2, WALKER_W, WALKER_H } from '@/lib/pixel-avatar';
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
  cafeSeat: Pt | null;           // claimed cafe chair (released on endBreak)
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
      const assetsOk = await fetch('/office-assets/office-tileset.png', { method: 'HEAD' }).then((r) => r.ok).catch(() => false);
      if (dead) return;
      setAssetsMissing(!assetsOk);

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
      const takenTiles = new Set<string>();
      /** overflow beyond the seat list fans out over distinct walkable tiles near the entrance */
      const overflowSpot = (): Pt => {
        for (let r = 0; r < 10; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          const t = { x: entrance.x + dx, y: entrance.y + dy };
          if (t.x < 0 || t.y < 0 || t.x >= world.cols || t.y >= world.rows) continue;
          if (!world.walk[t.y]![t.x] || takenTiles.has(`${t.x},${t.y}`)) continue;
          return t;
        }
        return entrance;
      };
      const runtimes: Runtime[] = ordered.map((m) => {
        const f = m.recipe ? walkerFramesV2(m.recipe) : (() => { const n = walkerFramesV2(NEUTRAL); return { front: n.front.map(grey), back: n.back.map(grey) }; })();
        const tf = m.recipe ? walkerTalkFramesV2(m.recipe) : (walkerTalkFramesV2(NEUTRAL).map(grey) as [Uint8ClampedArray, Uint8ClampedArray]);
        const seatIdx = m.boss ? 0 : nextSeat++;
        const seat = seatTiles[seatIdx] ?? overflowSpot();
        takenTiles.add(`${seat.x},${seat.y}`);
        const ch = new Character(m.id, [...f.front, ...f.back].map(toCanvas), seat);
        ch.talkFrames = [toCanvas(tf[0]), toCanvas(tf[1])];
        ch.seatTile = seat;
        ch.seatFacing = facingFor(seat);
        ch.sitAt(seat, ch.seatFacing, true);
        // lit monitor if the tile 2 rows above the seat is the off-screen art
        const top = { x: seat.x, y: seat.y - 2 };
        const hasMon = world.gidAt('furniture-above', top.x, top.y) === THEME.monitor.offTopLeftGid
          || world.gidAt('furniture-below', top.x, top.y) === THEME.monitor.offTopLeftGid;
        return { m, ch, seatIdx, monitor: hasMon ? { top } : null, bubble: null, busy: 'none' as const, cafeSeat: null, termPhase: Math.random() * 10 };
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
      const say = (rt: Runtime, text: string, dur = 3): void => {
        rt.bubble = { text, t: 0, dur, lift: 0 };
        if (rt.ch.dir !== 'up') rt.ch.talking = true;
      };

      const cafeTaken = new Set<Pt>();
      const sendOnBreak = (rt: Runtime): void => {
        if (cafeSeats.length === 0 && cafeStands.length === 0) return;
        rt.busy = 'break';
        const freeSeats = cafeSeats.filter((c) => !cafeTaken.has(c));
        const toSeat = freeSeats.length > 0 && Math.random() < 0.6;
        const spot = toSeat ? pick(freeSeats) : (cafeStands.length ? pick(cafeStands).t : pick(freeSeats.length ? freeSeats : cafeSeats));
        if (toSeat) cafeTaken.add(spot);
        rt.cafeSeat = toSeat ? spot : null;
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
        if (rt.cafeSeat) { cafeTaken.delete(rt.cafeSeat); rt.cafeSeat = null; }
        // a quarter of returns take the scenic route: the original 30s-roam/30s-rest loop
        if (Math.random() < 0.25) { rt.busy = 'none'; rt.ch.startIdleLoop(); return; }
        if (rt.ch.seatTile && rt.ch.walkTo(world, rt.ch.seatTile, () => {
          rt.ch.sitAt(rt.ch.seatTile!, rt.ch.seatFacing, true);
          rt.busy = 'none';
        })) return;
        rt.busy = 'none';
      };
      /* ── consult meetings: the two personas actually meet in the boardroom ── */
      const meetSeats = THEME.meetSeats
        .map((ms) => ({ tile: world.spawns.get(ms.name), facing: ms.facing }))
        .filter((ms) => ms.tile) as { tile: Pt; facing: 'up' | 'down' | 'left' | 'right' }[];
      interface Meeting { a: Runtime; b: Runtime; phase: 'walk' | 'talk'; endAt: number; talkT: number; speaker: 0 | 1; ok?: boolean }
      let meeting: Meeting | null = null;
      const meetingHas = (rt: Runtime): boolean => !!meeting && (meeting.a === rt || meeting.b === rt);
      const CONSULT_LINES: [string, string][] = [
        ['got a sec? quick question', 'sure — go ahead'],
        ['here’s the gist…', 'hmm, let me think'],
        ['so what would you do?', 'ok, here’s my take'],
        ['that helps — thanks!', 'anytime'],
      ];
      const interrupt = (rt: Runtime): void => {
        rt.ch.stopIdleLoop(); rt.ch.standUp();
        if (rt.cafeSeat) { cafeTaken.delete(rt.cafeSeat); rt.cafeSeat = null; }
        rt.bubble = null; rt.ch.talking = false;
        rt.busy = 'none';
      };
      const startMeeting = (a2: Runtime, b2: Runtime): void => {
        if (meeting || meetSeats.length < 2) return;
        interrupt(a2); interrupt(b2);
        a2.busy = 'errand'; b2.busy = 'errand'; // excluded from breaks while meeting
        meeting = { a: a2, b: b2, phase: 'walk', endAt: clock + 150, talkT: 2.2, speaker: 0 };
        const s0 = meetSeats[0]!, s1 = meetSeats[1]!;
        a2.ch.walkTo(world, s0.tile, () => { a2.ch.sitAt(s0.tile, s0.facing, false); a2.ch.faceFlip = false; });
        b2.ch.walkTo(world, s1.tile, () => { b2.ch.sitAt(s1.tile, s1.facing, false); b2.ch.faceFlip = true; });
      };
      const endMeeting = (ok: boolean): void => {
        if (!meeting) return;
        const { a: a2, b: b2 } = meeting;
        meeting = null;
        for (const rt of [a2, b2]) { rt.ch.talking = false; rt.ch.faceFlip = false; rt.bubble = null; }
        if (ok) a2.ch.setGlyph('success');
        endBreak(a2); endBreak(b2);
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

      // ── grab & throw: pick a Pixie up, carry it, toss it; greetings on landing ──
      interface Grab { rt: Runtime; moved: boolean; lastX: number; lastY: number; lastT: number; vx: number; vy: number }
      let grabbing: Grab | null = null;
      const thrown: { rt: Runtime; vx: number; vy: number }[] = [];
      const GREETS: [string, string][] = [['oh hey!', 'hi!'], ['hello hello', 'heyy'], ['fancy meeting you here', 'small office'], ['👋', 'hey!']];
      const snapToWalkable = (rt: Runtime): void => {
        const t = rt.ch.tile();
        for (let r = 0; r < 8; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          const c = { x: t.x + dx, y: t.y + dy };
          if (c.x >= 0 && c.y >= 0 && c.x < world.cols && c.y < world.rows && world.walk[c.y]![c.x]) {
            rt.ch.x = c.x * TILE + TILE / 2; rt.ch.y = c.y * TILE + TILE;
            return;
          }
        }
      };
      const landAndGreet = (rt: Runtime): void => {
        snapToWalkable(rt);
        const near = runtimes.find((o) => o !== rt && !o.ch.path.length && !meetingHas(o) && Math.hypot(o.ch.x - rt.ch.x, o.ch.y - rt.ch.y) < 115);
        const back = 5000 + Math.random() * 4000;
        if (near) {
          const g = GREETS[Math.floor(Math.random() * GREETS.length)]!;
          rt.ch.dir = 'down'; rt.ch.faceFlip = near.ch.x < rt.ch.x;
          if (!near.ch.sitting) { near.ch.dir = 'down'; near.ch.faceFlip = rt.ch.x < near.ch.x; }
          say(rt, g[0]!, 2.2);
          setTimeout(() => { if (!dead) say(near, g[1]!, 2.2); }, 900);
        }
        setTimeout(() => {
          if (dead || rt.ch.held) return;
          rt.busy = 'none';
          endBreak(rt); // stroll back to the desk
        }, back);
      };

      // ── input: click select, drag pan, wheel zoom, dblclick fit ──
      let drag: { x: number; y: number; moved: boolean } | null = null;
      const touches = new Map<number, { x: number; y: number }>();
      let pinchDist = 0;
      let wasPinch = false;
      let lastTap = { t: 0, x: 0, y: 0 };
      const onDown = (e: PointerEvent): void => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.size === 2) { const [a2, b2] = [...touches.values()]; pinchDist = Math.hypot(a2!.x - b2!.x, a2!.y - b2!.y); drag = null; wasPinch = true; if (grabbing) { grabbing.rt.ch.held = false; landAndGreet(grabbing.rt); grabbing = null; } }
        else {
          const r0 = canvas.getBoundingClientRect();
          const hit = hitTest(cam.toWorld(e.clientX - r0.left, e.clientY - r0.top));
          if (hit && !meetingHas(hit)) {
            interrupt(hit); hit.busy = 'errand'; hit.ch.held = true; hit.ch.sitting = false;
            grabbing = { rt: hit, moved: false, lastX: e.clientX, lastY: e.clientY, lastT: performance.now(), vx: 0, vy: 0 };
          } else drag = { x: e.clientX, y: e.clientY, moved: false };
        }
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
        if (grabbing) {
          const g = grabbing;
          const now2 = performance.now();
          const dtm = Math.max(1, now2 - g.lastT);
          if (Math.abs(e.clientX - g.lastX) + Math.abs(e.clientY - g.lastY) > 4) g.moved = true;
          g.vx = 0.7 * g.vx + 0.3 * ((e.clientX - g.lastX) / dtm) * 1000 / cam.zoom;
          g.vy = 0.7 * g.vy + 0.3 * ((e.clientY - g.lastY) / dtm) * 1000 / cam.zoom;
          g.lastX = e.clientX; g.lastY = e.clientY; g.lastT = now2;
          const r0 = canvas.getBoundingClientRect();
          const w2 = cam.toWorld(e.clientX - r0.left, e.clientY - r0.top);
          g.rt.ch.x = Math.max(8, Math.min(world.W - 8, w2.x));
          g.rt.ch.y = Math.max(40, Math.min(world.H - 4, w2.y + 20));
          canvas.style.cursor = 'grabbing';
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
        if (touches.size === 1) { // pinch → single finger: keep panning, never treat as tap
          const rest = [...touches.values()][0]!;
          drag = { x: rest.x, y: rest.y, moved: true };
          pinchDist = 0;
          return;
        }
        if (touches.size > 0) { drag = null; pinchDist = 0; return; }
        if (grabbing) {
          const g = grabbing; grabbing = null;
          g.rt.ch.held = false;
          canvas.style.cursor = 'default';
          if (!g.moved) { // a tap on the character — select, don't yeet
            g.rt.busy = 'none';
            snapToWalkable(g.rt);
            endBreak(g.rt);
            onSelect(g.rt.m.id); cam.nudgeToward(g.rt.ch.x, g.rt.ch.y, true);
            setHover(null);
            return;
          }
          const sp = Math.hypot(g.vx, g.vy);
          const cap = 900;
          const k = sp > cap ? cap / sp : 1;
          if (sp > 150) thrown.push({ rt: g.rt, vx: g.vx * k, vy: g.vy * k });
          else landAndGreet(g.rt);
          return;
        }
        const endedPinch = wasPinch; wasPinch = false; pinchDist = 0;
        const wasDrag = drag?.moved;
        drag = null;
        if (wasDrag || endedPinch) return; // gestures are not taps
        // double-tap to fit (touch counterpart of double-click)
        const now = performance.now();
        if (e.pointerType !== 'mouse' && now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 28) {
          lastTap = { t: 0, x: 0, y: 0 };
          cam.fit();
          return;
        }
        lastTap = { t: now, x: e.clientX, y: e.clientY };
        const r = canvas.getBoundingClientRect();
        const w = cam.toWorld(e.clientX - r.left, e.clientY - r.top);
        const hit = hitTest(w);
        if (hit) { onSelect(hit.m.id); cam.nudgeToward(hit.ch.x, hit.ch.y, true); }
        else onSelect(null);
      };
      const onCancel = (e: PointerEvent): void => {
        touches.delete(e.pointerId);
        drag = null; pinchDist = 0; wasPinch = false;
        if (grabbing) { grabbing.rt.ch.held = false; landAndGreet(grabbing.rt); grabbing = null; }
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
          const r = rt.ch.hitRect(); // same rect the sprite is drawn with (sit nudge + crop)
          if (w.x >= r.x && w.x <= r.x + r.w && w.y >= r.y && w.y <= r.y + r.h) {
            if (!best || rt.ch.y > best.ch.y) best = rt;
          }
        }
        return best;
      };
      canvas.addEventListener('pointerdown', onDown);
      canvas.addEventListener('pointermove', onMove);
      canvas.addEventListener('pointerup', onUp);
      canvas.addEventListener('pointercancel', onCancel);
      canvas.addEventListener('lostpointercapture', onCancel);
      canvas.addEventListener('wheel', onWheel, { passive: false });
      canvas.addEventListener('dblclick', onDbl);
      cleanup.push(() => {
        canvas.removeEventListener('pointerdown', onDown);
        canvas.removeEventListener('pointermove', onMove);
        canvas.removeEventListener('pointerup', onUp);
        canvas.removeEventListener('pointercancel', onCancel);
        canvas.removeEventListener('lostpointercapture', onCancel);
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
          ctx.fillStyle = 'rgba(180,205,235,0.85)';
          for (let li = 0; li < 2; li++) {
            const m2 = (rt.termPhase * 6.4 + li * 12) % 22;
            ctx.fillRect(sx + 2, sy + 22 - m2, 12 + ((li * 7 + Math.floor(rt.termPhase)) % 16), 2);
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
        // overlap resolver: sort by bottom edge, push upward (iterate to a fixed point
        // so simultaneous bubbles never overlap-erase each other), then clamp on-screen
        placed.sort((a, b) => a.y + a.h - (b.y + b.h) || a.x - b.x);
        for (let pass = 0; pass < 4; pass++) {
          let moved = false;
          for (let i = 0; i < placed.length; i++) for (let j = 0; j < i; j++) {
            const a = placed[i]!, b = placed[j]!;
            if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) { a.y = b.y - a.h - 2; moved = true; }
          }
          if (!moved) break;
        }
        for (const p2 of placed) {
          p2.x = Math.max(4, Math.min(cam.viewW - p2.w - 4, p2.x));
          p2.y = Math.max(4, p2.y);
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

      if (reduced) {
        // Reduced motion suppresses AMBIENT animation, not rendering: characters
        // stay seated, but the camera still works and every change repaints.
        let last2 = performance.now(); let pose = { x: -1, y: -1, z: -1 };
        const still = (now: number): void => {
          if (dead) return;
          const dt2 = Math.min(0.05, (now - last2) / 1000); last2 = now;
          cam.update(dt2);
          if (Math.abs(cam.x - pose.x) > 0.05 || Math.abs(cam.y - pose.y) > 0.05 || Math.abs(cam.zoom - pose.z) > 0.0005) {
            pose = { x: cam.x, y: cam.y, z: cam.zoom };
            draw(now / 1000);
          }
          raf = requestAnimationFrame(still);
        };
        raf = requestAnimationFrame(still);
        return;
      }

      let last = performance.now();
      const tick = (now: number): void => {
        if (dead) return;
        const dt = Math.min(0.05, (now - last) / 1000); last = now;
        clock += dt;
        for (const rt of runtimes) {
          rt.ch.update(dt, world);
          rt.termPhase += dt * 3;
          if (rt.bubble) { rt.bubble.t += dt; if (rt.bubble.t > rt.bubble.dur) { rt.bubble = null; if (!meetingHas(rt)) rt.ch.talking = false; } }
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
          const cand = runtimes.filter((r) => r.busy === 'none' && !meetingHas(r));
          if (cand.length && Math.random() < 0.6) sendOnErrand(pick(cand));
        }
        // thrown Pixies: slide with friction, bounce off the walls, then land
        for (let i = thrown.length - 1; i >= 0; i--) {
          const th = thrown[i]!;
          th.rt.ch.x += th.vx * dt; th.rt.ch.y += th.vy * dt;
          const damp = Math.pow(0.02, dt);
          th.vx *= damp; th.vy *= damp;
          if (th.rt.ch.x < 24 || th.rt.ch.x > world.W - 24) { th.vx = -th.vx * 0.7; th.rt.ch.x = Math.max(24, Math.min(world.W - 24, th.rt.ch.x)); }
          if (th.rt.ch.y < 72 || th.rt.ch.y > world.H - 8) { th.vy = -th.vy * 0.7; th.rt.ch.y = Math.max(72, Math.min(world.H - 8, th.rt.ch.y)); }
          if (Math.hypot(th.vx, th.vy) < 26) { thrown.splice(i, 1); landAndGreet(th.rt); }
        }
        // the boardroom conversation: alternate speakers, mouths moving
        if (meeting) {
          const m2 = meeting;
          if (m2.phase === 'walk' && m2.a.ch.sitting && m2.b.ch.sitting && !m2.a.ch.path.length && !m2.b.ch.path.length) m2.phase = 'talk';
          if (m2.phase === 'talk') {
            m2.talkT += dt;
            if (m2.talkT > 2.2) {
              m2.talkT = 0;
              const beat = CONSULT_LINES[Math.floor(Math.random() * CONSULT_LINES.length)]!;
              const speakerRt = m2.speaker === 0 ? m2.a : m2.b;
              const otherRt = m2.speaker === 0 ? m2.b : m2.a;
              say(speakerRt, beat[m2.speaker]!, 2);
              otherRt.ch.talking = false;
              m2.speaker = m2.speaker === 0 ? 1 : 0;
            }
          }
          if (clock > m2.endAt) endMeeting(m2.ok ?? false);
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

      // A real consult in the side chat sends REAL mail: envelope from the selected
      // persona's desk to the consulted colleague's desk (viewer-local, their own action).
      const onTool = (e: Event): void => {
        const d = (e as CustomEvent<{ name?: string; input?: { colleague?: string } }>).detail;
        if (!d?.name?.endsWith('ask_colleague')) return;
        const from = runtimes.find((r) => r.m.id === selRef.current) ?? runtimes[0];
        const q2 = (d.input?.colleague ?? '').toLowerCase().trim();
        const to = q2 ? runtimes.find((r) => r.m.name.toLowerCase().includes(q2) || q2.includes(r.m.name.toLowerCase())) : undefined;
        if (!from || !to || from === to) return;
        envelopes.push({ from: { x: from.ch.x, y: from.ch.y - WALKER_H / 2 }, to: { x: to.ch.x, y: to.ch.y - WALKER_H / 2 }, t: 0, dur: 1.6, color: '#9ecbf0', burst: 0 });
        startMeeting(from, to);
      };
      const onToolResult = (e: Event): void => {
        const d = (e as CustomEvent<{ name?: string; ok?: boolean }>).detail;
        if (!d?.name?.endsWith('ask_colleague') || !meeting) return;
        // the relay can resolve faster than the walk — let the meetup play out:
        // give them time to arrive and trade a couple of beats before wrapping
        meeting.endAt = Math.min(meeting.endAt, clock + (meeting.phase === 'talk' ? 3 : 11));
        meeting.ok = d.ok !== false;
      };
      window.addEventListener('opersona:tool', onTool);
      window.addEventListener('opersona:tool-result', onToolResult);
      cleanup.push(() => { window.removeEventListener('opersona:tool', onTool); window.removeEventListener('opersona:tool-result', onToolResult); });
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
      <div className="pointer-events-none absolute right-2 top-2 hidden rounded-md bg-neutral-900/70 px-2 py-1 font-mono text-[10px] text-neutral-400 [@media(pointer:fine)]:block">
        drag to pan · scroll to zoom · double-click to fit
      </div>
      <div className="pointer-events-none absolute right-2 top-2 rounded-md bg-neutral-900/70 px-2 py-1 font-mono text-[10px] text-neutral-400 [@media(pointer:fine)]:hidden">
        drag to pan · pinch to zoom · double-tap to fit
      </div>
    </div>
  );
}
