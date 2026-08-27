/**
 * Local workspace grants + the path jail. THIS is the machine-side authority the
 * cloud can never override. Every rule here fails CLOSED: unknown tool → deny,
 * unresolvable path → deny, symlink escaping the subtree → deny, sensitive sink
 * → deny even inside a grant.
 */
import { existsSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, isAbsolute, sep, basename, join } from 'node:path';

export interface Workspace { path: string; label: string; bash: 'ask' }

/** Folders we refuse to grant outright — granting these is granting the machine. */
export function grantRefusal(dir: string): string | null {
  let abs: string;
  try { abs = realpathSync(resolve(dir)); } catch { return `no such folder: ${dir}`; }
  const home = safeReal(homedir());
  if (abs === home) return 'refusing to grant your entire home folder — pick a specific project directory';
  if (abs === sep || abs === '/') return 'refusing to grant the filesystem root';
  // very shallow system roots
  if (['/etc', '/usr', '/bin', '/var', '/System', '/Library', '/Applications'].includes(abs)) return `refusing to grant a system directory (${abs})`;
  if (abs === safeReal(join(home, '.opersona-bridge'))) return 'refusing to grant the bridge’s own folder';
  try { if (!statSync(abs).isDirectory()) return 'not a folder'; } catch { return 'not a folder'; }
  return null;
}

function safeReal(p: string): string { try { return realpathSync(p); } catch { return resolve(p); } }

/** Basenames/relative fragments that are hard-denied for read AND write even when
 *  lexically inside a granted folder (secrets, persistence, self-modification). */
const SENSITIVE_BASENAMES = new Set([
  '.ssh', '.aws', '.gnupg', '.gpg', '.netrc', '.npmrc', '.pypirc', '.docker',
  '.bashrc', '.bash_profile', '.zshrc', '.zprofile', '.profile', '.bash_login',
  '.git-credentials', '.opersona-bridge',
]);
const SENSITIVE_FRAGMENTS = [
  `${sep}.ssh${sep}`, `${sep}.aws${sep}`, `${sep}.gnupg${sep}`,
  `${sep}.git${sep}hooks${sep}`, `${sep}.config${sep}systemd${sep}`,
  `${sep}.config${sep}autostart${sep}`, `${sep}Library${sep}LaunchAgents${sep}`,
  `${sep}Library${sep}LaunchDaemons${sep}`, `${sep}.claude${sep}`, `${sep}.opersona-bridge${sep}`,
];

function isSensitive(abs: string): boolean {
  const withSep = abs + sep;
  if (SENSITIVE_FRAGMENTS.some((f) => withSep.includes(f))) return true;
  if (SENSITIVE_BASENAMES.has(basename(abs))) return true;
  // any path segment that is a sensitive basename (e.g. .../foo/.ssh/id_rsa handled by fragment,
  // but .../.ssh exactly as leaf handled by basename; also deny .git/config style credential files)
  if (/(^|\/)\.git(\/|$)/.test(abs) && /(\/|^)(config|hooks)(\/|$)/.test(abs)) return true;
  return false;
}

/**
 * Resolve `candidate` (may be relative to root) and confirm it is a real,
 * symlink-safe descendant of `root` and not a sensitive sink. Returns the
 * canonical absolute path, or null to DENY. Walks each existing ancestor via
 * realpath so a symlink pointing outside the grant is caught.
 */
export function containedPath(root: string, candidate: string): string | null {
  if (typeof candidate !== 'string' || !candidate || candidate.includes('\0')) return null;
  if (candidate.startsWith('~')) return null;                       // no home expansion
  const rootReal = safeReal(root);
  const abs = isAbsolute(candidate) ? resolve(candidate) : resolve(rootReal, candidate);
  // canonicalize the deepest existing prefix (target itself may not exist yet for Write)
  let probe = abs;
  const tail: string[] = [];
  while (!existsSync(probe)) {
    const parent = resolve(probe, '..');
    if (parent === probe) return null;                             // walked off the top
    tail.unshift(basename(probe));
    probe = parent;
  }
  let real: string;
  try { real = realpathSync(probe); } catch { return null; }
  const finalAbs = tail.length ? join(real, ...tail) : real;
  if (finalAbs !== rootReal && !finalAbs.startsWith(rootReal + sep)) return null;  // escaped the subtree
  if (isSensitive(finalAbs)) return null;
  return finalAbs;
}

/** Every path-bearing arg for each built-in tool. Unknown tool ⇒ [] ⇒ default-deny. */
export function pathArgsFor(tool: string, input: Record<string, unknown>): { key: string; value: string }[] {
  const str = (k: string) => (typeof input[k] === 'string' ? [{ key: k, value: input[k] as string }] : []);
  switch (tool) {
    case 'Read': return str('file_path');
    case 'Write': return str('file_path');
    case 'Edit': return str('file_path');
    case 'NotebookEdit': return str('notebook_path');
    case 'MultiEdit': {
      const out = str('file_path');
      const edits = input.edits;
      if (Array.isArray(edits)) for (const e of edits) if (e && typeof (e as Record<string, unknown>).file_path === 'string') out.push({ key: 'edits.file_path', value: (e as Record<string, string>).file_path });
      return out;
    }
    case 'Glob': return str('path');   // pattern validated separately
    case 'Grep': return str('path');
    default: return [];
  }
}
