/**
 * Bridge hub — the engine side of the opersona bridge. One authenticated
 * outbound WebSocket per user machine. Since all TALKING moved to the
 * claude.ai connector, the bridge carries exactly two things: inference JOBS
 * (structured/text calls on the user's subscription — extraction, drafting,
 * simulation) and watcher INGEST (finished Claude Code / Codex sessions to
 * learn from). Registry is keyed by orgId (workspace = person); a second
 * connection for the same workspace replaces the first. Chat frames from
 * older bridges are parsed and ignored.
 */
import { randomUUID, createHash } from 'node:crypto';
import type { WebSocket } from 'ws';
import { eq, and, isNull } from 'drizzle-orm';
import { db, bridgeTokens } from '@opersona/db';
import { bridgeFrame, type BridgeToEngine, type EngineToBridge } from './types.js';

export interface BridgeJobResult { ok: boolean; output?: unknown; text?: string; error?: string; usage?: { input: number; output: number; cacheRead?: number } }
interface PendingJob { resolve: (r: BridgeJobResult) => void; timer: NodeJS.Timeout }
const pendingJobs = new Map<string, PendingJob>();

export interface BridgeWorkspace { path: string; label: string; bash: 'ask' }
export interface BridgeConn {
  orgId: string;
  userId: string;
  tokenId: string;
  host: string;
  claude?: string;
  since: Date;
  ws: WebSocket;
  alive: boolean;
  /** true when the bridge advertised caps.workspaces (>=0.3.0) — gates power. */
  supportsPower: boolean;
  /** true when the bridge advertised caps.jobSessions (>=0.4.0) — warm job reuse. */
  supportsJobSessions: boolean;
  /** folders the user granted locally, advertised in hello. */
  workspaces: BridgeWorkspace[];
}

const conns = new Map<string, BridgeConn>();

export const bridgeFor = (orgId: string): BridgeConn | undefined => conns.get(orgId);
export const bridgeStatus = (orgId: string): { connected: boolean; host?: string; claude?: string; since?: string; workspaces?: BridgeWorkspace[]; supportsPower?: boolean } => {
  const c = conns.get(orgId);
  return c ? { connected: true, host: c.host, claude: c.claude, since: c.since.toISOString(), workspaces: c.workspaces, supportsPower: c.supportsPower } : { connected: false };
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
  const conn: BridgeConn = { ...auth, host: 'unknown', since: new Date(), ws, alive: true, supportsPower: false, supportsJobSessions: false, workspaces: [] };
  const prev = conns.get(auth.orgId);
  if (prev) { try { prev.ws.close(4001, 'replaced by a newer bridge connection'); } catch { /* gone */ } }
  conns.set(auth.orgId, conn);
  console.log('[bridge] connected org=%s', auth.orgId);

  ws.on('message', (raw) => { void handleFrame(conn, raw as Buffer).catch((e) => console.error('[bridge] frame error', e)); });
  ws.on('pong', () => { conn.alive = true; });
  ws.on('close', () => {
    if (conns.get(conn.orgId) === conn) conns.delete(conn.orgId);
    console.log('[bridge] disconnected org=%s', conn.orgId);
  });
  ws.on('error', (e) => console.error('[bridge] ws error', conn.orgId, e.message));
}

async function handleFrame(conn: BridgeConn, raw: Buffer): Promise<void> {
  if (raw.length > 5_000_000) return; // a single SDK message should never be this big
  let frame: BridgeToEngine;
  try { frame = bridgeFrame.parse(JSON.parse(raw.toString('utf8'))); } catch { return; }
  switch (frame.t) {
    case 'hello':
      conn.host = frame.host;
      conn.claude = frame.claude;
      conn.supportsPower = frame.caps.workspaces === true;
      conn.supportsJobSessions = (frame.caps as Record<string, unknown>).jobSessions === true;
      conn.workspaces = (frame.workspaces ?? []).map((w) => ({ path: w.path, label: w.label, bash: 'ask' as const }));
      console.log('[bridge] hello org=%s host=%s bridge=v%s caps=%j workspaces=%d', conn.orgId, frame.host, frame.bridgeVersion, frame.caps, conn.workspaces.length);
      break;
    case 'pong':
      conn.alive = true;
      break;
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
  }
}

/** Run one inference job on the user's bridge (their subscription). 10-minute ceiling. */
export function runBridgeJob(conn: BridgeConn, job: { kind: 'structured' | 'text'; model: string; effort?: string; system: string; user: string; schema?: Record<string, unknown>; image?: { base64: string; mime: string }; sealed?: string[]; sessionKey?: string }): Promise<BridgeJobResult> {
  const id = randomUUID();
  // Warm-session reuse is a >=0.4.0 bridge capability — older bridges never see the key.
  if (!conn.supportsJobSessions) delete job.sessionKey;
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
