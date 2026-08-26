/**
 * Office engine — a faithful web port of the munder-difflin office scene
 * (Pixi → canvas 2D). Map: office.tmj vendored from shahar061/the-office (ISC).
 * Tile art: LimeZu "Modern Interiors" — licensed per deployment, loaded from
 * /office-assets/*.png at runtime and NEVER committed; a flat-color fallback
 * renders when the tilesets are absent so the floor still works.
 *
 * World units are map pixels × 2 (32px tiles), so the 36×52 v2 walker sprites
 * keep the original's character:tile ratio (18px on 16px tiles).
 */

export const TILE = 32; // world px per tile (map is 16px-tile art, baked at 2×)
export const MAP_SCALE = 2;

/* ── Tiled parsing (port of TiledMapRenderer.ts) ─────────────────────────── */
const FLIP_H = 0x80000000, FLIP_V = 0x40000000, FLIP_D = 0x20000000, GID_MASK = 0x1fffffff;

export interface TiledMap {
  width: number; height: number;
  layers: { name: string; type: string; data?: number[]; objects?: { name: string; x: number; y: number; width: number; height: number }[] }[];
  tilesets: { firstgid: number; columns?: number; imagewidth?: number; imageheight?: number; tilecount?: number; source?: string }[];
}

export interface TilesetDef { firstgid: number; columns: number; tilecount: number; img: HTMLImageElement | null }

export interface World {
  cols: number; rows: number; // tiles
  W: number; H: number;       // world px
  walk: boolean[][];          // [y][x]
  spawns: Map<string, { x: number; y: number }>;
  zones: Map<string, { x: number; y: number; w: number; h: number }>;
  base: HTMLCanvasElement;    // floor + walls + furniture-below (baked ×2)
  above: HTMLCanvasElement;   // furniture-above (drawn over characters)
  gidAt: (layer: 'furniture-below' | 'furniture-above', tx: number, ty: number) => number;
  drawGid: (ctx: CanvasRenderingContext2D, gid: number, tx: number, ty: number) => void;
}

const layerOf = (map: TiledMap, name: string) => map.layers.find((l) => l.name === name);

/** Resolve a gid to its tileset + source rect (walk tilesets last-to-first). */
function locate(tilesets: TilesetDef[], gid: number): { ts: TilesetDef; sx: number; sy: number } | null {
  const id = gid & GID_MASK;
  for (let i = tilesets.length - 1; i >= 0; i--) {
    const ts = tilesets[i]!;
    if (id >= ts.firstgid) {
      const local = id - ts.firstgid;
      return { ts, sx: (local % ts.columns) * 16, sy: Math.floor(local / ts.columns) * 16 };
    }
  }
  return null;
}

function drawTile(ctx: CanvasRenderingContext2D, tilesets: TilesetDef[], gid: number, tx: number, ty: number): void {
  const loc = locate(tilesets, gid);
  const x = tx * TILE, y = ty * TILE;
  if (!loc || !loc.ts.img) {
    // graceful fallback: flat tinted tile derived from the gid so the layout still reads
    const id = gid & GID_MASK;
    ctx.fillStyle = `hsl(${(id * 37) % 360} 18% ${28 + (id % 5) * 8}%)`;
    ctx.fillRect(x, y, TILE, TILE);
    return;
  }
  const h = !!(gid & FLIP_H), v = !!(gid & FLIP_V), d = !!(gid & FLIP_D);
  if (!h && !v && !d) { ctx.drawImage(loc.ts.img, loc.sx, loc.sy, 16, 16, x, y, TILE, TILE); return; }
  ctx.save();
  ctx.translate(x + TILE / 2, y + TILE / 2);
  // Tiled flip semantics (same combos as TiledMapRenderer.ts:221-240)
  if (d) { ctx.rotate(Math.PI / 2); ctx.scale(v ? -1 : 1, h ? 1 : -1); }
  else ctx.scale(h ? -1 : 1, v ? -1 : 1);
  ctx.drawImage(loc.ts.img, loc.sx, loc.sy, 16, 16, -TILE / 2, -TILE / 2, TILE, TILE);
  ctx.restore();
}

/** Load one tileset image; resolves null on 404 (fallback rendering kicks in). */
function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** Build the world: bake static layers, collision grid, spawns, zones. */
export async function buildWorld(map: TiledMap): Promise<World> {
  // tileset metadata: gid 1 embedded in the map; the two external refs are
  // patched with known metadata (port of themeLoader.resolveThemeMap)
  const defs: { firstgid: number; columns: number; tilecount: number; url: string }[] = [
    { firstgid: 1, columns: 16, tilecount: 512, url: '/office-assets/office-tileset.png' },
    { firstgid: 513, columns: 16, tilecount: 512, url: '/office-assets/a5-office-floors-walls.png' },
    { firstgid: 1025, columns: 16, tilecount: 1424, url: '/office-assets/interiors.png' },
  ];
  const imgs = await Promise.all(defs.map((d) => loadImage(d.url)));
  const tilesets: TilesetDef[] = defs.map((d, i) => ({ firstgid: d.firstgid, columns: d.columns, tilecount: d.tilecount, img: imgs[i]! }));

  const cols = map.width, rows = map.height;
  const W = cols * TILE, H = rows * TILE;

  // collision → walkability
  const walk: boolean[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => true));
  const coll = layerOf(map, 'collision');
  if (coll?.data) for (let i = 0; i < coll.data.length; i++) if (coll.data[i]! !== 0) walk[Math.floor(i / cols)]![i % cols] = false;

  // spawn points + zones (object coords are map px; tile = floor(px/16))
  const spawns = new Map<string, { x: number; y: number }>();
  for (const o of layerOf(map, 'spawn-points')?.objects ?? []) spawns.set(o.name, { x: Math.floor(o.x / 16), y: Math.floor(o.y / 16) });
  const zones = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const o of layerOf(map, 'zones')?.objects ?? []) zones.set(o.name, { x: Math.floor(o.x / 16), y: Math.floor(o.y / 16), w: Math.ceil(o.width / 16), h: Math.ceil(o.height / 16) });
  // seats & entrance are force-walkable so characters can path onto them
  for (const [name, t] of spawns) {
    if (/^(desk-|pc-|warroom-|entrance)/.test(name) && t.y >= 0 && t.y < rows && t.x >= 0 && t.x < cols) walk[t.y]![t.x] = true;
  }

  // bake static layers
  const bake = (names: string[]): HTMLCanvasElement => {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    for (const n of names) {
      const l = layerOf(map, n);
      if (!l?.data) continue;
      for (let i = 0; i < l.data.length; i++) {
        const gid = l.data[i]!;
        if (gid !== 0) drawTile(ctx, tilesets, gid, i % cols, Math.floor(i / cols));
      }
    }
    return c;
  };
  const base = bake(['floor', 'walls', 'furniture-below']);
  const above = bake(['furniture-above']);

  const gidAt = (name: 'furniture-below' | 'furniture-above', tx: number, ty: number): number => {
    const l = layerOf(map, name);
    if (!l?.data || tx < 0 || ty < 0 || tx >= cols || ty >= rows) return 0;
    return (l.data[ty * cols + tx]! & GID_MASK) >>> 0;
  };
  const drawGid = (ctx: CanvasRenderingContext2D, gid: number, tx: number, ty: number): void => drawTile(ctx, tilesets, gid, tx, ty);

  return { cols, rows, W, H, walk, spawns, zones, base, above, gidAt, drawGid };
}

/* ── pathfinding (verbatim BFS port of pathfinding.ts) ───────────────────── */
export interface Pt { x: number; y: number }

export function findPath(walk: boolean[][], start: Pt, goal: Pt): Pt[] | null {
  const rows = walk.length, cols = walk[0]?.length ?? 0;
  const ok = (p: Pt): boolean => p.x >= 0 && p.y >= 0 && p.x < cols && p.y < rows && walk[p.y]![p.x]!;
  if (!ok(goal)) return null;
  if (start.x === goal.x && start.y === goal.y) return [];
  const key = (p: Pt): string => `${p.x},${p.y}`;
  const seen = new Set<string>([key(start)]);
  const prev = new Map<string, Pt>();
  const queue: Pt[] = [start];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const d of [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]) {
      const n = { x: cur.x + d.x, y: cur.y + d.y };
      const k = key(n);
      if (seen.has(k) || !ok(n)) continue;
      seen.add(k); prev.set(k, cur);
      if (n.x === goal.x && n.y === goal.y) {
        const path: Pt[] = [n];
        let p: Pt | undefined = cur;
        while (p && !(p.x === start.x && p.y === start.y)) { path.unshift(p); p = prev.get(key(p)); }
        return path;
      }
      queue.push(n);
    }
  }
  return null;
}

/* ── camera (port of Camera.ts + NEW wheel-zoom / drag-pan) ──────────────── */
const LERP = 0.08;

export class Camera {
  x = 0; y = 0; zoom = 1;               // current
  tx = 0; ty = 0; tzoom = 1;            // target
  viewW = 1; viewH = 1;
  minZoom = 0.5; maxZoom = 4;
  manual = false;                        // user grabbed the camera — stop nudging
  private nudge = { dx: 0, dy: 0, t: 0, dur: 0 };

  constructor(public worldW: number, public worldH: number) {}

  setView(w: number, h: number): void {
    this.viewW = w; this.viewH = h;
    this.minZoom = Math.min(w / this.worldW, h / this.worldH);
  }
  fit(): void {
    this.tzoom = this.zoom = this.minZoom;
    this.tx = this.x = this.worldW / 2;
    this.ty = this.y = this.worldH / 2;
    this.manual = false;
  }
  focusOn(x: number, y: number, zoom?: number): void {
    this.tx = x; this.ty = y;
    if (zoom !== undefined) this.tzoom = Math.max(this.minZoom, Math.min(this.maxZoom, zoom));
  }
  /** Gentle pan 40% of the way toward a point over 1.2s (original nudgeToward). */
  nudgeToward(x: number, y: number): void {
    if (this.manual) return;
    this.nudge = { dx: (x - this.x) * 0.4, dy: (y - this.y) * 0.4, t: 0, dur: 1.2 };
  }
  /** NEW: wheel zoom about a screen point. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const z0 = this.zoom;
    const z1 = Math.max(this.minZoom, Math.min(this.maxZoom, z0 * factor));
    // keep the world point under the cursor fixed
    const wx = this.x + (sx - this.viewW / 2) / z0;
    const wy = this.y + (sy - this.viewH / 2) / z0;
    this.tzoom = this.zoom = z1;
    this.tx = this.x = wx - (sx - this.viewW / 2) / z1;
    this.ty = this.y = wy - (sy - this.viewH / 2) / z1;
    this.manual = true;
    this.clamp();
  }
  /** NEW: drag pan (screen-space delta). */
  panBy(dsx: number, dsy: number): void {
    this.tx = this.x = this.x - dsx / this.zoom;
    this.ty = this.y = this.y - dsy / this.zoom;
    this.manual = true;
    this.clamp();
  }
  private clamp(): void {
    const halfW = this.viewW / 2 / this.zoom, halfH = this.viewH / 2 / this.zoom;
    if (this.worldW * this.zoom <= this.viewW) this.x = this.tx = this.worldW / 2;
    else this.x = this.tx = Math.max(halfW, Math.min(this.worldW - halfW, this.x));
    if (this.worldH * this.zoom <= this.viewH) this.y = this.ty = this.worldH / 2;
    else this.y = this.ty = Math.max(halfH, Math.min(this.worldH - halfH, this.y));
  }
  update(dt: number): void {
    this.zoom += (this.tzoom - this.zoom) * LERP;
    this.x += (this.tx - this.x) * LERP;
    this.y += (this.ty - this.y) * LERP;
    if (this.nudge.dur > 0 && this.nudge.t < this.nudge.dur) {
      const k = (1 - this.nudge.t / this.nudge.dur) * dt / this.nudge.dur;
      this.x += this.nudge.dx * k; this.tx += this.nudge.dx * k;
      this.y += this.nudge.dy * k; this.ty += this.nudge.dy * k;
      this.nudge.t += dt;
    }
    this.clamp();
  }
  /** ctx transform for the world pass. */
  apply(ctx: CanvasRenderingContext2D, dpr: number): void {
    ctx.setTransform(this.zoom * dpr, 0, 0, this.zoom * dpr,
      dpr * (this.viewW / 2 - this.x * this.zoom), dpr * (this.viewH / 2 - this.y * this.zoom));
  }
  toWorld(sx: number, sy: number): Pt {
    return { x: this.x + (sx - this.viewW / 2) / this.zoom, y: this.y + (sy - this.viewH / 2) / this.zoom };
  }
}

/* ── theme (OFFICE_THEME, ported values) ─────────────────────────────────── */
export const THEME = {
  primarySeatNames: [
    'desk-ceo',
    'pc-1', 'pc-2', 'pc-3', 'pc-4', 'pc-5', 'pc-6',
    'desk-chief-architect', 'desk-product-manager', 'desk-team-lead',
    'desk-backend-engineer', 'desk-ui-ux-expert', 'desk-data-engineer',
    'desk-project-manager', 'desk-market-researcher', 'desk-agent-organizer',
  ],
  cafeSeatNames: ['cafe-seat-1', 'cafe-seat-2', 'cafe-seat-3', 'cafe-seat-4'],
  cafeStands: [['cafe-stand-coffee', 'coffee'], ['cafe-stand-vending', 'vending']] as [string, string][],
  coffee: {
    trayTile: { x: 29, y: 15 }, trayStand: { x: 29, y: 16 },
    machineStand: { x: 26, y: 20 }, sinkTile: { x: 28, y: 18 }, sinkStand: { x: 28, y: 20 },
    maxCups: 4,
  },
  errandSpots: [
    { kind: 'water', stand: { x: 2, y: 20 }, facing: 'left', fx: { x: 1, y: 20 }, duration: 4.5 },
    { kind: 'water', stand: { x: 22, y: 20 }, facing: 'right', fx: { x: 23, y: 20 }, duration: 4.5 },
    { kind: 'water', stand: { x: 30, y: 20 }, facing: 'right', fx: { x: 31, y: 20 }, duration: 4.5 },
    { kind: 'water', stand: { x: 6, y: 4 }, facing: 'up', fx: { x: 6, y: 3 }, duration: 4.5, bossOnly: true },
    { kind: 'water', stand: { x: 17, y: 4 }, facing: 'up', fx: { x: 17, y: 3 }, duration: 4.5 },
    { kind: 'window', stand: { x: 10, y: 3 }, facing: 'up', fx: { x: 10, y: 1 }, duration: 5 },
    { kind: 'window', stand: { x: 15, y: 3 }, facing: 'up', fx: { x: 14, y: 1 }, duration: 5 },
    { kind: 'dispenser', stand: { x: 16, y: 3 }, facing: 'down', fx: { x: 16, y: 4 }, duration: 3.5 },
    { kind: 'dispenser', stand: { x: 32, y: 4 }, facing: 'up', fx: { x: 32, y: 3 }, duration: 3.5 },
    { kind: 'fridge', stand: { x: 29, y: 20 }, facing: 'up', fx: { x: 29, y: 19 }, duration: 3.2 },
    { kind: 'bin', stand: { x: 18, y: 20 }, facing: 'left', fx: { x: 17, y: 20 }, duration: 2.6 },
  ] as { kind: string; stand: Pt; facing: 'up' | 'down' | 'left' | 'right'; fx: Pt; duration: number; bossOnly?: boolean }[],
  monitor: { offTopLeftGid: 365, onGids: [[367, 0, 0], [368, 1, 0], [383, 0, 1], [384, 1, 1]] as [number, number, number][] },
} as const;
