/**
 * opersona bridge — run your opersona chats on your own machine, on the Claude
 * subscription you already have.
 *
 *   opersona-bridge --url https://opersona.me --token obr_…
 *
 * One outbound WebSocket; nothing listens on this machine. Your Anthropic
 * login never leaves it — the cloud only ever sees chat traffic. The cloud can
 * NOT run code here: sessions get read-only tools jailed to
 * ~/.opersona-bridge/work, and anything else requires your explicit approval
 * in the opersona web UI.
 */
import { hostname, homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import WebSocket from 'ws';
import { BRIDGE_PROTOCOL_VERSION, type EngineToBridge, type BridgeStart, type BridgeJob } from '@opersona/shared';
import { BridgeSession } from './session.js';
import { runJob } from './jobs.js';
import { startWatcher } from './watcher.js';
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

const VERSION = '0.1.1';

// Subcommands: `opersona install` / `opersona uninstall` (background service).
const sub = process.argv[2];
if (sub === 'install' || sub === 'uninstall') {
  const { install, uninstall } = await import('./service.js');
  (sub === 'install' ? install : uninstall)();
  process.exit(process.exitCode ?? 0);
}
if (sub === 'version' || sub === '--version' || sub === '-v') { console.log(VERSION); process.exit(0); }
const CONFIG_DIR = join(homedir(), '.opersona-bridge');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

interface Config { url?: string; token?: string }
function loadConfig(): Config {
  try { return JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as Config; } catch { return {}; }
}
function saveConfig(cfg: Config): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

const saved = loadConfig();
const URL_ = (arg('url') ?? process.env.OPERSONA_URL ?? saved.url ?? 'https://opersona.me').replace(/\/$/, '');
let TOKEN = arg('token') ?? process.env.OPERSONA_BRIDGE_TOKEN ?? saved.token ?? '';

// First run: ask once, remember forever (~/.opersona-bridge/config.json, 0600).
if (!TOKEN.startsWith('obr_')) {
  if (!process.stdin.isTTY) {
    console.error('opersona: no bridge token. Pair this machine at ' + URL_ + ' → Settings → Models → "Chat on your own subscription", then run:\n  npx opersona --token obr_…');
    process.exit(1);
  }
  console.log('Welcome to opersona — this machine is about to become your persona\'s brain.');
  console.log('');
  console.log('  1. Open  ' + URL_ + '  → Settings → Models');
  console.log('  2. Under "Chat on your own subscription", press  Pair a machine');
  console.log('  3. Paste the token here');
  console.log('');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question('bridge token (obr_…): ')).trim();
  rl.close();
  if (!answer.startsWith('obr_')) { console.error('That does not look like a bridge token — it starts with obr_. Nothing saved.'); process.exit(1); }
  TOKEN = answer;
}
if (TOKEN !== saved.token || URL_ !== saved.url) saveConfig({ url: URL_, token: TOKEN });

if (!existsSync(join(homedir(), '.claude'))) {
  console.warn('[note] Claude Code does not look signed in on this machine (~/.claude missing).');
  console.warn('       Install it and run `claude` once to log in — the bridge thinks with YOUR Claude.');
}

const WS_URL = URL_.replace(/^http/, 'ws') + '/bridge/ws';
const WATCH = !process.argv.includes('--no-watch');
const CLAUDE_DIR = arg('claude-dir');   // test override for ~/.claude/projects
const CODEX_DIR = arg('codex-dir');

const sessions = new Map<string, BridgeSession>();
interface Pending { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
const pending = new Map<string, Pending>();

let ws: WebSocket | null = null;
let backoffMs = 1000;
let closingForGood = false;
let watcher: { stop: () => void; tick: () => void } | null = null;

function sendFrame(frame: unknown): void {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
}

function rpc(frame: { t: 'tool' | 'approval'; sid: string; id: string } & Record<string, unknown>, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(frame.id); reject(new Error(`${frame.t} rpc timed out`)); }, timeoutMs);
    pending.set(frame.id, { resolve, reject, timer });
    sendFrame(frame);
  });
}

function startSession(startFrame: BridgeStart): void {
  const sid = startFrame.sid;
  const session = new BridgeSession(startFrame, {
    sendEv: (m) => sendFrame({ t: 'ev', sid, message: m }),
    sendEnd: (error) => { sessions.delete(sid); sendFrame({ t: 'end', sid, ...(error ? { error } : {}) }); },
    rpcTool: (name, args) => rpc({ t: 'tool', sid, id: randomUUID(), name, args }, 120_000),
    rpcApproval: async (toolName, input) => {
      const r = await rpc({ t: 'approval', sid, id: randomUUID(), tool: toolName, input }, 12 * 60_000);
      return r as { behavior: 'allow' | 'deny'; message?: string; updatedInput?: unknown };
    },
  });
  sessions.set(sid, session);
  console.log(`[bridge] session ${sid.slice(0, 8)} started (${startFrame.model})`);
  void session.run().finally(() => console.log(`[bridge] session ${sid.slice(0, 8)} ended`));
}

function runJobFrame(job: BridgeJob): void {
  void runJob(job).then((r) => sendFrame({ t: 'jobResult', id: job.id, ok: r.ok, output: r.output, text: r.text, error: r.error, usage: r.usage }));
}

function onFrame(frame: EngineToBridge): void {
  switch (frame.t) {
    case 'start': startSession(frame); break;
    case 'job': runJobFrame(frame); break;
    case 'ingestResult':
      if (frame.status === 'done') console.log(`[watch] learned from session ${frame.id.slice(0, 8)}… (${frame.observations ?? 0} observations)`);
      else if (frame.status !== 'skipped') console.log(`[watch] session ${frame.id.slice(0, 8)}…: ${frame.status}${frame.note ? ` — ${frame.note}` : ''}`);
      break;
    case 'msg': sessions.get(frame.sid)?.push(frame.message as SDKUserMessage); break;
    case 'cancel': { const s = sessions.get(frame.sid); sessions.delete(frame.sid); s?.cancel(); break; }
    case 'toolResult': {
      const p = pending.get(frame.id);
      if (p) { pending.delete(frame.id); clearTimeout(p.timer); frame.error ? p.reject(new Error(frame.error)) : p.resolve(frame.result); }
      break;
    }
    case 'approvalResult': {
      const p = pending.get(frame.id);
      if (p) { pending.delete(frame.id); clearTimeout(p.timer); p.resolve({ behavior: frame.behavior, message: frame.message, updatedInput: frame.updatedInput }); }
      break;
    }
    case 'ping': sendFrame({ t: 'pong' }); break;
  }
}

function connect(): void {
  console.log(`[bridge] connecting to ${WS_URL} …`);
  const sock = new WebSocket(WS_URL, { headers: { Authorization: `Bearer ${TOKEN}` } });
  ws = sock;
  sock.on('open', () => {
    backoffMs = 1000;
    sendFrame({ t: 'hello', version: BRIDGE_PROTOCOL_VERSION, bridgeVersion: VERSION, host: hostname(), caps: { chat: true, jobs: true, watch: WATCH } });
    console.log('[bridge] connected — chats on this account now run on THIS machine (your Claude subscription).');
    if (WATCH && !watcher) {
      watcher = startWatcher({ sendIngest: (f) => { if (ws?.readyState === WebSocket.OPEN) { ws.send(JSON.stringify(f)); return true; } return false; } }, { claudeDir: CLAUDE_DIR, codexDir: CODEX_DIR });
      console.log('[watch] learning from this machine\'s Claude Code / Codex sessions (disable with --no-watch).');
    }
  });
  sock.on('message', (raw) => {
    try { onFrame(JSON.parse(String(raw)) as EngineToBridge); } catch (e) { console.error('[bridge] bad frame', e); }
  });
  sock.on('close', (code, reason) => {
    for (const s of sessions.values()) s.cancel();
    sessions.clear();
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('connection lost')); }
    pending.clear();
    if (closingForGood) return;
    if (code === 4001) console.log('[bridge] replaced by a newer bridge for this account — exiting.'), process.exit(0);
    console.log(`[bridge] disconnected (${code}${reason?.length ? ` ${reason}` : ''}) — retrying in ${Math.round(backoffMs / 1000)}s`);
    setTimeout(connect, backoffMs);
    backoffMs = Math.min(backoffMs * 2, 30_000);
  });
  sock.on('error', (e) => {
    if (/401/.test(e.message)) { console.error('[bridge] token rejected — mint a fresh one in Settings.'); closingForGood = true; process.exit(1); }
    console.error('[bridge]', e.message);
  });
}

process.on('SIGINT', () => { closingForGood = true; ws?.close(); process.exit(0); });
process.on('SIGTERM', () => { closingForGood = true; ws?.close(); process.exit(0); });
connect();
