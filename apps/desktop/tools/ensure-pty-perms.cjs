/**
 * node-pty ships a `spawn-helper` binary that MUST stay executable, or every
 * pty.spawn dies with "posix_spawnp failed". npm/electron-rebuild sometimes
 * resets it to 0644. Restore +x. (Reference: munder-difflin tools/ensure-pty-perms.)
 */
const { chmodSync, existsSync } = require('node:fs');
const { join } = require('node:path');

const candidates = [
  join(__dirname, '..', 'node_modules', 'node-pty', 'build', 'Release', 'spawn-helper'),
  join(__dirname, '..', '..', '..', 'node_modules', 'node-pty', 'build', 'Release', 'spawn-helper'),
];
for (const p of candidates) {
  if (existsSync(p)) {
    try { chmodSync(p, 0o755); console.log('[ensure-pty-perms] +x', p); } catch (e) { console.warn('[ensure-pty-perms] could not chmod', p, e.message); }
  }
}
