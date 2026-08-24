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
