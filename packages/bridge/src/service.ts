/**
 * `opersona install` — run the bridge as an invisible background service:
 * launchd on macOS, a systemd user unit on Linux. No terminal window, starts
 * at login, restarts if it crashes. `opersona uninstall` removes it.
 *
 * The npx cache is prunable, so install first copies the bundled script to
 * ~/.opersona-bridge/bridge.js and points the service at that + this node.
 */
import { copyFileSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DIR = join(homedir(), '.opersona-bridge');
const SCRIPT = join(DIR, 'bridge.js');
const PLIST = join(homedir(), 'Library', 'LaunchAgents', 'me.opersona.bridge.plist');
const UNIT_DIR = join(homedir(), '.config', 'systemd', 'user');
const UNIT = join(UNIT_DIR, 'opersona-bridge.service');
const LOG = join(DIR, 'bridge.log');

function selfPath(): string {
  return fileURLToPath(import.meta.url); // the bundled single file
}

export function install(): void {
  mkdirSync(DIR, { recursive: true });
  copyFileSync(selfPath(), SCRIPT);
  const node = process.execPath;
  if (platform() === 'darwin') {
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>me.opersona.bridge</string>
  <key>ProgramArguments</key><array><string>${node}</string><string>${SCRIPT}</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${LOG}</string>
  <key>StandardErrorPath</key><string>${LOG}</string>
</dict></plist>
`;
    mkdirSync(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true });
    writeFileSync(PLIST, plist);
    try { execFileSync('launchctl', ['unload', PLIST], { stdio: 'ignore' }); } catch { /* not loaded */ }
    execFileSync('launchctl', ['load', PLIST]);
    console.log('✓ installed as a background service (launchd). It runs now, at every login, and restarts itself.');
    console.log(`  log: ${LOG}`);
    console.log('  remove any time:  npx opersona uninstall');
  } else if (platform() === 'linux') {
    const unit = `[Unit]
Description=opersona bridge — your persona, on your own Claude subscription
After=network-online.target

[Service]
ExecStart=${node} ${SCRIPT}
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
      console.log('✓ installed as a systemd user service. It runs now, at every login, and restarts itself.');
      console.log(`  log: ${LOG}`);
      console.log('  tip: `loginctl enable-linger` keeps it running when you are logged out.');
      console.log('  remove any time:  npx opersona uninstall');
    } catch (e) {
      console.log(`Unit written to ${UNIT}, but systemd --user is not reachable here (${e instanceof Error ? e.message.split('\n')[0] : e}).`);
      console.log('Enable it from a normal desktop/SSH session:  systemctl --user enable --now opersona-bridge.service');
    }
  } else {
    console.log('Background install is not wired for this OS yet — run `npx opersona` in a terminal (or a scheduled task) for now.');
    process.exitCode = 1;
  }
}

export function uninstall(): void {
  if (platform() === 'darwin') {
    try { execFileSync('launchctl', ['unload', PLIST], { stdio: 'ignore' }); } catch { /* not loaded */ }
    if (existsSync(PLIST)) rmSync(PLIST);
    console.log('✓ background service removed. (Your pairing and config are kept; `npx opersona` still works manually.)');
  } else if (platform() === 'linux') {
    try { execFileSync('systemctl', ['--user', 'disable', '--now', 'opersona-bridge.service'], { stdio: 'ignore' }); } catch { /* fine */ }
    if (existsSync(UNIT)) rmSync(UNIT);
    try { execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore' }); } catch { /* fine */ }
    console.log('✓ background service removed. (Your pairing and config are kept; `npx opersona` still works manually.)');
  } else {
    console.log('Nothing installed on this OS.');
  }
}
