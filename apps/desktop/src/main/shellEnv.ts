/**
 * Resolve the user's real PATH and the `claude` binary. A Dock/Finder-launched
 * macOS app inherits almost no environment, so we capture PATH from an
 * interactive login shell — fenced, to defeat rc-file chatter poisoning it.
 * (Reference: munder-difflin shellEnv.ts — the fence + login-shell trick.)
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const FENCE = '__OPERSONA_PATH_FENCE__';
let cachedPath: string | null = null;

/** Capture PATH from `$SHELL -ilc`, sliced between two fence markers so shell
 *  startup noise ("Restored session: …") can't become the child's PATH. */
export function userShellPath(): string {
  if (cachedPath) return cachedPath;
  const shell = process.env.SHELL || '/bin/zsh';
  try {
    const out = execFileSync(shell, ['-ilc', `printf %s ${FENCE}; printf %s "$PATH"; printf %s ${FENCE}`], {
      encoding: 'utf8', timeout: 5000,
    });
    const a = out.indexOf(FENCE);
    const b = out.indexOf(FENCE, a + FENCE.length);
    if (a >= 0 && b > a) {
      const p = out.slice(a + FENCE.length, b).trim();
      // reject multi-line (means noise leaked past the fence)
      if (p && !p.includes('\n')) { cachedPath = p; return p; }
    }
  } catch { /* fall through to a sane default */ }
  cachedPath = process.env.PATH || '/usr/local/bin:/usr/bin:/bin';
  return cachedPath;
}

/** Find an executable by name using the captured login-shell PATH, then a set
 *  of known install locations. Positive results are only trusted while the file
 *  still exists; misses are never cached (a just-installed CLI must be seen). */
export function resolveCommand(cmd: string, pathEnv: string): string {
  if (cmd.includes('/')) return cmd; // already a path
  // `which` inside the login shell
  try {
    const shell = process.env.SHELL || '/bin/zsh';
    const out = execFileSync(shell, ['-ilc', `command -v ${cmd}`], { encoding: 'utf8', timeout: 5000, env: { ...process.env, PATH: pathEnv } }).trim();
    if (out && existsSync(out)) return out;
  } catch { /* keep looking */ }
  const home = homedir();
  const candidates = [
    '/opt/homebrew/bin', '/usr/local/bin', join(home, '.local/bin'),
    join(home, '.claude/local'), join(home, '.volta/bin'), join(home, '.bun/bin'),
  ].map((d) => join(d, cmd));
  for (const c of candidates) if (existsSync(c)) return c;
  return cmd; // last resort — will ENOENT, surfaced to the user
}
