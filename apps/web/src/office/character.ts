/**
 * Character — port of munder-difflin Character.ts to canvas 2D.
 * All tuned constants are ×2 (original: 16px tiles, 18×32 sprites, 48 px/s;
 * here: 32px world tiles, 36×52 v2 walkers, 96 px/s). Sitting is the same
 * beloved fake: idle frame + directional nudge + a bottom crop so legs read
 * as tucked under the desk.
 */
import { TILE, findPath, type Pt, type World } from './engine';
import { WALKER_W, WALKER_H } from '@/lib/pixel-avatar';

const SPEED = 96;               // world px/s (original 48 on 16px tiles)
const SIT_DOWN = 24, SIT_UP = 10, SIT_SIDE_X = 8, SIT_SIDE_Y = 8;
const CROP_DOWN = 16, CROP_OTHER = 4;
const WALK_FRAME_MS = 110;      // ≈ the original's 0.15 frame/tick ping-pong
const WALK_SEQ = [0, 1, 2, 1];

export type Dir = 'up' | 'down' | 'left' | 'right';
export type Glyph = 'none' | 'blocked' | 'success';

export class Character {
  x: number; y: number;         // feet anchor, world px
  dir: Dir = 'down';
  sitting = false;
  working = false;              // glow while seated-working
  path: Pt[] = [];
  onArrive: (() => void) | null = null;
  glyph: Glyph = 'none';
  glyphT = 0;
  /** meeting/cafe chatter: alternate the talk frames while seated facing front */
  talking = false;
  talkFrames: HTMLCanvasElement[] | null = null; // [closed, open]
  faceFlip = false; // mirrored front pose (turn toward a partner)
  private animT = 0;
  private animI = 0;
  private pauseT = 0;
  // idle loop (original: 30s roam ⇄ 30s desk rest)
  idleMode: 'none' | 'linger' | 'toDesk' | 'resting' = 'none';
  idleT = 0;
  seatTile: Pt | null = null;
  seatFacing: Dir = 'up';

  constructor(
    public id: string,
    public frames: HTMLCanvasElement[], // [front 0,1,2, back 0,1,2]
    tile: Pt,
  ) {
    this.x = tile.x * TILE + TILE / 2;
    this.y = tile.y * TILE + TILE;
  }

  tile(): Pt { return { x: Math.floor(this.x / TILE), y: Math.floor((this.y - 1) / TILE) }; }

  walkTo(world: World, goal: Pt, onArrive?: () => void): boolean {
    const p = findPath(world.walk, this.tile(), goal);
    if (p === null) return false;
    this.standUp();
    if (p.length === 0) { // already on the tile — fire the arrival now (original walkToAndThen)
      this.path = [];
      this.onArrive = null;
      onArrive?.();
      return true;
    }
    this.path = p;
    this.onArrive = onArrive ?? null;
    return true;
  }

  sitAt(seatTile: Pt, facing: Dir, working: boolean): void {
    this.sitting = true; this.working = working;
    this.dir = facing;
    this.path = [];
    this.x = seatTile.x * TILE + TILE / 2;
    this.y = seatTile.y * TILE + TILE;
    this.animI = 0;
  }

  standUp(): void { this.sitting = false; this.working = false; }

  setGlyph(g: Glyph): void { this.glyph = g; this.glyphT = 0; }

  update(dt: number, world: World): void {
    this.glyphT += dt;
    if (this.glyph === 'success' && this.glyphT > 0.9) this.glyph = 'none';
    if (this.pauseT > 0) { this.pauseT -= dt; return; }
    if (this.path.length > 0) {
      const node = this.path[0]!;
      const gx = node.x * TILE + TILE / 2, gy = node.y * TILE + TILE;
      const dx = gx - this.x, dy = gy - this.y;
      const dist = Math.hypot(dx, dy);
      const step = SPEED * dt;
      if (dist <= step) { this.x = gx; this.y = gy; this.path.shift(); }
      else { this.x += (dx / dist) * step; this.y += (dy / dist) * step; }
      this.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down');
      this.animT += dt * 1000;
      if (this.animT > WALK_FRAME_MS) { this.animT = 0; this.animI = (this.animI + 1) % WALK_SEQ.length; }
      if (this.path.length === 0) {
        this.animI = 0;
        const cb = this.onArrive; this.onArrive = null;
        cb?.();
      }
    } else {
      this.animI = 0;
      this.updateIdle(dt, world);
    }
  }

  /** 30s wander ⇄ 30s desk rest, exactly the original rhythm. */
  startIdleLoop(): void { this.idleMode = 'linger'; this.idleT = 0; }
  stopIdleLoop(): void { this.idleMode = 'none'; }

  private updateIdle(dt: number, world: World): void {
    if (this.idleMode === 'none') return;
    this.idleT += dt;
    if (this.idleMode === 'linger') {
      if (this.idleT > 30) {
        this.idleMode = 'toDesk'; this.idleT = 0;
        if (this.seatTile && this.walkTo(world, this.seatTile, () => {
          if (this.seatTile) this.sitAt(this.seatTile, this.seatFacing, false);
          this.idleMode = 'resting'; this.idleT = 0;
        })) return;
        this.idleMode = 'linger'; // desk unreachable — keep roaming
      } else if (!this.sitting && Math.random() < dt / 3) {
        // wander: random walkable tile within ±6, brief pause after arriving
        const t = this.tile();
        for (let tries = 0; tries < 6; tries++) {
          const cand = { x: t.x + Math.floor(Math.random() * 13) - 6, y: t.y + Math.floor(Math.random() * 13) - 6 };
          if (cand.x >= 0 && cand.y >= 0 && cand.x < world.cols && cand.y < world.rows && world.walk[cand.y]![cand.x]) {
            if (this.walkTo(world, cand, () => { this.pauseT = 1 + Math.random() * 2; })) break;
          }
        }
      }
    } else if (this.idleMode === 'resting' && this.idleT > 30) {
      // rest over — back to work at the desk (the loop hands control back)
      this.idleMode = 'none';
      this.working = true;
    }
  }

  /** The rect actually drawn (sit nudge + crop applied) — draw and hit-testing share it. */
  hitRect(): { x: number; y: number; w: number; h: number; ox: number; oy: number; crop: number } {
    let ox = 0, oy = 0, crop = 0;
    if (this.sitting) {
      if (this.dir === 'down') { oy = SIT_DOWN; crop = CROP_DOWN; }
      else if (this.dir === 'up') { oy = SIT_UP; crop = CROP_OTHER; }
      else { ox = this.dir === 'left' ? -SIT_SIDE_X : SIT_SIDE_X; oy = SIT_SIDE_Y; crop = CROP_OTHER; }
    }
    return { x: Math.round(this.x - WALKER_W / 2 + ox), y: Math.round(this.y - WALKER_H + oy), w: WALKER_W, h: WALKER_H - crop, ox, oy, crop };
  }

  /** Draw at the feet anchor with sit nudge + crop. ctx is in world space. */
  draw(ctx: CanvasRenderingContext2D, t: number, selected: boolean): void {
    const backSprite = this.dir === 'up';
    const flip = this.dir === 'left' || (this.dir === 'down' && this.faceFlip);
    let frame = this.frames[(backSprite ? 3 : 0) + (this.path.length ? WALK_SEQ[this.animI]! : 0)]!;
    if (this.talking && this.talkFrames && !this.path.length && this.dir !== 'up') {
      frame = this.talkFrames[Math.floor(t / 0.16) % 2]!; // mouth open/closed
    }
    const r = this.hitRect();
    const { ox, oy } = r;
    const drawH = r.h;
    const px = r.x;
    const py = r.y;
    if (this.working) { // pulsing work glow under the feet
      ctx.save();
      ctx.globalAlpha = 0.16 + 0.08 * Math.sin(t * 3);
      ctx.fillStyle = '#f2df8a';
      ctx.beginPath();
      ctx.ellipse(Math.round(this.x), Math.round(this.y) - 2 + oy, 20, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    if (selected) {
      ctx.save();
      ctx.globalAlpha = 0.35 + 0.15 * Math.sin(t * 4);
      ctx.strokeStyle = '#e8b23c';
      ctx.lineWidth = 2;
      ctx.strokeRect(px - 2, py - 2, WALKER_W + 4, drawH + 4);
      ctx.restore();
    }
    ctx.save();
    if (flip) { ctx.translate(px + WALKER_W, py); ctx.scale(-1, 1); ctx.drawImage(frame, 0, 0, WALKER_W, drawH, 0, 0, WALKER_W, drawH); }
    else ctx.drawImage(frame, 0, 0, WALKER_W, drawH, px, py, WALKER_W, drawH);
    ctx.restore();
    if (this.glyph === 'blocked' && Math.floor(t * 2) % 2 === 0) {
      ctx.fillStyle = '#e05252';
      ctx.font = 'bold 14px monospace';
      ctx.fillText('!', Math.round(this.x) - 2, py - 4);
    } else if (this.glyph === 'success') {
      ctx.fillStyle = '#7fc98b';
      ctx.font = 'bold 12px monospace';
      ctx.fillText('✦', Math.round(this.x) - 4 + Math.sin(t * 9) * 3, py - 4 - this.glyphT * 8);
    }
  }
}
