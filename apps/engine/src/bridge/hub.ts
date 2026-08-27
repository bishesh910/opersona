/**
 * Bridge hub — the engine side of the opersona bridge. One authenticated
 * outbound WebSocket per user machine; the hub multiplexes chat sessions over
 * it and services the two RPCs a remote session needs from the cloud:
 * persona tools (DB) and human approvals. Registry is keyed by orgId
 * (workspace = person after the pivot); a second connection for the same
 * workspace replaces the first (laptop wins over the forgotten desktop).
 */
import { randomUUID, createHash } from 'node:crypto';
import type { WebSocket } from 'ws';
import { eq, and, isNull } from 'drizzle-orm';
import { db, bridgeTokens } from '@opersona/db';
import { bridgeFrame, type BridgeToEngine, type EngineToBridge, type SDKishMessage } from './types.js';
import { executePersonaTool, type ToolContext } from '../persona/mcp.js';
import { requestApproval } from '../sessions/approvals.js';

export interface BridgeJobResult { ok: boolean; output?: unknown; text?: string; error?: string; usage?: { input: number; output: number; cacheRead?: number } }
interface PendingJob { resolve: (r: BridgeJobResult) => void; timer: NodeJS.Timeout }
const pendingJobs = new Map<string, PendingJob>();

interface BridgeSessionSink {
  ctx: ToolContext;
  onMessage: (m: SDKishMessage) => void;
  onEnd: (error?: string) => void;
}

export interface BridgeConn {
  orgId: string;
  userId: string;
  tokenId: string;
  host: string;
  claude?: string;
  since: Date;
  ws: WebSocket;
  sessions: Map<string, BridgeSessionSink>;
  alive: boolean;
}

const conns = new Map<string, BridgeConn>();

export const bridgeFor = (orgId: string): BridgeConn | undefined => conns.get(orgId);
export const bridgeStatus = (orgId: string): { connected: boolean; host?: string; claude?: string; since?: string } => {
  const c = conns.get(orgId);
  return c ? { connected: true, host: c.host, claude: c.claude, since: c.since.toISOString() } : { connected: false };
};

export function send(conn: BridgeConn, frame: EngineToBridge): void {
  try { conn.ws.send(JSON.stringify(frame)); } catch (e) { console.error('[bridge] send failed', conn.orgId, e); }
}

/** Authenticate an obr_ token → { orgId, userId, tokenId } or null. */
export async function authBridgeToken(token: string): Promise<{ orgId: string; userId: string; tokenId: string } | null> {
  if (!token.startsWith('obr_') || token.length < 20 || token.length > 200) return null;
  const hash = createHash('sha256').update(token).digest('hex');
  const [row] = await db.select().from(bridgeTokens).where(and(eq(bridgeTokens.tokenHash, hash), isNull(bridgeTokens.revokedAt))).limit(1);
  if (!row) return null;
  await db.update(bridgeTokens).set({ lastSeenAt: new Date() }).where(eq(bridgeTokens.id, row.id)).catch(() => {});
  return { orgId: row.orgId, userId: row.userId, tokenId: row.id };
}

/** Wire up one authenticated socket. */
export function register(ws: WebSocket, auth: { orgId: string; userId: string; tokenId: string }): void {
  const conn: BridgeConn = { ...auth, host: 'unknown', since: new Date(), ws, sessions: new Map(), alive: true };
  const prev = conns.get(auth.orgId);
  if (prev) { try { prev.ws.close(4001, 'replaced by a newer bridge connection'); } catch { /* gone */ } failAll(prev, 'bridge reconnected elsewhere'); }
  conns.set(auth.orgId, conn);
  console.log('[bridge] connected org=%s', auth.orgId);

  ws.on('message', (raw) => { void handleFrame(conn, raw as Buffer).catch((e) => console.error('[bridge] frame error', e)); });
  ws.on('pong', () => { conn.alive = true; });
  ws.on('close', () => {
    if (conns.get(conn.orgId) === conn) conns.delete(conn.orgId);
    failAll(conn, 'bridge disconnected');
    console.log('[bridge] disconnected org=%s', conn.orgId);
  });
  ws.on('error', (e) => console.error('[bridge] ws error', conn.orgId, e.message));
}

function failAll(conn: BridgeConn, reason: string): void {
  for (const [sid, sink] of conn.sessions) { conn.sessions.delete(sid); sink.onEnd(reason); }
}

async function handleFrame(conn: BridgeConn, raw: Buffer): Promise<void> {
  if (raw.length > 5_000_000) return; // a single SDK message should never be this big
  let frame: BridgeToEngine;
  try { frame = bridgeFrame.parse(JSON.parse(raw.toString('utf8'))); } catch { return; }
  switch (frame.t) {
    case 'hello':
      conn.host = frame.host;
      conn.claude = frame.claude;
      break;
    case 'pong':
      conn.alive = true;
      break;
    case 'ev': {
      const sink = conn.sessions.get(frame.sid);
      sink?.onMessage(frame.message as SDKishMessage);
      break;
    }
    case 'end': {
      const sink = conn.sessions.get(frame.sid);
      if (sink) { conn.sessions.delete(frame.sid); sink.onEnd(frame.error); }
      break;
    }
    case 'tool': {
      const sink = conn.sessions.get(frame.sid);
      if (!sink) { send(conn, { t: 'toolResult', id: frame.id, error: 'unknown session' }); return; }
      try {
        const result = await executePersonaTool(sink.ctx, frame.name, frame.args);
        send(conn, { t: 'toolResult', id: frame.id, result });
      } catch (e) {
        send(conn, { t: 'toolResult', id: frame.id, error: e instanceof Error ? e.message : String(e) });
      }
      break;
    }
    case 'jobResult': {
      const p = pendingJobs.get(frame.id);
      if (p) { pendingJobs.delete(frame.id); clearTimeout(p.timer); p.resolve({ ok: frame.ok, output: frame.output, text: frame.text, error: frame.error, usage: frame.usage }); }
      break;
    }
    case 'ingest': {
      // A finished coding session from the watcher: learn it into this user's own persona.
      try {
        const { clones } = await import('@opersona/db');
        const { isNull: isNull2 } = await import('drizzle-orm');
        const [clone] = await db.select({ id: clones.id }).from(clones)
          .where(and(eq(clones.orgId, conn.orgId), eq(clones.ownerUserId, conn.userId), eq(clones.kind, 'member'), isNull2(clones.archivedAt))).limit(1);
        if (!clone) { send(conn, { t: 'ingestResult', id: frame.id, status: 'failed', note: 'no persona yet — finish onboarding first' }); return; }
        const { ingestClaudeCodeSession } = await import('../learning/claudeCode.js');
        const r = await ingestClaudeCodeSession({ orgId: conn.orgId, cloneId: clone.id, jsonl: frame.jsonl, source: 'bridge', sessionIdHint: frame.sessionId, project: frame.project });
        send(conn, { t: 'ingestResult', id: frame.id, status: r.status, observations: r.observations, note: r.note });
      } catch (e) {
        send(conn, { t: 'ingestResult', id: frame.id, status: 'failed', note: e instanceof Error ? e.message : String(e) });
      }
      break;
    }
    case 'approval': {
      const sink = conn.sessions.get(frame.sid);
      if (!sink) { send(conn, { t: 'approvalResult', id: frame.id, behavior: 'deny', message: 'unknown session' }); return; }
      try {
        const r = await requestApproval({ orgId: sink.ctx.orgId, cloneId: sink.ctx.cloneId, conversationId: sink.ctx.conversationId, kind: 'tool', tool: frame.tool, input: frame.input });
        send(conn, r.behavior === 'allow'
          ? { t: 'approvalResult', id: frame.id, behavior: 'allow', updatedInput: r.updatedInput ?? frame.input }
          : { t: 'approvalResult', id: frame.id, behavior: 'deny', message: r.message ?? 'denied by owner' });
      } catch (e) {
        send(conn, { t: 'approvalResult', id: frame.id, behavior: 'deny', message: e instanceof Error ? e.message : String(e) });
      }
      break;
    }
  }
}

/** Open a session on the bridge: returns the SDKMessage stream + input push. */
export function openBridgeSession(conn: BridgeConn, params: {
  ctx: ToolContext;
  conversationId: string;
  systemPrompt: string;
  model: string;
  effort?: string;
  resume?: string;
  tools: string[];
  builtinTools: string[];
  maxTurns: number;
}): { sid: string; messages: AsyncIterable<SDKishMessage>; push: (m: unknown) => void; interrupt: () => void } {
  const sid = randomUUID();
  const queue: SDKishMessage[] = [];
  const waiters: ((r: IteratorResult<SDKishMessage>) => void)[] = [];
  let ended = false; let endError: string | undefined;

  const sink: BridgeSessionSink = {
    ctx: params.ctx,
    onMessage: (m) => { const w = waiters.shift(); if (w) w({ value: m, done: false }); else queue.push(m); },
    onEnd: (error) => {
      if (ended) return;
      ended = true; endError = error;
      for (const w of waiters.splice(0)) w({ value: undefined as never, done: true });
    },
  };
  conn.sessions.set(sid, sink);
  send(conn, {
    t: 'start', sid, conversationId: params.conversationId, systemPrompt: params.systemPrompt,
    model: params.model, effort: params.effort, resume: params.resume,
    tools: params.tools, builtinTools: params.builtinTools, maxTurns: params.maxTurns,
  });

  const messages: AsyncIterable<SDKishMessage> = {
    [Symbol.asyncIterator]() {
      return {
        next: (): Promise<IteratorResult<SDKishMessage>> => {
          if (queue.length) return Promise.resolve({ value: queue.shift()!, done: false });
          if (ended) {
            if (endError) { const err = endError; endError = undefined; return Promise.reject(new Error(err)); }
            return Promise.resolve({ value: undefined as never, done: true });
          }
          return new Promise((res) => waiters.push(res));
        },
      };
    },
  };
  return {
    sid,
    messages,
    push: (m) => send(conn, { t: 'msg', sid, message: m }),
    interrupt: () => { send(conn, { t: 'cancel', sid }); conn.sessions.delete(sid); sink.onEnd(); },
  };
}

/** Run one inference job on the user's bridge (their subscription). 10-minute ceiling. */
export function runBridgeJob(conn: BridgeConn, job: { kind: 'structured' | 'text'; model: string; effort?: string; system: string; user: string; schema?: Record<string, unknown>; image?: { base64: string; mime: string } }): Promise<BridgeJobResult> {
  const id = randomUUID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => { pendingJobs.delete(id); resolve({ ok: false, error: 'bridge job timed out' }); }, 10 * 60_000);
    pendingJobs.set(id, { resolve, timer });
    send(conn, { t: 'job', id, ...job });
  });
}

/** Heartbeat: ping every 30s; a socket that misses two beats is closed. */
setInterval(() => {
  for (const conn of conns.values()) {
    if (!conn.alive) { try { conn.ws.terminate(); } catch { /* gone */ } continue; }
    conn.alive = false;
    try { conn.ws.ping(); } catch { /* gone */ }
  }
}, 30_000).unref();
