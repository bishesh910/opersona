/**
 * Per-conversation event bus: a ring buffer (for Last-Event-ID replay) plus live
 * subscribers. The SSE route subscribes; the session manager publishes.
 */
import type { EngineEvent } from '@opersona/shared';

const RING = 500;
interface Stored { id: number; ev: EngineEvent }
interface Bus { next: number; ring: Stored[]; subs: Set<(s: Stored) => void> }
const buses = new Map<string, Bus>();

function bus(conversationId: string): Bus {
  let b = buses.get(conversationId);
  if (!b) { b = { next: 1, ring: [], subs: new Set() }; buses.set(conversationId, b); }
  return b;
}

export function publish(conversationId: string, ev: EngineEvent): void {
  const b = bus(conversationId);
  const s = { id: b.next++, ev };
  b.ring.push(s);
  if (b.ring.length > RING) b.ring.shift();
  for (const fn of b.subs) { try { fn(s); } catch { /* subscriber gone */ } }
}

export function subscribe(conversationId: string, fn: (s: Stored) => void, afterId = 0): () => void {
  const b = bus(conversationId);
  for (const s of b.ring) if (s.id > afterId) fn(s);
  b.subs.add(fn);
  return () => { b.subs.delete(fn); };
}

/** Replay cursor for "just the in-flight turn": everything after the last
 *  result/error boundary. If nothing is in flight (the ring ends on a result),
 *  the boundary result itself is replayed so a late-joining client can clear
 *  its "still replying" state. */
export function turnStartId(conversationId: string): number {
  const b = buses.get(conversationId);
  if (!b || b.ring.length === 0) return 0;
  let lastResult = -1;
  for (let i = b.ring.length - 1; i >= 0; i--) {
    const t = b.ring[i]!.ev.type;
    if (t === 'result' || t === 'error') { lastResult = i; break; }
  }
  if (lastResult === -1) return 0;
  const boundary = b.ring[lastResult]!;
  const tailIsResult = lastResult === b.ring.length - 1;
  return tailIsResult ? boundary.id - 1 : boundary.id;
}
