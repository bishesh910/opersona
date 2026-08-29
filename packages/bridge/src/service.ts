/**
 * `opersona install` — run the bridge as an invisible background service:
 * launchd on macOS, a systemd user unit on Linux. No terminal window, starts
 * at login, restarts if it crashes. `opersona uninstall` removes it.
 *
 * Pairing is PART of install — one command is the whole setup:
 *
 *   npx opersona@latest install --token obr_… [--seal-key …] [--no-watch]
 *
 * Flags merge into ~/.opersona-bridge/config.json; if a config was already
 * saved by a foreground run, plain `install` reuses it. With no token from
 * either source we refuse: a tokenless service could only crash-loop.
 *
 * Why not just copy the bundle somewhere? The published bundle keeps `ws` and
 * the Claude Agent SDK external (the SDK spawns its own CLI out of its package
 * directory, so it cannot be inlined) — a lone copied file has no node_modules
 * and dies on its first import. Install therefore makes ~/.opersona-bridge/app
 * a tiny REAL npm installation pinned to this exact version and points the
 * service at it: every import resolves the normal way, independent of the
 * prunable npx cache.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const DIR = join(homedir(), '.opersona-bridge');
const APP_DIR = join(DIR, 'app');
const ENTRY = join(APP_DIR, 'node_modules', 'opersona', 'dist', 'index.js');
const LEGACY_SCRIPT = join(DIR, 'bridge.js'); // ≤0.4.0 copied the bundle here — it could never resolve ws
const CONFIG = join(DIR, 'config.json');
const PLIST = join(homedir(), 'Library', 'LaunchAgents', 'me.opersona.bridge.plist');
const UNIT_DIR = join(homedir(), '.config', 'systemd', 'user');
const UNIT = join(UNIT_DIR, 'opersona-bridge.service');
const LOG = join(DIR, 'bridge.log');

interface Cfg { url?: string; token?: string; sealKey?: string; watch?: boolean; workspaces?: unknown[] }
function readCfg(): Cfg { try { return JSON.parse(readFileSync(CONFIG, 'utf8')) as Cfg; } catch { return {}; } }
function writeCfg(c: Cfg): void { mkdirSync(DIR, { recursive: true }); writeFileSync(CONFIG, JSON.stringify(c, null, 2), { mode: 0o600 }); }
function argOf(name: string): string | undefined { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; }
function npmBin(): string { const beside = join(dirname(process.execPath), 'npm'); return existsSync(beside) ? beside : 'npm'; }

export async function install(version: string): Promise<void> {
  const os = platform();
  if (os !== 'darwin' && os !== 'linux') {
    console.log('Background install is not wired for this OS yet — run `npx opersona` in a terminal (or a scheduled task) for now.');
    process.exitCode = 1; return;
  }

  // 1 · pairing — flags merge into the saved config (never clobbering the rest of it).
  const cfg = readCfg();
  const token = argOf('token') ?? cfg.token;
  const sealKey = argOf('seal-key') ?? cfg.sealKey;
  const url = (argOf('url') ?? cfg.url ?? 'https://opersona.me').replace(/\/$/, '');
  if (!token?.startsWith('obr_')) {
    console.error('Not installing: this machine has no pairing token, and a tokenless service can only crash-loop.');
    console.error(`Grab yours at ${url} → Settings → Models → "Chat on your own subscription", then run the one command it shows:`);
    console.error('  npx opersona@latest install --token obr_…');
    process.exitCode = 1; return;
  }
  writeCfg({ ...cfg, url, token, ...(sealKey ? { sealKey } : {}), ...(process.argv.includes('--no-watch') ? { watch: false } : {}) });

  // 2 · a real installation for the service to run from.
  console.log(`fetching opersona ${version} into ~/.opersona-bridge/app … (one time; npm does the work)`);
  mkdirSync(APP_DIR, { recursive: true });
  writeFileSync(join(APP_DIR, 'package.json'), JSON.stringify({ name: 'opersona-bridge-host', private: true, dependencies: { opersona: version } }, null, 2) + '\n');
  try {
    execFileSync(npmBin(), ['install', '--omit=dev', '--no-fund', '--no-audit', '--loglevel=error'], { cwd: APP_DIR, stdio: 'inherit' });
  } catch {
    console.error('npm install failed — NO service was written (nothing to crash-loop). Fix the error above (network?) and rerun.');
    process.exitCode = 1; return;
  }
  if (!existsSync(ENTRY)) {
    console.error('npm finished but the expected entry is missing — aborting before writing a broken service.');
    process.exitCode = 1; return;
  }
  if (existsSync(LEGACY_SCRIPT)) rmSync(LEGACY_SCRIPT);
  writeFileSync(LOG, ''); // fresh log, so the verdict below reads THIS start, not old crash spam

  // 3 · the service itself. Config comes from config.json — no args to go stale.
  const node = process.execPath;
  if (os === 'darwin') {
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>me.opersona.bridge</string>
  <key>ProgramArguments</key><array><string>${node}</string><string>${ENTRY}</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>${LOG}</string>
  <key>StandardErrorPath</key><string>${LOG}</string>
</dict></plist>
`;
    mkdirSync(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true });
    writeFileSync(PLIST, plist);
    try { execFileSync('launchctl', ['unload', PLIST], { stdio: 'ignore' }); } catch { /* not loaded */ }
    execFileSync('launchctl', ['load', PLIST]);
  } else {
    const unit = `[Unit]
Description=opersona bridge — your persona, on your own Claude subscription
After=network-online.target

[Service]
ExecStart=${node} ${ENTRY}
Restart=always
RestartSec=5
StandardOutput=append:${LOG}
StandardError=append:${LOG}

[Install]
WantedBy=default.target
`;
    mkdirSync(UNIT_DIR, { recursive: true });
    writeFileSync(UNIT, unit);
    try {
      execFileSync('systemctl', ['--user', 'daemon-reload']);
      execFileSync('systemctl', ['--user', 'enable', '--now', 'opersona-bridge.service']);
    } catch (e) {
      console.log(`Unit written to ${UNIT}, but systemd --user is not reachable here (${e instanceof Error ? e.message.split('\n')[0] : e}).`);
      console.log('Enable it from a normal desktop/SSH session:  systemctl --user enable --now opersona-bridge.service');
      return;
    }
  }

  // 4 · honest verdict — say what actually happened, not what should have.
  await new Promise((r) => setTimeout(r, 4000));
  let tail = ''; try { tail = readFileSync(LOG, 'utf8'); } catch { /* no log yet */ }
  if (/\[bridge\] connected/.test(tail)) {
    console.log('✓ installed AND connected — chats on this account now run on this machine: terminal-free, at every login, restarts itself.');
  } else if (/token rejected/.test(tail)) {
    console.log('✗ the service runs, but the token was rejected — mint a fresh one in Settings and rerun install with --token obr_…');
    process.exitCode = 1;
  } else if (/Error/.test(tail)) {
    console.log(`✗ the service crashed on start — read ${LOG}`);
    process.exitCode = 1;
  } else {
    console.log(`service started — it should show as ● online in Settings within seconds. Log: ${LOG}`);
  }
  console.log('  remove any time:  npx opersona uninstall');
}

export function uninstall(): void {
  if (platform() === 'darwin') {
    try { execFileSync('launchctl', ['unload', PLIST], { stdio: 'ignore' }); } catch { /* not loaded */ }
    if (existsSync(PLIST)) rmSync(PLIST);
  } else if (platform() === 'linux') {
    try { execFileSync('systemctl', ['--user', 'disable', '--now', 'opersona-bridge.service'], { stdio: 'ignore' }); } catch { /* fine */ }
    if (existsSync(UNIT)) rmSync(UNIT);
    try { execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore' }); } catch { /* fine */ }
  } else {
    console.log('Nothing installed on this OS.');
    return;
  }
  for (const p of [APP_DIR, LEGACY_SCRIPT]) if (existsSync(p)) rmSync(p, { recursive: true, force: true });
  console.log('✓ background service removed. (Your pairing and config are kept; `npx opersona` still works manually.)');
}
