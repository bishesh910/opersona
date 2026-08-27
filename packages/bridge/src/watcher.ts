/**
 * Session watcher — the "no procedure" learning rail. Watches this machine's
 * Claude Code (and Codex CLI) session transcripts; every session that has gone
 * quiet is streamed to opersona and mined for how you think. The server
 * de-duplicates by session id and re-learns only files that have grown, so
 * restarts and re-scans are free. First run = your whole history backfills.
 *
 * Never watched: opersona's own bridge sessions (that's the persona talking,
 * not you) and anything you exclude with --no-watch.
 */
import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const IDLE_MS = 10 * 60_000;          // a session is "finished" after 10 quiet minutes
const SCAN_EVERY_MS = 5 * 60_000;
const MAX_BYTES = 30_000_000;
const STATE_PATH = join(homedir(), '.opersona-bridge', 'watcher-state.json');
const OWN_SESSIONS_PATH = join(homedir(), '.opersona-bridge', 'own-sessions.json');

/** Session ids spawned BY the bridge's own chat sessions (incl. power sessions that
 *  run in the user's real repo dir, so directory-name exclusion can't catch them).
 *  Uploading these would leak sealed chat transcripts as plaintext ingest. */
function ownSessionIds(): Set<string> {
  try {
    const raw = JSON.parse(readFileSync(OWN_SESSIONS_PATH, 'utf8')) as Record<string, number>;
    return new Set(Object.keys(raw));
  } catch { return new Set(); }
}

/** Sessions produced by the bridge itself, or by opersona's server — never the human. */
const SELF_RE = /-opersona-bridge-|clones-[0-9a-f-]{36}-workspace|opersona-apps-engine-data/;

interface Sent { bytes: number }
interface StateFile { ident: string; sent: Record<string, Sent> }

/** The sent-ledger is scoped to the pairing identity: a new account/token means a
 *  fresh ledger, so re-pairing always re-backfills (the server dedupes anyway). */
function loadState(ident: string): Record<string, Sent> {
  try {
    const raw = JSON.parse(readFileSync(STATE_PATH, 'utf8')) as StateFile | Record<string, Sent>;
    if (raw && typeof raw === 'object' && 'ident' in raw && 'sent' in raw) {
      return (raw as StateFile).ident === ident ? (raw as StateFile).sent : {};
    }
    return {}; // legacy un-scoped ledger: discard, let the server dedupe
  } catch { return {}; }
}
function saveState(ident: string, sent: Record<string, Sent>): void {
  try { mkdirSync(join(homedir(), '.opersona-bridge'), { recursive: true }); writeFileSync(STATE_PATH, JSON.stringify({ ident, sent } satisfies StateFile)); } catch { /* best effort */ }
}

interface Candidate { path: string; sessionId: string; project?: string; bytes: number }
export interface ScanStats { projects: number; files: number; recent: number; small: number; big: number; self: number; eligible: number; dirMissing: boolean }

function scanClaudeCode(root: string, stats: ScanStats): Candidate[] {
  const out: Candidate[] = [];
  let projects: string[] = [];
  try { projects = readdirSync(root); } catch { stats.dirMissing = true; return out; }
  stats.projects += projects.length;
  for (const p of projects) {
    if (SELF_RE.test(p)) { stats.self++; continue; }
    let entries: string[] = [];
    try { entries = readdirSync(join(root, p)); } catch { continue; }
    for (const f of entries) {
      if (!f.endsWith('.jsonl')) continue;
      stats.files++;
      const full = join(root, p, f);
      let st; try { st = statSync(full); } catch { continue; }
      if (Date.now() - st.mtimeMs < IDLE_MS) { stats.recent++; continue; }  // still in use
      if (st.size < 2000) { stats.small++; continue; }
      if (st.size > MAX_BYTES) { stats.big++; continue; }
      stats.eligible++;
      out.push({ path: full, sessionId: f.replace(/\.jsonl$/, ''), project: p.replace(/^-/, '/').replace(/-/g, '/'), bytes: st.size });
    }
  }
  return out;
}

function scanCodex(root: string, stats: ScanStats): Candidate[] {
  const out: Candidate[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 4) return;
    let entries: string[] = [];
    try { entries = readdirSync(dir); } catch { return; }
    for (const e of entries) {
      const full = join(dir, e);
      let st; try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) { walk(full, depth + 1); continue; }
      if (!e.endsWith('.jsonl')) continue;
      stats.files++;
      if (Date.now() - st.mtimeMs < IDLE_MS) { stats.recent++; continue; }
      if (st.size < 2000) { stats.small++; continue; }
      if (st.size > MAX_BYTES) { stats.big++; continue; }
      stats.eligible++;
      out.push({ path: full, sessionId: e.replace(/\.jsonl$/, ''), bytes: st.size });
    }
  };
  walk(root, 0);
  return out;
}

export interface WatcherIO { sendIngest: (frame: { t: 'ingest'; id: string; sessionId: string; project?: string; source: 'bridge'; jsonl: string }) => boolean }

export function startWatcher(io: WatcherIO, opts: { claudeDir?: string; codexDir?: string; ident?: string } = {}): { stop: () => void; tick: () => void } {
  const claudeRoot = opts.claudeDir ?? join(homedir(), '.claude', 'projects');
  const codexRoot = opts.codexDir ?? join(homedir(), '.codex', 'sessions');
  const ident = opts.ident ?? 'default';
  const state = loadState(ident);
  let hadWork = false;   // for the "backfill complete" line
  let totalSent = 0;

  let firstTick = true;
  const tick = (): void => {
    const stats: ScanStats = { projects: 0, files: 0, recent: 0, small: 0, big: 0, self: 0, eligible: 0, dirMissing: false };
    const own = ownSessionIds();
    const candidates = [...scanClaudeCode(claudeRoot, stats), ...(existsSync(codexRoot) ? scanCodex(codexRoot, stats) : [])]
      .filter((c) => { if (own.has(c.sessionId)) { stats.self++; return false; } return true; })   // never upload our own chat transcripts
      // a session is re-sent only when it has grown noticeably since last send
      .filter((c) => { const seen = state[c.sessionId]; return !seen || (c.bytes > seen.bytes * 1.15 && c.bytes - seen.bytes > 100_000); })
      .sort((a, b) => b.bytes - a.bytes);
    let sentNow = 0;
    for (const c of candidates) {
      if (sentNow >= 3) break;                       // gentle: a first backfill trickles, not floods
      let jsonl: string;
      try { jsonl = readFileSync(c.path, 'utf8'); } catch { continue; }
      const sent = io.sendIngest({ t: 'ingest', id: randomUUID(), sessionId: c.sessionId, project: c.project, source: 'bridge', jsonl });
      if (!sent) break;                              // disconnected — try again next tick
      sentNow++;
      state[c.sessionId] = { bytes: c.bytes };
    }
    saveState(ident, state);
    if (firstTick || (stats.eligible === 0 && candidates.length === 0)) {
      console.log(`[watch] scan: ${claudeRoot}${stats.dirMissing ? ' (MISSING)' : ''} — ${stats.projects} project dirs, ${stats.files} session files: ${stats.eligible} eligible, ${stats.recent} still-active, ${stats.small} tiny, ${stats.big} oversized, ${stats.self} opersona-own; ${candidates.length} new to send`);
      firstTick = false;
    }
    if (sentNow > 0) {
      hadWork = true; totalSent += sentNow;
      const remaining = candidates.length - sentNow;
      console.log(`[watch] sent ${sentNow} session(s) to learn from${remaining > 0 ? ` — ${remaining} more queued (next batch in 5 min)` : ''}`);
    } else if (hadWork) {
      hadWork = false;
      console.log(`[watch] backfill complete — ${totalSent} session(s) learned from this machine. New sessions are picked up automatically.`);
    }
  };

  const timer = setInterval(tick, SCAN_EVERY_MS);
  setTimeout(tick, 20_000); // first pass shortly after connect
  return { stop: () => clearInterval(timer), tick };
}
